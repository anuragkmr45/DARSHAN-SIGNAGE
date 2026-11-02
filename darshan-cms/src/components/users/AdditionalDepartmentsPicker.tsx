import { useState } from "react";
import type { Department } from "@/api/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type Props = {
  departments: Department[];
  primaryDepartmentId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
};

export function AdditionalDepartmentsPicker({
  departments,
  primaryDepartmentId,
  value,
  onChange,
  disabled = false,
}: Props) {
  const [search, setSearch] = useState("");
  const selected = new Set(value.filter((id) => id !== primaryDepartmentId));
  const choices = departments
    .filter((department) => department.id !== primaryDepartmentId)
    .filter((department) => department.name.toLowerCase().includes(search.trim().toLowerCase()));

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="additional-departments-search">Additional departments</Label>
      <Input
        id="additional-departments-search"
        aria-label="Search additional departments"
        placeholder="Search departments"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        disabled={disabled || !primaryDepartmentId}
      />
      <div className="max-h-40 overflow-y-auto rounded-md border p-2" role="group" aria-label="Additional departments">
        {choices.length ? choices.map((department) => (
          <label key={department.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
            <input
              type="checkbox"
              aria-label={`Additional department ${department.name}`}
              checked={selected.has(department.id)}
              onChange={() => toggle(department.id)}
              disabled={disabled || !primaryDepartmentId}
            />
            <span>{department.name}</span>
          </label>
        )) : <p className="px-2 py-1 text-sm text-muted-foreground">No matching departments</p>}
      </div>
      <div className="flex flex-wrap gap-1">
        {Array.from(selected).map((id) => {
          const department = departments.find((item) => item.id === id);
          return <Badge key={id} variant="outline">{department?.name ?? id}</Badge>;
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        New content belongs to the primary department. Additional departments grant access only where the role permits it.
      </p>
    </div>
  );
}
