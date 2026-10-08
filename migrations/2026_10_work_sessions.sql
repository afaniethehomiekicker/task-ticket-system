-- "I'm working on this" markers on tasks / tickets / projects.
--
-- The app's AutoMigrate creates this table on startup by itself. Run this by
-- hand only if your production database is migrated manually. Safe to run
-- more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS work_sessions (
    id          bigserial PRIMARY KEY,
    started_at  timestamptz NOT NULL,
    user_id     bigint      NOT NULL,
    record_type varchar(20) NOT NULL,
    record_id   bigint      NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_session        ON work_sessions (user_id, record_type, record_id);
CREATE INDEX        IF NOT EXISTS idx_work_sessions_user_id ON work_sessions (user_id);
CREATE INDEX        IF NOT EXISTS idx_work_session_record ON work_sessions (record_type, record_id);

COMMIT;
