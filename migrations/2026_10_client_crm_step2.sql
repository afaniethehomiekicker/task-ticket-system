-- Client CRM, step 2: client products & services.
--
-- The app's AutoMigrate creates this table on startup and the SVC- ID
-- counter is seeded on startup too. Run this by hand only if your
-- production database is migrated manually. Safe to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS client_services (
    id              bigserial PRIMARY KEY,
    created_at      timestamptz,
    updated_at      timestamptz,
    service_number  varchar(20),
    client_id       bigint       NOT NULL,
    product         varchar(100) NOT NULL,
    location        varchar(255),
    capacity        varchar(100),
    vendor_id       bigint,
    vendor_name     varchar(150),
    arrangement     varchar(20),
    activation_date timestamptz,
    status          varchar(20)  NOT NULL DEFAULT 'pending',
    closed_at       timestamptz,
    ticket_id       bigint,
    ticket_number   varchar(40),
    notes           text,
    created_by_id   bigint,
    updated_by_id   bigint
);

CREATE INDEX IF NOT EXISTS idx_client_services_service_number ON client_services (service_number);
CREATE INDEX IF NOT EXISTS idx_client_services_client_id      ON client_services (client_id);
CREATE INDEX IF NOT EXISTS idx_client_services_vendor_id      ON client_services (vendor_id);
CREATE INDEX IF NOT EXISTS idx_client_services_status         ON client_services (status);
CREATE INDEX IF NOT EXISTS idx_client_services_ticket_id      ON client_services (ticket_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_client_services_service_number ON client_services (service_number) WHERE service_number <> '';

COMMIT;
