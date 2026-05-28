import { ApiError } from "@/api/apiClient";
import { mapMediaDeleteError } from "@/lib/mediaDeleteErrors";

describe("mapMediaDeleteError", () => {
  test("maps MEDIA_DELETE_FORBIDDEN_OWNER to direct message and dismisses dialog", () => {
    const result = mapMediaDeleteError(
      new ApiError({
        status: 403,
        code: "MEDIA_DELETE_FORBIDDEN_OWNER",
        message: "You can only delete media you uploaded. This media was uploaded by Priya Sharma.",
        details: {
          owner_user_id: "owner-1",
          owner_display_name: "Priya Sharma",
        },
      }),
    );

    expect(result.title).toBe("Delete not allowed");
    expect(result.description).toBe(
      "You can only delete media you uploaded. This media was uploaded by Priya Sharma.",
    );
    expect(result.dismissDeleteDialog).toBe(true);
  });

  test("maps MEDIA_IN_USE chat_attachments to chat help route", () => {
    const result = mapMediaDeleteError(
      new ApiError({
        status: 409,
        code: "MEDIA_IN_USE",
        message: "Media cannot be deleted because it is still used by chat messages.",
        details: { references: ["chat_attachments"] },
      }),
    );

    expect(result.title).toBe("Media in use");
    expect(result.helpRoute).toBe("/chat");
    expect(result.helpLabel).toBe("Open chat");
    expect(result.dismissDeleteDialog).toBe(true);
  });

  test("maps MEDIA_IN_USE screens to screens help route", () => {
    const result = mapMediaDeleteError(
      new ApiError({
        status: 409,
        code: "MEDIA_IN_USE",
        message: "Media cannot be deleted because it is still used in screens.",
        details: { references: ["screens"] },
      }),
    );

    expect(result.helpRoute).toBe("/screens");
    expect(result.helpLabel).toBe("Open screens");
  });

  test("does not invent CTA for unsupported MEDIA_IN_USE reference", () => {
    const result = mapMediaDeleteError(
      new ApiError({
        status: 409,
        code: "MEDIA_IN_USE",
        message: "Media cannot be deleted because it is still used in presentations.",
        details: { references: ["presentations"] },
      }),
    );

    expect(result.helpRoute).toBeUndefined();
    expect(result.helpLabel).toBeUndefined();
  });

  test("maps generic FORBIDDEN and NOT_FOUND to stable destructive toasts", () => {
    const forbidden = mapMediaDeleteError(
      new ApiError({
        status: 403,
        code: "FORBIDDEN",
        message: "Forbidden",
      }),
    );
    const notFound = mapMediaDeleteError(
      new ApiError({
        status: 404,
        code: "NOT_FOUND",
        message: "Media not found",
      }),
    );

    expect(forbidden.title).toBe("Delete not allowed");
    expect(forbidden.dismissDeleteDialog).toBe(true);
    expect(notFound.title).toBe("Media not found");
    expect(notFound.dismissDeleteDialog).toBe(true);
  });

  test("falls back to generic destructive toast for unknown errors", () => {
    const result = mapMediaDeleteError(new Error("boom"));

    expect(result.title).toBe("Delete failed");
    expect(result.description).toBe("boom");
    expect(result.dismissDeleteDialog).toBe(false);
  });
});
