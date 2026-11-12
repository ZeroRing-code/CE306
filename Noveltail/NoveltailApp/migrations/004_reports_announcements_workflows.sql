BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM reports
        WHERE status IN ('pending', 'reviewing')
          AND target_novel_id IS NOT NULL
        GROUP BY reporter_id, target_novel_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate open novel reports must be reviewed before migration 004';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM reports
        WHERE status IN ('pending', 'reviewing')
          AND target_chapter_id IS NOT NULL
        GROUP BY reporter_id, target_chapter_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate open chapter reports must be reviewed before migration 004';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM reports
        WHERE status IN ('pending', 'reviewing')
          AND target_comment_id IS NOT NULL
        GROUP BY reporter_id, target_comment_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate open comment reports must be reviewed before migration 004';
    END IF;
END;
$$;

ALTER TABLE admin_action_logs
    DROP CONSTRAINT IF EXISTS admin_action_target_type_check;

ALTER TABLE admin_action_logs
    ADD CONSTRAINT admin_action_target_type_check
        CHECK (target_type IN (
            'user', 'novel', 'chapter', 'comment', 'review', 'report',
            'appeal', 'wallet', 'system', 'announcement'
        ));

CREATE UNIQUE INDEX IF NOT EXISTS reports_one_open_novel_per_reporter
    ON reports (reporter_id, target_novel_id)
    WHERE target_novel_id IS NOT NULL AND status IN ('pending', 'reviewing');

CREATE UNIQUE INDEX IF NOT EXISTS reports_one_open_chapter_per_reporter
    ON reports (reporter_id, target_chapter_id)
    WHERE target_chapter_id IS NOT NULL AND status IN ('pending', 'reviewing');

CREATE UNIQUE INDEX IF NOT EXISTS reports_one_open_comment_per_reporter
    ON reports (reporter_id, target_comment_id)
    WHERE target_comment_id IS NOT NULL AND status IN ('pending', 'reviewing');

COMMIT;
