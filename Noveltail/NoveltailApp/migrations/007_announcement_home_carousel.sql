BEGIN;

ALTER TABLE public.announcements
    ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS pin_order INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS link_url TEXT,
    ADD COLUMN IF NOT EXISTS link_label TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.announcements'::regclass
          AND conname = 'announcements_pin_order_check'
    ) THEN
        ALTER TABLE public.announcements
            ADD CONSTRAINT announcements_pin_order_check
                CHECK (pin_order BETWEEN 0 AND 9999);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.announcements'::regclass
          AND conname = 'announcements_link_pair_check'
    ) THEN
        ALTER TABLE public.announcements
            ADD CONSTRAINT announcements_link_pair_check
                CHECK (
                    (link_url IS NULL AND link_label IS NULL)
                    OR (
                        link_url IS NOT NULL
                        AND char_length(link_url) BETWEEN 1 AND 2048
                        AND link_label IS NOT NULL
                        AND char_length(link_label) BETWEEN 1 AND 100
                    )
                );
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS announcements_home_pins_idx
    ON public.announcements (
        pin_order, published_at DESC, announcement_id DESC
    )
    WHERE is_pinned AND status = 'published';

COMMIT;
