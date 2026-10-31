import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { DepartmentCard } from "@/components/departments/DepartmentCard";
import { DepartmentFormDialog } from "@/components/departments/DepartmentFormDialog";
import { departmentsApi } from "@/api/domains/departments";
import { usersApi } from "@/api/domains/users";
import type { Department, User } from "@/api/types";
import { PageHeader } from "@/components/common/PageHeader";
import { SearchBar } from "@/components/common/SearchBar";
import { EmptyState } from "@/components/common/EmptyState";
import { useSafeMutation } from "@/hooks/useSafeMutation";
import { queryKeys } from "@/api/queryKeys";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { LoadingIndicator } from "@/components/common/LoadingIndicator";
import { PageNavigation } from "@/components/common/PageNavigation";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useAppSelector } from "@/store/hooks";

const PAGE_SIZE = 9;
const USERS_PAGE_SIZE = 100;

const fetchAllOperators = async () => {
  let page = 1;
  let totalPages = 1;
  const items: User[] = [];

  while (page <= totalPages) {
    const response = await usersApi.list({
      page,
      limit: USERS_PAGE_SIZE,
      role: "OPERATOR",
    });

    items.push(...response.items);
    totalPages = Math.max(1, Math.ceil((response.total ?? response.items.length) / USERS_PAGE_SIZE));
    page += 1;
  }

  return items;
};

