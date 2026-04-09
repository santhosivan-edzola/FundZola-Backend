USE fundzola;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS program_id INT DEFAULT NULL,
  ADD CONSTRAINT fk_deals_program
    FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL;
  