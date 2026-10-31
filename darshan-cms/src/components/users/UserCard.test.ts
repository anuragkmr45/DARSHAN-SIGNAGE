import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { User } from "@/api/types";
import { UserCard } from "./UserCard";

const user: User = {
  id: "user-id",
  email: "operator@example.test",
  first_name: "Test",
  last_name: "Operator",
  role_id: "role-id",
  role: "OPERATOR",
  is_active: true,
};

describe("UserCard action flags", () => {
  it("fails closed when server action flags are omitted", () => {
    const markup = renderToStaticMarkup(createElement(UserCard, {
      user,
      onEdit: vi.fn(),
      onDelete: vi.fn(),
    }));

    expect(markup).not.toContain("Edit");
    expect(markup).not.toContain("Delete");
  });

  it("shows only explicitly enabled actions", () => {
    const editOnly = renderToStaticMarkup(createElement(UserCard, {
      user,
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      canEdit: true,
      canDelete: false,
    }));
    const deleteOnly = renderToStaticMarkup(createElement(UserCard, {
      user,
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      canEdit: false,
      canDelete: true,
    }));

    expect(editOnly).toContain("Edit");
    expect(editOnly).not.toContain("Delete");
    expect(deleteOnly).not.toContain("Edit");
    expect(deleteOnly).toContain("Delete");
  });
});
