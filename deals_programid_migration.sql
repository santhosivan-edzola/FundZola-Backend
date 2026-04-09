USE fundzola;

-- Add program_id to deals (run programs_migration.sql first to create the programs table)
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS program_id INT DEFAULT NULL;

-- Add FK only if programs table exists
ALTER TABLE deals
  ADD CONSTRAINT fk_deals_program
    FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL;
