BEGIN;

ALTER TABLE admin_action_logs
    DROP CONSTRAINT IF EXISTS admin_action_actor_role_check;

ALTER TABLE admin_action_logs
    DROP CONSTRAINT IF EXISTS admin_action_logs_actor_role_check;

ALTER TABLE admin_action_logs
    ADD CONSTRAINT admin_action_logs_actor_role_check
        CHECK (actor_role IN ('ADMIN', 'SUPER_ADMIN', 'SYSTEM'));

CREATE UNIQUE INDEX IF NOT EXISTS account_suspensions_one_active_per_user
    ON account_suspensions (user_id)
    WHERE restored_at IS NULL;

CREATE INDEX IF NOT EXISTS account_suspensions_expiration
    ON account_suspensions (suspended_until, user_id)
    WHERE restored_at IS NULL AND suspended_until IS NOT NULL;

COMMIT;
