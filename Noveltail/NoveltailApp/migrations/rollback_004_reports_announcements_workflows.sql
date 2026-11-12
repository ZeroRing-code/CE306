BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM admin_action_logs
        WHERE target_type = 'announcement'
    ) THEN
        RAISE EXCEPTION
            'Cannot remove announcement audit support while announcement action logs exist';
    END IF;
END;
$$;

DROP INDEX IF EXISTS reports_one_open_novel_per_reporter;
DROP INDEX IF EXISTS reports_one_open_chapter_per_reporter;
DROP INDEX IF EXISTS reports_one_open_comment_per_reporter;

ALTER TABLE admin_action_logs
    DROP CONSTRAINT IF EXISTS admin_action_target_type_check;

ALTER TABLE admin_action_logs
    ADD CONSTRAINT admin_action_target_type_check
        CHECK (target_type IN (
            'user', 'novel', 'chapter', 'comment', 'review', 'report',
            'appeal', 'wallet', 'system'
        ));

COMMIT;
