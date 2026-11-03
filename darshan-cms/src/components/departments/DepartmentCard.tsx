import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { usersApi } from "@/api/domains/users";
import type { Department } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingIndicator } from "@/components/common/LoadingIndicator";
import { PageNavigation } from "@/components/common/PageNavigation";

const OPERATORS_PAGE_SIZE = 10;

interface DepartmentCardProps {
  department: Department;
  canReadOperators: boolean;
  onEdit?: (department: Department) => void;
  onDelete?: (department: Department) => void;
}

export const DepartmentCard = ({ department, canReadOperators, onEdit, onDelete }: DepartmentCardProps) => {
  const [operatorsOpen, setOperatorsOpen] = useState(false);
  const [operatorsPage, setOperatorsPage] = useState(1);
  const operatorsQuery = useQuery({
    queryKey: ["department-operators", department.id, operatorsPage],
    queryFn: () => usersApi.list({ department_id: department.id, role: "OPERATOR", page: operatorsPage, limit: OPERATORS_PAGE_SIZE }),
    enabled: canReadOperators && operatorsOpen,
  });
  const operators = operatorsQuery.data?.items ?? [];
  const total = operatorsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / OPERATORS_PAGE_SIZE));

  return <article className="border-b border-border/70 py-4 first:pt-0 last:border-0">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h3 className="break-words text-base font-semibold">{department.name}</h3>
        {department.description && <p className="mt-1 text-sm text-muted-foreground">{department.description}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canReadOperators && <Button variant="outline" size="sm" onClick={() => { setOperatorsPage(1); setOperatorsOpen(true); }}>View Operators</Button>}
        {(onEdit || onDelete) && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${department.name}`}><MoreHorizontal aria-hidden="true" className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
          {onEdit && <DropdownMenuItem onClick={() => onEdit(department)}><Pencil aria-hidden="true" className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>}
          {onDelete && <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(department)}><Trash2 aria-hidden="true" className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>}
        </DropdownMenuContent></DropdownMenu>}
      </div>
    </div>
    <details className="mt-2 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer">Technical ID</summary><code className="mt-1 block break-all">{department.id}</code></details>

    {canReadOperators && <Dialog open={operatorsOpen} onOpenChange={setOperatorsOpen}><DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Operators in {department.name}</DialogTitle><DialogDescription>Includes primary and additional department memberships.</DialogDescription></DialogHeader>
      {operatorsQuery.isLoading ? <LoadingIndicator label="Loading operators…" /> : operatorsQuery.isError && !operatorsQuery.data ? <EmptyState title="Could not load operators" description="Your changes are safe. Try again." actionLabel="Retry" onAction={() => void operatorsQuery.refetch()} /> : <>
        <p className="text-sm text-muted-foreground">{total} {total === 1 ? "operator" : "operators"}{operatorsQuery.isFetching ? " · Updating" : ""}</p>
        {operators.length === 0 ? <p className="py-5 text-sm text-muted-foreground">No operators are assigned to this department yet.</p> : <div className="divide-y border-y">{operators.map((operator) => {
          const name = `${operator.first_name ?? ""} ${operator.last_name ?? ""}`.trim() || operator.email;
          return <div key={operator.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm"><div className="min-w-0"><p className="font-medium">{name}</p><p className="break-all text-xs text-muted-foreground">{operator.email}</p></div><div className="flex gap-2"><Badge variant="outline">{operator.department_id === department.id ? "Primary" : "Additional"}</Badge><Badge variant="outline">{operator.is_active ? "Active" : "Inactive"}</Badge></div></div>;
        })}</div>}
        {operatorsQuery.isError && operatorsQuery.data && <div role="alert" className="flex items-center gap-2 text-sm text-destructive">Could not refresh operators. Showing the last loaded page. <Button variant="outline" size="sm" onClick={() => void operatorsQuery.refetch()}>Retry</Button></div>}
        {total > OPERATORS_PAGE_SIZE && <PageNavigation currentPage={operatorsPage} totalPages={totalPages} onPageChange={setOperatorsPage} />}
      </>}
    </DialogContent></Dialog>}
  </article>;
};
