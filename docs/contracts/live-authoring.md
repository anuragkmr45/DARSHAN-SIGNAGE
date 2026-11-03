# Live event authoring and prepared fallback review

This is an additive feature-branch contract. It does not mark live broadcasting
or the independent human QA cases complete. Runtime authority, the normal
desktop player, presenter capture and deployment have separate integration gates.

## Operator flow

An authorized operator opens **Live broadcasts → Schedule live event**, chooses
an enabled source and an existing fallback presentation, and requests immutable
fallback preparation. Preparation can remain PENDING while its worker or queue
is unavailable. FAILED work is retried only by an explicit operator action.

The wizard pages through the current screen/group directories and retains
selections across pages. Review resolves groups to 1–25 concrete screen IDs,
checks current presenter permissions, player capability and fallback eligibility,
and displays the prepared files. It does not infer playback from connection or
from a successful review. Submission creates a request and capacity/screen
holds; approval/publication remain the existing Schedule Queue actions.

Live wizard date inputs explicitly use the current browser timezone. The
timezone selector is read-only in this flow. Browser draft dates are stored as
absolute UTC instants, so reopening after a computer timezone change preserves
the scheduled instant. This does not change the existing ordinary wizard's
audit-timezone behavior. Backend time and final schedule checks remain
authoritative.

## Atomic draft and retry contract

`0061_live_authoring_drafts.sql` journals one operator-owned draft and its
submission identity. It contains policy/review data, never media tickets,
presigned URLs, cookies or access credentials.

| Endpoint | Behavior |
| --- | --- |
| `POST /api/v1/live-schedule-drafts/:id/review` | The client supplies a draft UUID, request UUID and expected draft revision. Create or update exactly one schedule/item and validate the complete live policy in one transaction. |
| `GET /api/v1/live-schedule-drafts/:id` | Return current retry/edit metadata to the same creator with current Schedule read access. No media download credentials are returned. |
| `POST /api/v1/live-schedule-drafts/:id/submit` | Check the expected revision and reviewed policy fingerprint; create exactly one request, its live occurrence and its screen/capacity holds in one transaction. |

The lock order is current role graph and sorted actor/presenter identities,
current session, global screen-reference lock, draft advisory/row lock and
schedule row lock. Graph validation and writes share the same transaction.
Storage signing runs only after the transaction has finished.

An identical last-request retry returns the same draft/request identity.
Changing a request body while reusing its request UUID is a conflict. A stale
revision is a conflict. An unsubmitted draft can be edited without appending
another schedule item. A draft with any request or publish history cannot be
edited through this flow. Submission revalidates the reviewed fingerprint and
reserves capacity; a same-count group-member replacement requires fresh review.

Initial item creation requires current record-bound Create Schedule and Create
Schedule Item access. Editing also requires Update Schedule and Update Schedule
Item access on the existing/proposed records. A create-only custom operator can
re-open the same review and submit it, but cannot edit the saved item. The API
remains authoritative if permissions change after the dialog opens.

Conditional Schedule update grants apply to both the existing and proposed
schedule values. A denied rename leaves the schedule, item and draft journal
unchanged. The review acknowledgement and request notes remain usable by a
create-only author after a confirmed review; they do not grant schedule editing.

The browser saves a per-account, per-tab retry journal **before** each mutation.
After response loss, editing is blocked until the operator retries that exact
command or reloads the saved draft. Reload replaces the form explicitly and
can discover an already-created request. A confirmed deleted draft returns
`LIVE_DRAFT_RETIRED`; the operator can explicitly start a new draft UUID.
Starting a new draft retains prior server schedules and request history.

## Prepared preview

`GET /api/v1/live-fallback-preparations/:id/preview` requires current authoring
and record-bound library access, READY state, current source fingerprint and
the same complete normalized immutable graph checks used by approval. It signs
the verified content-addressed files for the CMS for 15 minutes, after releasing
database locks. It does not perform per-request storage HEAD/hash work or write
transport URLs into the preparation, approval or snapshot. The response is
`private, no-store`. Signing failure returns a safe retriable 503.

The CMS verifies response descriptors against the prepared manifest. It renders
prepared images, native PDFs at the selected page and prepared videos.
It recognizes the player's legacy slot aliases and stacking order. As in the
player, any legacy unslotted entry makes the whole fallback a full-screen
sequential timeline; those entries are not silently dropped from preview.
Videos start muted and each item can be inspected. Direct HLS visual preview
is explicitly unavailable; the preparation worker normally produces a pinned
standalone MP4 for legacy HLS sources.

An authoring preview becomes stale when its mutable source graph changes.
Review of previously approved/published immutable request history uses a
separate request-bound preview contract. Neither kind of preview confirms
that a player downloaded the fallback or rendered a frame.

## Verification boundary

Database-backed tests cover rollback, permission denial, exact retries, stale
revisions, concurrent edit/submission, group replacement and retained history.
CMS tests cover retry serialization, account separation, UTC persistence and
prepared preview parity. Running CMS journeys against the built API and
independent human QA remain required before closing the corresponding loop.
