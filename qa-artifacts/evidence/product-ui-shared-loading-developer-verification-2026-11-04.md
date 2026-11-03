# Shared loading feedback: developer verification

Status: source-level and build verification on the redesign branch. A real application timing check remains open.

## Behavior

- The previous top bar appeared and pulsed whenever any React Query fetch or mutation was active. Periodic monitoring and notification refreshes therefore triggered repeated motion without an operator action.
- The shared indicator now ignores queries, waits 300 ms for a pending mutation, then displays a static two-pixel line with a screen-reader status. It disappears when mutation activity ends. Route-level query skeletons, status text and Retry actions remain responsible for query feedback.

## Developer checks and remaining work

- CMS production build and bundle-budget gate passed after the change.
- Focused ESLint passed. The CMS unit suite passed **42 files, 271/271**.
- Verify with the rebuilt CMS against real services that background polling does not flash the bar and a slow operator mutation still gives local and global feedback. This is not yet real-service acceptance.
