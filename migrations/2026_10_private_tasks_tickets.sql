-- Private tasks / tickets + department-wide visibility.
--
-- The app's AutoMigrate adds these columns on startup by itself. Run this by
-- hand only if your production database is migrated manually. Safe to run
-- more than once.
--
-- Existing rows become NOT private (false), i.e. visible read-only to
-- everyone in their department. If you'd rather start with everything
-- private, change both DEFAULT false lines to true for the ADD, then set
-- the default back to false afterwards.

BEGIN;

ALTER TABLE tasks   ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

-- The department lookups compare LOWER(TRIM(department)); these keep the
-- department-wide lists fast with thousands of records.
CREATE INDEX IF NOT EXISTS idx_tasks_dept_lower       ON tasks   (LOWER(TRIM(department)));
CREATE INDEX IF NOT EXISTS idx_tickets_dept_lower     ON tickets (LOWER(TRIM(department)));
CREATE INDEX IF NOT EXISTS idx_tickets_origin_lower   ON tickets (LOWER(TRIM(origin_department)));

COMMIT;
