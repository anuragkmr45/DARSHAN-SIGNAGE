# Integration Test Database Safety

DARSHAN integration tests change PostgreSQL state. They must never use a developer, QA, or production database.

Set `TEST_DATABASE_URL` to a dedicated DARSHAN database whose name ends in `_test`, for example:

```bash
export TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/darshan_test
npm run test:integration
```

The runner validates that target, drops and recreates only explicit DARSHAN-owned names such as `darshan_test`, applies the checked migration baseline, and then starts Vitest with `NODE_ENV=test` and `DATABASE_URL` set to that database.

Direct `vitest` invocations are refused unless `DATABASE_URL` points to a dedicated `_test` database. This is deliberate: the reset command is destructive and must be isolated from shared application data.

Use `npm run test:db:reset` only with the same explicit `TEST_DATABASE_URL` when you need a fresh migration-verified test database without running tests.
