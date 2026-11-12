# Shared rate limiter

The existing limits and 429/`Retry-After` behavior are preserved. In development the default store is process-local memory. Production configuration requires `RATE_LIMIT_STORE=postgres`; requests then use atomic PostgreSQL upserts so separate application instances share each fixed-window counter. Rate-limit identities are HMACed before persistence; raw IP addresses and user IDs are not stored in `rate_limit_buckets`.

## Enablement

1. Review and rehearse `migrations/005_shared_rate_limit_store.sql` on a disposable restore.
2. Obtain approval before applying migration 005 to a production database.
3. Grant the runtime role `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on `public.rate_limit_buckets`; it does not need DDL or table ownership.
4. Set `RATE_LIMIT_STORE=postgres` in the protected production configuration.
5. Start the application. Production startup fails closed if the runtime role is overprivileged, the target database is wrong, or the shared table cannot be read. If counter operations fail while serving requests, the limiter returns a generic 503 rather than bypassing enforcement.
6. Monitor PostgreSQL pool usage and size the per-instance pool against the server's total connection budget before scaling out.

Expired counters are removed by a best-effort cleanup query. Cleanup failures are logged with a database error code only; enforcement remains fail-closed.

## Verification

`npm test` applies migration 005 only to its disposable database and runs `tests/rate-limit-store.test.js`. That test creates two independent PostgreSQL store instances, performs concurrent increments against the same key, verifies one shared limit and `Retry-After`, and verifies an unavailable store returns 503 without leaking internal errors.

This proves cross-store behavior on the local disposable test database, not production availability or capacity. The configured `Noveltail` database has not been migrated to 005; multi-instance production mode remains blocked until its owner approves and applies that migration and grants.

