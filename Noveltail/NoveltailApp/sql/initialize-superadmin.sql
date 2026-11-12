\set ON_ERROR_STOP on

BEGIN;
SELECT pg_advisory_xact_lock(20261112, 1);

DO $bootstrap_check$
DECLARE
    super_admin_count integer;
BEGIN
    SELECT COUNT(*)::integer
    INTO super_admin_count
    FROM users
    WHERE role = 'SUPER_ADMIN';

    IF super_admin_count > 1 THEN
        RAISE EXCEPTION 'More than one SUPER_ADMIN exists; bootstrap stopped.';
    END IF;

    IF super_admin_count = 1 AND NOT EXISTS (
        SELECT 1
        FROM users
        WHERE role = 'SUPER_ADMIN'
          AND username = 'SuperAdmin'
          AND display_name = 'SuperAdmin'
          AND email = 'SuperAdmin@gmail.com'
          AND is_admin = TRUE
          AND account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'The existing SUPER_ADMIN conflicts with the bootstrap account; no changes were made.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM users
        WHERE (
            lower(username) = lower('SuperAdmin')
            OR lower(email) = lower('SuperAdmin@gmail.com')
        )
          AND NOT (
              role = 'SUPER_ADMIN'
              AND username = 'SuperAdmin'
              AND display_name = 'SuperAdmin'
              AND email = 'SuperAdmin@gmail.com'
              AND is_admin = TRUE
              AND account_status = 'active'
          )
    ) THEN
        RAISE EXCEPTION 'A username or email conflicts with the bootstrap account; no changes were made.';
    END IF;
END
$bootstrap_check$;

SELECT COUNT(*)::integer AS superadmin_count
FROM users
WHERE role = 'SUPER_ADMIN'
\gset

\if :superadmin_count
\echo 'The matching SUPER_ADMIN already exists; its credentials and wallet will not be overwritten.'
\else
\getenv superadmin_password_hash NOVELTAIL_SUPERADMIN_BCRYPT_HASH
SELECT :'superadmin_password_hash' ~ '^\$2[aby]\$12\$[./A-Za-z0-9]{53}$'
    AS bootstrap_hash_valid
\gset
\if :bootstrap_hash_valid
INSERT INTO users (
    username, display_name, email, password_hash,
    is_admin, account_status, role
)
VALUES (
    'SuperAdmin', 'SuperAdmin', 'SuperAdmin@gmail.com',
    :'superadmin_password_hash', TRUE, 'active', 'SUPER_ADMIN'
);
\else
\echo 'A valid bcrypt hash using cost 12 is required; no account was created.'
DO $invalid_hash$
BEGIN
    RAISE EXCEPTION 'A valid bcrypt hash using cost 12 is required.';
END
$invalid_hash$;
\endif
\endif

INSERT INTO wallets (user_id, balance)
SELECT user_id, 0
FROM users
WHERE role = 'SUPER_ADMIN'
  AND username = 'SuperAdmin'
  AND email = 'SuperAdmin@gmail.com'
ON CONFLICT (user_id) DO NOTHING;

DO $bootstrap_verify$
DECLARE
    super_admin_count integer;
BEGIN
    SELECT COUNT(*)::integer
    INTO super_admin_count
    FROM users
    WHERE role = 'SUPER_ADMIN';

    IF super_admin_count <> 1 OR NOT EXISTS (
        SELECT 1
        FROM users u
        JOIN wallets w ON w.user_id = u.user_id
        WHERE u.role = 'SUPER_ADMIN'
          AND u.username = 'SuperAdmin'
          AND u.display_name = 'SuperAdmin'
          AND u.email = 'SuperAdmin@gmail.com'
          AND u.is_admin = TRUE
          AND u.account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'SUPER_ADMIN bootstrap verification failed.';
    END IF;
END
$bootstrap_verify$;

COMMIT;

SELECT u.user_id, u.username, u.display_name, u.email, u.role,
       u.account_status, w.balance AS wallet_balance
FROM users u
JOIN wallets w ON w.user_id = u.user_id
WHERE u.role = 'SUPER_ADMIN';
