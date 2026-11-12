# Production setup checklist

This project is not production-ready until every release gate below has been completed in the target environment. Do not copy development credentials or the `.env.example` placeholders into production.

## Required configuration

Provide settings through the deployment platform's secret/configuration manager:

| Variable | Requirement |
|---|---|
| `NODE_ENV` | `production` |
| `DB_HOST`, `DB_PORT`, `DB_NAME` | Exact approved PostgreSQL endpoint and database |
| `DB_USER`, `DB_PASSWORD` | Dedicated least-privilege application role; never the PostgreSQL superuser |
| `DB_SSL` | `true`; TLS certificate validation remains enabled |
| `DB_POOL_MAX` | Per-instance connection ceiling, coordinated with the PostgreSQL connection budget |
| `JWT_SECRET` | Unique, high-entropy secret of at least 32 bytes; managed out of band |
| `APP_ORIGIN` | Exact public HTTPS origin, with no path or credentials |
| `TRUST_PROXY_HOPS` | Explicit integer from 0 to 10 matching the actual trusted proxy chain |
| `RATE_LIMIT_STORE` | `postgres` |
| `PORT` | Optional valid TCP port |

`server.js` refuses to start in production if required values are missing, use placeholders, have invalid formats, or do not enable the PostgreSQL rate-limit store and TLS. Before listening, it also verifies that the connected database matches `DB_NAME`, the runtime role is not an administrator or member of a privileged role, does not own public relations/routines/types, lacks schema/database `CREATE` and excess table/sequence privileges, and can read the shared rate-limit table.

The database migration and grants must be applied through an approved database-owner procedure. This repository does not apply migrations automatically at startup.

## Release sequence

1. Rehearse migrations and runtime grants against an isolated restore of a verified backup.
2. Obtain explicit owner approval for production database DDL/privilege changes.
3. Configure the environment and TLS trust chain without placing secrets in source control or logs.
4. Start one application instance and verify startup validation, `/api/test-db`, authentication, CSRF, a read-only user flow, and Admin authorization.
5. Keep one instance until PostgreSQL shared rate-limit behavior and the connection budget are confirmed in the target topology.
6. Deploy only through the approved release process; this assistant did not deploy or change credentials.

See [database permissions](./database-permissions.md) and [shared rate limiter](./shared-rate-limiter.md). The current machine's configured role was read-only inspected and found to be `postgres` with administrative privileges, so it is intentionally rejected by the new production startup guard.
