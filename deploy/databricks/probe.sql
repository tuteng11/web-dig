BEGIN;
CREATE SCHEMA IF NOT EXISTS news_trace;
CREATE TABLE IF NOT EXISTS news_trace.capability_probe (
    probe_id text PRIMARY KEY CHECK (probe_id IN ('web', 'research')),
    first_seen timestamptz NOT NULL DEFAULT now()
);
COMMIT;
