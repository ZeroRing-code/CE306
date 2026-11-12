ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS target_snapshot jsonb;
