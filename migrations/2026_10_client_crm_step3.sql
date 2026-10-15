-- Client CRM, step 3: IP Plan rows (the Transmission Plan in step 4 uses the
-- same table).
--
-- The app's AutoMigrate creates this table on startup. Run this by hand only
-- if your production database is migrated manually. Safe to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS client_plan_rows (
    id              bigserial PRIMARY KEY,
    created_at      timestamptz,
    updated_at      timestamptz,
    client_id       bigint      NOT NULL,
    plan_type       varchar(20) NOT NULL,
    data            jsonb,
    secret          text,
    removed         boolean     NOT NULL DEFAULT false,
    removed_at      timestamptz,
    version         bigint      NOT NULL DEFAULT 1,
    ticket_id       bigint,
    ticket_number   varchar(40),
    created_by_id   bigint,
    updated_by_id   bigint,
    updated_by_name varchar(150)
);

CREATE INDEX IF NOT EXISTS idx_client_plan_rows            ON client_plan_rows (client_id, plan_type);
CREATE INDEX IF NOT EXISTS idx_client_plan_rows_ticket_id  ON client_plan_rows (ticket_id);

COMMIT;
