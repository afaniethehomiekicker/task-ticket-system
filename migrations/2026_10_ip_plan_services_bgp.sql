-- IP Plan rows linked to a client service; BGP plan rows share the table
-- (plan_type = 'bgp').
--
-- The app's AutoMigrate adds this column on startup. Run this by hand only if
-- your production database is migrated manually. Safe to run more than once.

BEGIN;
ALTER TABLE client_plan_rows ADD COLUMN IF NOT EXISTS service_id bigint;
CREATE INDEX IF NOT EXISTS idx_client_plan_rows_service_id ON client_plan_rows (service_id);
COMMIT;
