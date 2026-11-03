import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LiveSession, User } from "@/api/types";
import { LiveSourceForm, LiveSourceErrorNotice } from "./LiveSourceForm";
import { LiveSourceCard } from "./LiveSourceCard";

const actor: User = { id: "76140ec0-caad-421b-b5f8-c45b22f19fda", email: "operator@example.test", role_id: "custom", role: "CUSTOM_AUTHOR" };
const source: LiveSession = { id: "source", name: "Hall source", description: null, presenter_user_id: "8d4ba116-cfd0-4112-a68b-5dd44f68b381",
  microphone: false, screen_share_audio: false, is_active: true, revision: 3, policy_revision: 1, created_by: actor.id,
  owner_scope: "DEPARTMENT", owner_department_id: "a", ownership: null, permissions: { can_update: false, can_delete: false }, created_at: "", updated_at: "" };
const props = { actor, editable: true, pending: false, canReadDirectory: false, presenters: [], onRefreshDirectory: vi.fn(), onSubmit: vi.fn(), onClose: vi.fn() };

describe("live source operator components (server render)", () => {
  it("renders accessible authoring controls, self-only creation and conservative audio defaults", () => {
    const markup = renderToStaticMarkup(createElement(LiveSourceForm, props));
    for (const label of ["Source name", "Description", "Presenter", "Allow microphone", "Allow captured audio", "Enable for new schedules"]) expect(markup).toContain(label);
    expect(markup).toContain("operator@example.test"); expect(markup).toContain("User directory access is needed to choose another presenter");
    expect(markup.match(/aria-checked="false"/g)).toHaveLength(2); expect(markup).toContain("Create live source");
  });
  it("keeps an existing presenter read-only without directory access and hides writes in view mode", () => {
    const markup = renderToStaticMarkup(createElement(LiveSourceForm, { ...props, source, editable: false }));
    expect(markup).toContain("Assigned presenter (not in your active directory)"); expect(markup).toContain("Loaded revision 3");
    expect(markup).toContain("read-only"); expect(markup).not.toContain("Save changes"); expect(markup).not.toContain("Refresh presenters");
  });
  it("distinguishes intentional View mode from lacking update access", () => {
    const markup = renderToStaticMarkup(createElement(LiveSourceForm, { ...props, source, editable: false, viewOnly: true }));
    expect(markup).toContain("Viewing source details.");
    expect(markup).not.toContain("read-only with your current access");
    expect(markup).not.toContain("Save changes");
  });
  it("uses per-record server permissions even when the role permits general updates/deletes", () => {
    const markup = renderToStaticMarkup(createElement(LiveSourceCard, { source, canUpdate: true, canDelete: true, actorId: actor.id,
      onView: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() }));
    expect(markup).toContain("View source"); expect(markup).not.toContain('aria-label="Edit Hall source"'); expect(markup).not.toContain('aria-label="Delete Hall source"');
    expect(markup).toContain("Enabled"); expect(markup).not.toContain(">Available<");
  });
  it("renders safe readable blocker categories without a raw backend payload", () => {
    const markup = renderToStaticMarkup(createElement(LiveSourceErrorNotice, { error: { title: "Source is in use", message: "Remove references first.", stale: false,
      uncertain: false, blockers: [{ label: "Editable or current/future schedule items", count: 2 }] } }));
    expect(markup).toContain('role="alert"'); expect(markup).toContain("schedule items: 2"); expect(markup).not.toContain("schedule_items");
  });
});
