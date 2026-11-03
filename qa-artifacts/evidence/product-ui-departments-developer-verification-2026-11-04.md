# Departments interface: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`, based on `release-01` at `1697249`.

Status: focused database-backed permission test and fixture-backed running-CMS browser checks. Real account/ownership and concurrent deletion QA remain open.

## Contract and interface result

The Departments page now uses a compact list with Search and Refresh. Create, Edit and Delete controls follow their individual current Department grants. Delete requires the exact name; a server `DEPARTMENT_IN_USE` response keeps the dialog open and displays counts for primary/additional users and owned Media, Layouts, Presentations and Schedules. The server remains the deletion authority.

The previous page fetched every OPERATOR in the site before showing any department, even for a role without `read User`, then could present an apparent zero count. View Operators now appears only with `read User`; opening it requests ten operators for that department at a time. The existing User API includes both primary and additional memberships. For a Department-only role, the backend Department search no longer matches operator names/email, avoiding directory discovery through search.

## Verification

- New `departments-ui.e2e.spec.ts`: **4/4** fixture browser cases passed for Department-only read, create/edit, blocked and successful delete, on-demand primary/additional operators with page two, initial failure/Retry, and 390/820/1440 CSS pixels plus dark phone.
- Existing `operator-multi-department.e2e.spec.ts`: **6/6** passed after its User-list fixture was made to honor the Department filter, matching the real API. The first run exposed this stale fixture and was not counted as a product failure.
- `departments.test.ts`: **2/2** passed against a dedicated `darshan_departments_ui_test` database with **65 migrations**. One route test proves that operator-name search is denied to a Department-only reader and allowed to a Department plus User reader.
- CMS and server builds passed; CMS bundle budget and **271/271** unit tests passed. Focused CMS lint had no findings; server lint had no errors and six existing `any` warnings. Diff check passed.
- Captures: [phone](product-ui-departments/departments-390.png), [tablet](product-ui-departments/departments-820.png), [desktop](product-ui-departments/departments-1440.png), [dark phone](product-ui-departments/departments-dark-390.png). Phone and dark-phone captures were visually inspected; no horizontal overflow at the three recorded widths.

## Open checks

- Run the full create/edit/rename/deletion flow against the real CMS/API with users, additional memberships and owned content. Verify blocker counts, concurrent new ownership and permission withdrawal while dialogs are open.
- Verify large-organization search and operator pagination, role conditions, stale updates, errors on the second User page, long department names/descriptions, 200% zoom, five accents, keyboard and screen reader.
- The server's Department deletion count/check and final DELETE are separate statements. The foreign-key conflict is translated to 409, but a production-like concurrent ownership race still needs direct testing and review of the database constraints.
