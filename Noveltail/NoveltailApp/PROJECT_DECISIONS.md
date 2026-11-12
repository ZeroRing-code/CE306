# Noveltail project decisions

## Confirmed product decisions

- Noveltail is a university project and does not process real money.
- Wallet top-ups are simulated, immediate, and use only the fixed packages 50, 100, 300, 500, and 1,000 coins.
- New accounts start with zero coins; packages cannot be edited in a dashboard.
- Top-up and purchase requests use an idempotency key; the server owns all balance calculations.
- Chapter sales are per chapter. Chapters default to free, and existing unlocks survive later price/status changes.
- Chapter revenue is split 90% to the writer and 10% recorded as the platform share; fractional coins are rounded down for the writer and the remainder is the platform share.
- Wallet balances cannot be negative. Every successful balance change and every recorded failure has an append-only ledger row.
- Notification categories are System, Account, Novel, Engagement, and Transaction. Notifications are not polled or pushed in real time.
- Notification bulk deletion is scoped to the requesting user's matching notifications and uses a confirmation snapshot so later notifications are not included.
- PostgreSQL remains the persistence layer; no ORM or payment gateway is introduced.

## Existing implementation discovered

- Authentication uses the existing `noveltail_token` cookie and `/api/auth/me`.
- Administrator access uses the existing `users.role` values `USER`, `ADMIN`, and `SUPER_ADMIN`; `is_admin` is retained for compatibility.
- The single SUPER_ADMIN is initialized and changed only through SQL; role APIs never accept SUPER_ADMIN. Only SUPER_ADMIN may promote USER to ADMIN or demote ADMIN to USER, with each actual change recorded in the existing admin action log.
- Existing chapter read/write endpoints and the `notifications`, `follows`, and `comments` tables are retained.
- The configured development database is `Noveltail`.
- Schema changes are in `migrations/001_wallet_paid_chapters_notifications.sql` and `migrations/002_reversals_moderation_appeals.sql`.
- Public novel visibility is controlled by `novels.moderation_status`, separate from the writer-managed publication status.

## Migration policy

- Schema changes are kept in ordered, rerunnable SQL migration files under `migrations/`.
- Account suspension workflow schema additions are in `migrations/003_account_suspension_workflow.sql`; Reports/Announcements workflow indexes and audit target support are in `migrations/004_reports_announcements_workflows.sql`; shared PostgreSQL rate-limit storage is in `migrations/005_shared_rate_limit_store.sql`; report target snapshots are in `migrations/006_report_target_snapshots.sql`; Home announcement pinning, ordering, and links are in `migrations/007_announcement_home_carousel.sql`. The isolated test runner replays migrations 001–007 twice. Following explicit owner authorization on 2026-11-12, migrations 005–007 were applied to the configured local `Noveltail` database after disposable testing and a verified full backup restore; no role/GRANT/REVOKE changes were made.
- Migrations preserve existing user, novel, chapter, notification, suspension, appeal, and admin-log records.
- No migration or endpoint is allowed to accept a client-supplied wallet balance.
- `npm test` and `npm run test:e2e` create a disposable database using `pg_dump`/`pg_restore`, replay migrations on that copy, run tests against it, and remove it afterward. The source database is not modified by the test runner.

## Authorized local schema migration execution (2026-11-12)

- A full custom-format database backup was created outside the Repository. It was restored into a disposable database and verified by comparing all public table row counts, sequence values, and counts of tables, indexes, sequences, functions, triggers, and constraints.
- Migrations 005, 006, and 007 were then applied in order to `Noveltail` on `localhost:5432`. Existing table row counts remained unchanged; the new rate-limit table is empty. The resulting schema has 29 public tables, one SUPER_ADMIN, one wallet, and 13 genres.
- No migration ledger table exists. Migration state was verified from the actual schema; no ledger was invented or populated.
- This owner authorization covers these schema migrations on the local Noveltail target only. It does not approve production role/grant changes or production deployment. Historical runtime-permission decisions below remain in force for those separate gates.
- The production startup guard also rejects a replication-capable role and UPDATE/DELETE access to `wallet_transactions`; regression tests exercise the guard and ledger grants on disposable PostgreSQL.

## Runtime permission owner decisions

