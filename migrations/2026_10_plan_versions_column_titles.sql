-- Plan sheets: edited rows become new versions (the old one is kept, struck
-- through), and Super-Admin-renamable column titles.
--
-- The app's AutoMigrate does this on startup. Run by hand only if your
-- production database is migrated manually. Safe to run more than once.

BEGIN;

ALTER TABLE client_plan_rows ADD COLUMN IF NOT EXISTS lineage_id bigint;
ALTER TABLE client_plan_rows ADD COLUMN IF NOT EXISTS superseded_by_id bigint;
CREATE INDEX IF NOT EXISTS idx_client_plan_rows_lineage_id ON client_plan_rows (lineage_id);

CREATE TABLE IF NOT EXISTS plan_column_labels (
    id            bigserial PRIMARY KEY,
    updated_at    timestamptz,
    plan_type     varchar(20)  NOT NULL,
    field_key     varchar(60)  NOT NULL,
    label         varchar(100) NOT NULL,
    updated_by_id bigint
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_column_label ON plan_column_labels (plan_type, field_key);

COMMIT;