const Departments = () => {
  const queryClient = useQueryClient();
  const { can, canRecord } = useAuthorization();
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const canReadDepartments = can("read", "Department");
  const canReadUsers = can("read", "User");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState<Department | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const {
    data,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: [...queryKeys.departments, currentUserId ?? "anonymous", page, PAGE_SIZE],
    queryFn: () => departmentsApi.list({ page, limit: PAGE_SIZE }),
    enabled: Boolean(currentUserId) && canReadDepartments,
  });

  const operatorsQuery = useQuery({
    queryKey: [...queryKeys.users, "departments-page", currentUserId ?? "anonymous", "operators"],
    queryFn: fetchAllOperators,
    staleTime: 60_000,
    enabled: Boolean(currentUserId) && canReadUsers,
  });

  const departments = useMemo(() => canReadDepartments ? data?.items ?? [] : [], [canReadDepartments, data]);
  const operatorsByDepartment = useMemo(() => {
    if (!canReadUsers) return {};
    return (operatorsQuery.data ?? []).reduce<Record<string, User[]>>((acc, operator) => {
      if (!operator.department_id) return acc;
      if (!acc[operator.department_id]) {
        acc[operator.department_id] = [];
      }
      acc[operator.department_id].push(operator);
      return acc;
    }, {});
  }, [canReadUsers, operatorsQuery.data]);

  const departmentsWithOperators = useMemo(
    () =>
      departments.map((department) => ({
        ...department,
        operators: operatorsByDepartment[department.id] ?? [],
      })),
    [departments, operatorsByDepartment],
  );
  const visibleTotal = canReadDepartments ? data?.total ?? 0 : 0;
  const totalPages = Math.max(1, Math.ceil(visibleTotal / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [searchQuery]);

  useEffect(() => {
    setFormOpen(false);
    setSelectedDepartment(null);
    setDeleteTarget(null);
    setIsConfirmOpen(false);
    setPage(1);
    setSearchQuery("");
  }, [currentUserId]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const createOrUpdate = useSafeMutation({
    mutationFn: async (payload: { values: { name: string; description?: string }; id?: string }) => {
      const trimmed = { ...payload.values, name: payload.values.name.trim(), description: payload.values.description?.trim() };
      if (!trimmed.name) {
        throw new Error("Name is required");
      }
      if (payload.id) {
        const current = selectedDepartment?.id === payload.id
          ? selectedDepartment
          : departments.find((department) => department.id === payload.id);
        if (!current || !canRecord("update", "Department", current) ||
            !canRecord("update", "Department", { ...current, ...trimmed })) {
          throw new Error("You no longer have permission to update this department.");
        }
        return departmentsApi.update(payload.id, trimmed);
      }
      if (!canRecord("create", "Department", trimmed)) {
        throw new Error("You do not have permission to create this department.");
      }
      return departmentsApi.create(trimmed);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.departments });
      setFormOpen(false);
      setSelectedDepartment(null);
    },
  }, "Unable to save department.");

  const deleteDepartment = useSafeMutation({
    mutationFn: async (id: string) => {
      if (!deleteTarget || deleteTarget.id !== id || !canRecord("delete", "Department", deleteTarget)) {
        throw new Error("You no longer have permission to delete this department.");
      }
      return departmentsApi.remove(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.departments });
      setSelectedDepartment(null);
      setFormOpen(false);
      setIsConfirmOpen(false);
      setDeleteTarget(null);
    },
  }, "Unable to delete department.");

  const filteredDepartments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return departmentsWithOperators;
    return departmentsWithOperators.filter((dept) => {
      const haystack = [
        dept.name,
        dept.description ?? "",
        dept.id,
        ...(dept.operators ?? []).flatMap((operator) => [
          operator.first_name ?? "",
          operator.last_name ?? "",
          operator.email,
        ]),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [departmentsWithOperators, searchQuery]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Department Management"
        description="Organize screens, users, and content by department"
        actionLabel="New Department"
        actionIcon={<Plus className="h-4 w-4" />}
        onAction={can("create", "Department") ? () => setFormOpen(true) : undefined}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="w-full lg:max-w-md">
          <SearchBar placeholder="Search departments..." onSearch={setSearchQuery} initialValue={searchQuery} />
        </div>
        <div className="text-sm text-muted-foreground">
          {isFetching ? "Refreshing..." : `${visibleTotal} departments`}
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-md border p-6">
          <LoadingIndicator label="Loading departments..." />
        </div>
      ) : (
        <>
          {filteredDepartments.length === 0 ? (
            <EmptyState title="No departments found" description="Try adjusting your search or create a new department." />
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {filteredDepartments.map((dept) => (
                  <DepartmentCard
                    key={dept.id}
                    department={dept}
                    canViewOperators={canReadUsers}
                    onEdit={canRecord("update", "Department", dept) ? (d) => {
                      setSelectedDepartment(d);
                      setFormOpen(true);
                    } : undefined}
                    onDelete={canRecord("delete", "Department", dept) ? (d) => {
                      setDeleteTarget(d);
                      setIsConfirmOpen(true);
                    } : undefined}
                  />
                ))}
              </div>
              <PageNavigation currentPage={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </>
      )}

      <DepartmentFormDialog
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setSelectedDepartment(null);
        }}
        department={selectedDepartment}
        isSubmitting={createOrUpdate.isPending}
        onSubmit={async (values, id) => {
          await createOrUpdate.mutateAsync({ values, id });
        }}
        onDelete={selectedDepartment && canRecord("delete", "Department", selectedDepartment) ? (deptId) => {
          if (!deptId) return;
          const resolvedDepartment =
            departmentsWithOperators.find((d) => d.id === deptId) ??
            departments.find((d) => d.id === deptId) ??
            selectedDepartment;
          if (resolvedDepartment) {
            setDeleteTarget(resolvedDepartment);
            setIsConfirmOpen(true);
          }
        } : undefined}
      />

      <ConfirmDialog
        open={isConfirmOpen}
        title="Delete department?"
        description={`This will permanently remove "${deleteTarget?.name ?? "this department"}".`}
        confirmLabel="Delete"
        onCancel={() => {
          setIsConfirmOpen(false);
          setDeleteTarget(null);
        }}
        onConfirm={async () => {
          if (!deleteTarget || !canRecord("delete", "Department", deleteTarget)) return;
          await deleteDepartment.mutateAsync(deleteTarget.id);
        }}
        isLoading={deleteDepartment.isPending}
      />
    </div>
  );
};

export default Departments;
