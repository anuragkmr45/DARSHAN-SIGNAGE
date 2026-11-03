import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import { departmentsApi } from "@/api/domains/departments";
import { ApiError } from "@/api/apiClient";
import type { Department } from "@/api/types";
import { DepartmentCard } from "@/components/departments/DepartmentCard";
import { DepartmentFormDialog } from "@/components/departments/DepartmentFormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchBar } from "@/components/common/SearchBar";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { LoadingIndicator } from "@/components/common/LoadingIndicator";
import { PageNavigation } from "@/components/common/PageNavigation";
import { useSafeMutation } from "@/hooks/useSafeMutation";
import { useAuthorization } from "@/hooks/useAuthorization";
import { queryKeys } from "@/api/queryKeys";

const PAGE_SIZE = 9;
const blockerLabels: Record<string, string> = {
  users: "Primary users", additional_users: "Additional members", media: "Media", layouts: "Layouts",
  presentations: "Presentations", schedules: "Schedules",
};
const parseDeleteBlockers = (failure: unknown) => {
  if (!(failure instanceof ApiError) || failure.code !== "DEPARTMENT_IN_USE" || !failure.details || typeof failure.details !== "object") return [];
  return Object.entries(failure.details as Record<string, unknown>)
    .filter(([key, value]) => key in blockerLabels && typeof value === "number" && value > 0)
    .map(([key, value]) => `${blockerLabels[key]}: ${value}`);
};

const Departments = () => {
  const queryClient = useQueryClient();
  const { can } = useAuthorization();
  const canCreate = can("create", "Department");
  const canUpdate = can("update", "Department");
  const canDelete = can("delete", "Department");
  const canReadOperators = can("read", "User");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState<Department | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);
  const [confirmationInput, setConfirmationInput] = useState("");
  const [deleteBlockers, setDeleteBlockers] = useState<string[]>([]);

  const { data, isLoading, isFetching, isError, error, isPlaceholderData, refetch } = useQuery({
    queryKey: [...queryKeys.departments, page, PAGE_SIZE, searchQuery],
    queryFn: () => departmentsApi.list({ page, limit: PAGE_SIZE, search: searchQuery.trim() || undefined }),
    placeholderData: (previousData) => previousData,
  });
  const departments = data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  useEffect(() => { setPage(1); }, [searchQuery]);
  useEffect(() => {
    if (data && !isPlaceholderData && page > totalPages) setPage(totalPages);
  }, [data, isPlaceholderData, page, totalPages]);

  const createOrUpdate = useSafeMutation({
    retry: false,
    mutationFn: async (payload: { values: { name: string; description?: string }; id?: string }) => {
      const trimmed = { name: payload.values.name.trim(), description: payload.values.description?.trim() };
      if (!trimmed.name) throw new Error("Name is required");
      return payload.id ? departmentsApi.update(payload.id, trimmed) : departmentsApi.create(trimmed);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.departments });
      setFormOpen(false);
      setSelectedDepartment(null);
    },
  }, "Unable to save department.");

  const deleteDepartment = useSafeMutation({
    retry: false,
    mutationFn: departmentsApi.remove,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.departments });
      setSelectedDepartment(null);
      setFormOpen(false);
      setDeleteTarget(null);
      setConfirmationInput("");
      setDeleteBlockers([]);
    },
    onError: (failure) => setDeleteBlockers(parseDeleteBlockers(failure)),
  }, "Unable to delete department.");

  const requestDelete = (department: Department) => {
    setDeleteTarget(department);
    setConfirmationInput("");
    setDeleteBlockers([]);
  };
  const cancelDelete = () => { setDeleteTarget(null); setConfirmationInput(""); setDeleteBlockers([]); };

  return <div className="mx-auto w-full max-w-6xl space-y-5">
    <header className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-2xl font-semibold tracking-tight">Departments</h1><p className="mt-1 text-sm text-muted-foreground">Organize people and content by department.</p></div>
      {canCreate && <Button onClick={() => { setSelectedDepartment(null); setFormOpen(true); }}><Plus aria-hidden="true" className="mr-2 h-4 w-4" />New Department</Button>}
    </header>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="w-full sm:max-w-sm"><SearchBar placeholder={canReadOperators ? "Search departments or operators…" : "Search departments…"} onSearch={setSearchQuery} initialValue={searchQuery} /></div>
      <div className="flex items-center gap-2"><p className="text-sm text-muted-foreground" aria-live="polite">{isLoading ? "Loading departments…" : `${data?.total ?? 0} departments`}{isFetching && !isLoading ? " · Updating" : ""}</p><Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}><RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />Refresh</Button></div>
    </div>
    {isLoading ? <LoadingIndicator label="Loading departments…" /> : isError && !data ? <EmptyState title="Could not load departments" description={error instanceof Error ? error.message : "Please try again."} actionLabel="Retry" onAction={() => void refetch()} /> : departments.length === 0 ? <EmptyState title={searchQuery ? "No matching departments" : "No departments yet"} description={searchQuery ? "Try another search." : "Add a department to organize people and content."} /> : <div className="border-y">{departments.map((department) => <DepartmentCard key={department.id} department={department} canReadOperators={canReadOperators} onEdit={canUpdate ? (item) => { setSelectedDepartment(item); setFormOpen(true); } : undefined} onDelete={canDelete ? requestDelete : undefined} />)}</div>}
    {isError && data && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">Could not refresh departments. Showing the last loaded page. <Button variant="outline" size="sm" onClick={() => void refetch()}>Retry</Button></div>}
    {data && data.total > PAGE_SIZE && <PageNavigation currentPage={page} totalPages={totalPages} onPageChange={setPage} />}

    <DepartmentFormDialog open={formOpen} onClose={() => { setFormOpen(false); setSelectedDepartment(null); }} department={selectedDepartment} isSubmitting={createOrUpdate.isPending} onSubmit={async (values, id) => { await createOrUpdate.mutateAsync({ values, id }); }} onDelete={canDelete ? (id) => { const item = departments.find((department) => department.id === id) ?? selectedDepartment; if (item) requestDelete(item); } : undefined} />

    <ConfirmDialog open={Boolean(deleteTarget)} title="Delete department?" description={`Move its users and content first. Then type “${deleteTarget?.name ?? ""}” to confirm deletion.`} confirmLabel="Delete Department" confirmDisabled={confirmationInput !== deleteTarget?.name} onCancel={cancelDelete} onConfirm={() => { if (deleteTarget) void deleteDepartment.mutateAsync(deleteTarget.id); }} isLoading={deleteDepartment.isPending}>
      <div className="space-y-1"><Label htmlFor="department-delete-name">Department name</Label><Input id="department-delete-name" value={confirmationInput} onChange={(event) => setConfirmationInput(event.target.value)} autoComplete="off" /></div>
      {deleteBlockers.length > 0 && <div role="alert" className="text-sm"><p className="font-medium text-destructive">This department is still in use.</p><ul className="mt-1 list-inside list-disc text-muted-foreground">{deleteBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
    </ConfirmDialog>
  </div>;
};

export default Departments;
