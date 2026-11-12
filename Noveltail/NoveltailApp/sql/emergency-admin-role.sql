\set ON_ERROR_STOP on

BEGIN;
SELECT pg_advisory_xact_lock(20261112, 1);

SELECT COUNT(*) = 1 AS valid_superadmin
FROM users
WHERE role = 'SUPER_ADMIN'
\gset
\if :valid_superadmin
\else
\echo 'Exactly one SUPER_ADMIN is required; no role was changed.'
DO $invalid_superadmin$
BEGIN
    RAISE EXCEPTION 'Exactly one SUPER_ADMIN is required.';
END
$invalid_superadmin$;
\endif

SELECT :'target_user_id' ~ '^[1-9][0-9]*$' AS valid_target_id,
       :'target_role' IN ('USER', 'ADMIN') AS valid_target_role,
       length(trim(:'reason')) BETWEEN 3 AND 500 AS valid_reason
\gset
\if :valid_target_id
\else
\echo 'A positive target_user_id is required.'
DO $invalid_target_id$
BEGIN
    RAISE EXCEPTION 'A positive target_user_id is required.';
END
$invalid_target_id$;
\endif
\if :valid_target_role
\else
\echo 'target_role must be USER or ADMIN.'
DO $invalid_target_role$
BEGIN
    RAISE EXCEPTION 'target_role must be USER or ADMIN.';
END
$invalid_target_role$;
\endif
\if :valid_reason
\else
\echo 'A 3–500 character reason is required.'
DO $invalid_reason$
BEGIN
    RAISE EXCEPTION 'A 3–500 character reason is required.';
END
$invalid_reason$;
\endif

\set target_can_change false
SELECT role IN ('USER', 'ADMIN') AND role <> :'target_role'
    AS target_can_change
FROM users
WHERE user_id = :'target_user_id'::bigint
FOR UPDATE
\gset
\if :target_can_change
\else
\echo 'Target account was not found, is protected, or already has that role.'
DO $invalid_target$
BEGIN
    RAISE EXCEPTION 'Target account was not found, is protected, or already has that role.';
END
$invalid_target$;
\endif

WITH actor AS (
    SELECT user_id
    FROM users
    WHERE role = 'SUPER_ADMIN'
), target AS (
    SELECT user_id, role, is_admin
    FROM users
    WHERE user_id = :'target_user_id'::bigint
    FOR UPDATE
), changed AS (
    UPDATE users u
    SET role = :'target_role',
        is_admin = (:'target_role' = 'ADMIN'),
        updated_at = CURRENT_TIMESTAMP
    FROM target t
    WHERE u.user_id = t.user_id
      AND t.role IN ('USER', 'ADMIN')
    RETURNING u.user_id, u.role, t.role AS old_role,
              t.is_admin AS old_is_admin
)
INSERT INTO admin_action_logs (
    actor_id, actor_role, target_type, target_id, target_user_id,
    action, reason, old_values, new_values
)
SELECT actor.user_id,
       'SUPER_ADMIN',
       'user',
       changed.user_id,
       changed.user_id,
       CASE WHEN changed.role = 'ADMIN'
            THEN 'admin_role_granted'
            ELSE 'admin_role_revoked'
       END,
       :'reason',
       jsonb_build_object('role', changed.old_role, 'isAdmin', changed.old_is_admin),
       jsonb_build_object('role', changed.role, 'isAdmin', changed.role = 'ADMIN')
FROM actor
CROSS JOIN changed
RETURNING target_id, action;

COMMIT;
