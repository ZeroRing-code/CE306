BEGIN;

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
    bucket_key TEXT PRIMARY KEY,
    hits INTEGER NOT NULL CHECK (hits > 0),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limit_buckets_expires_at_idx
    ON public.rate_limit_buckets (expires_at);

COMMIT;