Recorded 2026-11-11 by the **Project Owner**. Decision status does not authorize implementation; the [final owner decision](./docs/runtime-permission-final-owner-decision.md#decision-register) records the reasons and remaining conditions.

| Topic | Decision | Decision status | Implementation status | Verification status |
|---|---|---|---|---|
| PUBLIC TEMPORARY | Approve revocation. | **APPROVED** | **PENDING** | **PENDING** |
| PUBLIC EXECUTE | Approve revocation only for unnecessary functions while preserving registration and its trigger. | **APPROVED** | **PENDING** | **PENDING** |
| Raw ACL drift | Permit only baseline-allowlisted NULL-to-original-owner-default ACL drift, subject to all recorded invariants. | **APPROVED** | **COMPLETED** for disposable verifier; **BLOCKED** for mandatory production integration | **COMPLETED** on synthetic PostgreSQL; **BLOCKED** on actual target |
| Migration 005 | Approve separation of Migration Owner and Runtime Role; real migration 005 is not approved. | **APPROVED** (separation) | **COMPLETED** for disposable owner and startup guard; **PENDING** for production | **COMPLETED** for disposable limiter; **BLOCKED** for integrated post-005 deployment |
| Production deployment | Deployment authorization is not yet decided. | **PENDING** | **BLOCKED** | **BLOCKED** |

On 2026-11-11 a read-only target catalog baseline and a 23-object **candidate** pre-005 allowlist were captured, not signed or approved for deployment. Actual migration 005 and the proposed limiter permissions passed a separate-owner disposable test; real migration execution, its revised 29-table matrix and the mandatory gateway remain **BLOCKED**. The 23 is derived from that baseline and is not a policy constant. See the [current evidence and blockers](./runtime-validation-report.md#final-runtime-permission-workstream-closure--2026-11-11).

**Later execution update:** the owner authorization dated 2026-11-12 superseded the earlier prohibition only for applying schema migrations 005–007 to the backed-up local Noveltail database, and that local application is complete. It did not change the separate production-permission/deployment gates or approve changing PostgreSQL roles/ACLs.

## Refund, cancellation, moderation, and appeal decisions

- Only `ADMIN` and `SUPER_ADMIN` may refund chapter purchases or cancel simulated top-ups.
- A reversal is rejected if its required debit would make a wallet balance negative. Reversals are separate ledger entries linked to their source; source entries are not edited or deleted.
- Refunding a chapter purchase reverses the existing 90/10 creator/platform allocations and removes that purchase's chapter unlock. The 90/10 rule is unchanged.
- Novel moderation status is independent of writing/publication status. Admin actions record old/new status and an internal reason; owner notifications do not expose internal reasons.
- An appeal may be submitted once and resubmitted up to three more times for each suspension, for a maximum of four attempts. Account appeal acceptance restores the account to `active`.
- The first administrator to take an appeal owns it. Another administrator may take over only after more than seven days without progress; assignment changes are retained.
- User-facing appeal decisions use `decision_note`; internal administrator reasons remain in the admin action log and are not included in notifications.
- Admin chapter editing is not part of this implementation. Existing chapter revision history remains available to the existing writer workflow.
- ADMIN may suspend USER accounts; SUPER_ADMIN may suspend USER or ADMIN accounts. Administrators cannot suspend themselves or a SUPER_ADMIN through the account suspension API.
- Only active administrators may access appeal-administration endpoints; suspended users retain access only to their own appeal flows.
- Suspended accounts are checked against the database on authenticated requests. Suspended users retain access only to appeal flows; expired suspensions are restored on demand when the account is checked, with audit and notification records.
- Appeal acceptance restores an account to `active`; rejection leaves the suspension in place.
- Comment owners may edit their comments; edits do not create a second comment or a new comment notification.
- All unsafe browser/API requests require same-origin Origin/Referer validation and a short-lived signed double-submit CSRF token. The existing JWT authentication cookie remains HttpOnly and SameSite=Lax.
- Authentication, comments, reviews, Appeals, Reports, Wallet, and Admin actions use category-specific rate limits. Development may use the in-memory store; production requires the shared PostgreSQL store, which uses atomic counters and fails closed if unavailable. Multi-instance deployment remains blocked until Migration 005 is approved and applied to the target database.
- Users can report novels, chapters, and comments using the reasons allowed by the existing `reports` constraint. One open report per reporter and target is allowed at a time; it can be reported again after its status is resolved or rejected. Admin status changes are audited; the allowed flow is `pending` to `reviewing`/`resolved`/`rejected`, then `reviewing` to `resolved`/`rejected`.
- Announcements use the existing `all`, `individual`, and `group` audiences, with audience snapshots stored in `announcement_recipients` at first publication. Each delivered recipient gets one `system` notification, and recipient read state is stored in the existing recipient table. Scheduled announcements are published by the server worker; cancelled and draft announcements are not visible to users.
- Home announcements are explicitly pinned by an administrator and ordered by `pin_order`; only currently published, unexpired announcements are returned. The `all` audience may be shown to guests, while individual/group audiences require the viewer's existing recipient snapshot. Links are limited to HTTP(S) or safe internal paths and are rendered as text/DOM nodes rather than HTML.

## Validation and remaining gaps

- `npm test` runs isolated API coverage for Wallet reversals, moderation, Appeals, Account Suspension, Bookmark, Comment, Review, Reaction, Reading History, Reports, and Announcements, including pinned announcement safety, visibility, ordering, unpublish, and delete workflows; the runner replays numbered migrations twice.
- Administrator role hierarchy is checked explicitly: SUPER_ADMIN management scope is evaluated before the legacy `is_admin` compatibility flag, so SUPER_ADMIN can manage ADMIN accounts without widening ADMIN permissions.
- `npm run test:e2e` runs Playwright in Chromium against a disposable database. Current browser coverage also includes user content reports, admin report decisions, announcement preview/publication/read status, Home carousel controls and safe links, reduced-motion behavior, and USER/ADMIN/SUPER_ADMIN access.
- Responsive automated checks cover widths 360, 390, 430, 768, 1024, 1280, 1440, and 1920px. Theme checks cover the main pages at 390px and 1440px in Light and Dark modes; automated checks are not a manual visual sign-off for every browser/device.
- The read-only `npm run migration:check` reports required schema, role constraint, and duplicate active suspensions without applying a migration. Migration 003 is transactional and has a guarded rollback script; the source database is never migrated by the test runner.
- The test runner applies migrations only to the schema-only clone and synthetic disposable databases. It does not migrate the configured source database; the separately authorized local schema application above is not part of test execution. Other targets require the normal reviewed deployment process.
