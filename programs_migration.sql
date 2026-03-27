USE fundzola;

-- ── Program Sub-Categories Master (admin managed) ─────────────────────────────
CREATE TABLE IF NOT EXISTS program_categories (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  color       VARCHAR(20) DEFAULT '#6366F1',
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_by  INT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_program_category_name (name)
);

-- ── Programs ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS programs (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  program_code     VARCHAR(20) NOT NULL,
  title            VARCHAR(255) NOT NULL,
  description      TEXT,
  estimated_budget DECIMAL(15,2) NOT NULL DEFAULT 0,
  start_date       DATE,
  end_date         DATE,
  status           ENUM('Active','Completed','On Hold','Cancelled') NOT NULL DEFAULT 'Active',
  created_by       INT,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_program_code (program_code)
);

-- Auto-generate program_code (PGM-0001, PGM-0002 …)
DELIMITER $$
CREATE TRIGGER trg_program_before_insert
BEFORE INSERT ON programs
FOR EACH ROW
BEGIN
  IF NEW.program_code IS NULL OR NEW.program_code = '' THEN
    SET NEW.program_code = (
      SELECT CONCAT('PGM-', LPAD(
        IFNULL(MAX(CAST(SUBSTRING(program_code, 5) AS UNSIGNED)), 0) + 1,
        4, '0'))
      FROM programs
    );
  END IF;
END$$
DELIMITER ;

-- ── Budget Allocations (program ↔ category) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS program_budget_allocations (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  program_id       INT NOT NULL,
  category_id      INT NOT NULL,
  allocated_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  notes            TEXT,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_prog_cat (program_id, category_id),
  FOREIGN KEY (program_id)  REFERENCES programs(id)           ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES program_categories(id) ON DELETE CASCADE
);

-- ── Link Deals → Program ──────────────────────────────────────────────────────
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS program_id INT DEFAULT NULL,
  ADD CONSTRAINT fk_deals_program
    FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL;

-- ── Default seed categories (optional) ───────────────────────────────────────
INSERT IGNORE INTO program_categories (name, description, color) VALUES
  ('Infrastructure',      'Physical infrastructure development',      '#F59E0B'),
  ('Education',           'Educational programs and scholarships',     '#3B82F6'),
  ('Healthcare',          'Medical aid and healthcare initiatives',    '#10B981'),
  ('Operations',          'Day-to-day operational expenses',          '#8B5CF6'),
  ('Community Outreach',  'Community engagement activities',          '#EC4899'),
  ('Research',            'Research and development activities',      '#6366F1');
