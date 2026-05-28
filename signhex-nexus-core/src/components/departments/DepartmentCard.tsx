import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Monitor, MoreVertical, Edit, MapPin, Trash2, Users, Mail, CircleDot } from "lucide-react";
import type { Department } from "@/api/types";

interface DepartmentCardProps {
  department: Department;
  onEdit: (dept: Department) => void;
  onDelete?: (dept: Department) => void;
}

export const DepartmentCard = ({ department, onEdit, onDelete }: DepartmentCardProps) => {
  const operators = department.operators ?? [];
  const [isOperatorsOpen, setIsOperatorsOpen] = useState(false);

  return (
    <>
      <Card className="transition-shadow hover:shadow-lg">
        <CardHeader className="flex flex-row items-start justify-between pb-3">
          <div className="space-y-1 flex-1">
            <h3 className="font-semibold text-lg text-foreground">{department.name}</h3>
            <p className="text-sm text-muted-foreground line-clamp-3">
              {department.description || "No description provided."}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 -mt-1">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => onEdit(department)} className="gap-2">
                <Edit className="h-4 w-4" />
                Edit
              </DropdownMenuItem>
              {onDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(department)}
                  className="gap-2 text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Monitor className="h-4 w-4" />
            <span>Department ID</span>
            <Badge variant="outline">{department.id}</Badge>
          </div>
          {department.description && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              <span>Managed content & screens</span>
            </div>
          )}

          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span>Operators</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  See all operators for this department in one place.
                </p>
              </div>
              <Badge variant="secondary" className="shrink-0">
                {operators.length}
              </Badge>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="mt-4 w-full"
              onClick={() => setIsOperatorsOpen(true)}
            >
              View Operators
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isOperatorsOpen} onOpenChange={setIsOperatorsOpen}>
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{department.name} Operators</DialogTitle>
            <DialogDescription>
              Review all operators assigned to this department. Expand a row to inspect full details.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{operators.length} operators</Badge>
              <Badge variant="outline">Department: {department.name}</Badge>
            </div>
          </div>

          {operators.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No operators are assigned to this department yet.
            </div>
          ) : (
            <Accordion type="multiple" className="rounded-lg border px-4">
              {operators.map((operator) => {
                const name = `${operator.first_name ?? ""} ${operator.last_name ?? ""}`.trim() || operator.email;
                return (
                  <AccordionItem key={operator.id} value={operator.id}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex min-w-0 flex-1 items-center justify-between gap-3 pr-4 text-left">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{name}</p>
                          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                            <Mail className="h-3.5 w-3.5" />
                            <span className="truncate">{operator.email}</span>
                          </div>
                        </div>
                        <Badge variant={operator.is_active ? "secondary" : "outline"} className="shrink-0">
                          {operator.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="grid gap-3 rounded-md bg-muted/30 p-4 text-sm md:grid-cols-2">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">Full Name</p>
                          <p className="mt-1 font-medium">{name}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">Email</p>
                          <p className="mt-1 break-all font-medium">{operator.email}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">Role</p>
                          <div className="mt-1 flex items-center gap-2">
                            <CircleDot className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium">{operator.role ?? "OPERATOR"}</span>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
                          <p className="mt-1 font-medium">{operator.is_active ? "Active" : "Inactive"}</p>
                        </div>
                        <div className="md:col-span-2">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">User ID</p>
                          <p className="mt-1 break-all font-mono text-xs">{operator.id}</p>
                        </div>
                        {operator.created_at && (
                          <div>
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Created</p>
                            <p className="mt-1 font-medium">{new Date(operator.created_at).toLocaleString()}</p>
                          </div>
                        )}
                        {operator.updated_at && (
                          <div>
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Last Updated</p>
                            <p className="mt-1 font-medium">{new Date(operator.updated_at).toLocaleString()}</p>
                          </div>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
