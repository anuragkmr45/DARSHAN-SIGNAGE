# Access Control And Ownership

## Repo Ownership

- `darshan-server`: backend team write access
- `darshan-cms`: CMS/frontend team write access
- `darshan-player`: player/electron team write access
- `DARSHAN monorepo root`: platform, ops, support, and release engineering write access

## Minimum Read Access

- all engineering teams should have read access to `DARSHAN monorepo root`
- platform/security should have read access to every repo
- ops/support should not need write access to product repos

## Governance Rules

- enable branch protection in every repo
- require owner approval per repo through `CODEOWNERS`
- promote QA and production only through manifest PRs in `DARSHAN monorepo root`
- do not let ops edit product code repos to change deployment behavior
