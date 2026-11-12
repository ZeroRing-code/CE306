BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM admin_action_logs
        WHERE actor_role = 'SYSTEM'
    ) THEN
        RAISE EXCEPTION
            'Cannot remove SYSTEM audit role while SYSTEM audit records exist';
    END IF;
END;
$$;

DROP INDEX IF EXISTS account_suspensions_one_active_per_user;
DROP INDEX IF EXISTS account_suspensions_expiration;

ALTER TABLE admin_action_logs
    DROP CONSTRAINT IF EXISTS admin_action_logs_actor_role_check;

ALTER TABLE admin_action_logs
    ADD CONSTRAINT admin_action_actor_role_check
        CHECK (actor_role IN ('ADMIN', 'SUPER_ADMIN'));

COMMIT;
