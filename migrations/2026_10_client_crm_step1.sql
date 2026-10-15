-- Client CRM, step 1: change history for client services and IP /
-- Transmission plans.
--
-- The app's AutoMigrate creates this table on startup, and the new
-- permissions (manage_client_services, view_network_plans,
-- edit_network_plans, view_plan_passwords) are seeded on startup too. Run
-- this by hand only if your production database is migrated manually. Safe
-- to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS client_record_changes (
    id              bigserial PRIMARY KEY,
    created_at      timestamptz,
    client_id       bigint       NOT NULL,
    record_type     varchar(30)  NOT NULL,
    record_id       bigint       NOT NULL,
    action          varchar(20)  NOT NULL,
    field           varchar(60),
    old_value       text,
    new_value       text,
    ticket_id       bigint,
    ticket_number   varchar(40),
    changed_by_id   bigint       NOT NULL,
    changed_by_name varchar(150)
);

CREATE INDEX IF NOT EXISTS idx_client_record_changes_created_at    ON client_record_changes (created_at);
CREATE INDEX IF NOT EXISTS idx_client_change_record                ON client_record_changes (client_id, record_type, record_id);
CREATE INDEX IF NOT EXISTS idx_client_record_changes_ticket_id     ON client_record_changes (ticket_id);
CREATE INDEX IF NOT EXISTS idx_client_record_changes_changed_by_id ON client_record_changes (changed_by_id);

COMMIT;
