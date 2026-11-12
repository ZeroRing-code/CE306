\set ON_ERROR_STOP on
\getenv superadmin_password_hash NOVELTAIL_SUPERADMIN_BCRYPT_HASH
SELECT :'superadmin_password_hash' ~ '^\$2[aby]\$12\$[./A-Za-z0-9]{53}$'
    AS bootstrap_hash_valid
\gset
\if :bootstrap_hash_valid
\else
\echo 'A valid bcrypt hash using cost 12 is required; no account was changed.'
DO $invalid_hash$
BEGIN
    RAISE EXCEPTION 'A valid bcrypt hash using cost 12 is required.';
END
$invalid_hash$;
\endif

BEGIN;
SELECT pg_advisory_xact_lock(20261112, 1);

DO $reset_check$
BEGIN
    IF (SELECT COUNT(*) FROM users WHERE role = 'SUPER_ADMIN') <> 1
       OR NOT EXISTS (
           SELECT 1
           FROM users
           WHERE role = 'SUPER_ADMIN'
             AND username = 'SuperAdmin'
             AND display_name = 'SuperAdmin'
             AND email = 'SuperAdmin@gmail.com'
             AND is_admin = TRUE
       ) THEN
        RAISE EXCEPTION 'The expected single SUPER_ADMIN was not found; no account was changed.';
    END IF;
END
$reset_check$;

UPDATE users
SET password_hash = :'superadmin_password_hash',
    updated_at = CURRENT_TIMESTAMP
WHERE role = 'SUPER_ADMIN'
  AND username = 'SuperAdmin'
  AND display_name = 'SuperAdmin'
  AND email = 'SuperAdmin@gmail.com'
  AND is_admin = TRUE
RETURNING user_id, username, role;

COMMIT;
