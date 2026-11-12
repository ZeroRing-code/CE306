BEGIN;

ALTER TABLE wallet_transactions
    ADD COLUMN IF NOT EXISTS reversal_of_transaction_id BIGINT
        REFERENCES wallet_transactions(transaction_id);

CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_one_reversal
    ON wallet_transactions (reversal_of_transaction_id)
    WHERE reversal_of_transaction_id IS NOT NULL;

ALTER TABLE wallet_transactions
    DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;

ALTER TABLE wallet_transactions
    ADD CONSTRAINT wallet_transactions_type_check CHECK (type IN (
        'top_up', 'purchase', 'refund', 'cancel', 'admin_credit',
        'admin_debit', 'creator_earning', 'platform_fee', 'failed'
    ));

ALTER TABLE novels
    ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(16)
        NOT NULL DEFAULT 'active';

ALTER TABLE novels
    DROP CONSTRAINT IF EXISTS novels_moderation_status_check;

ALTER TABLE novels
    ADD CONSTRAINT novels_moderation_status_check
        CHECK (moderation_status IN ('active', 'suspended'));

CREATE INDEX IF NOT EXISTS novels_moderation_status_created
    ON novels (moderation_status, created_at DESC, novel_id DESC);

CREATE INDEX IF NOT EXISTS account_suspensions_user_created
    ON account_suspensions (user_id, suspended_at DESC, suspension_id DESC);

CREATE INDEX IF NOT EXISTS appeals_user_submitted
    ON appeals (user_id, submitted_at DESC, appeal_id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS appeal_assignments_one_active_per_appeal
    ON appeal_assignments (appeal_id)
    WHERE released_at IS NULL;

ALTER TABLE notifications
    DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
    ADD CONSTRAINT notifications_type_check CHECK (type IN (
        'new_novel', 'new_chapter', 'comment', 'comment_reply', 'mention',
        'first_comments', 'follow', 'review', 'like', 'novel_status',
        'appeal_status', 'transaction', 'system'
    ));

COMMIT;
