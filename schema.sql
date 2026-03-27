-- ============================================================
--  FUNDZOLA - Complete Database Schema
--  Donor & Donation Management System
--  MySQL 8.0+  |  utf8mb4_unicode_ci
-- ============================================================

CREATE DATABASE IF NOT EXISTS fundzola
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE fundzola;


-- ============================================================
--  1. ORGANIZATIONS
--  Singleton table: stores the NGO / trust details used on
--  80G receipts and printed correspondence.
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
  id                    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  org_name              VARCHAR(200)  NOT NULL,
  address               TEXT,
  city                  VARCHAR(100),
  state                 VARCHAR(100),
  pincode               VARCHAR(10),
  phone                 VARCHAR(20),
  email                 VARCHAR(150),
  registration_number   VARCHAR(100),          -- Trust / NGO registration number
  pan_80g               VARCHAR(10),           -- 80G registration PAN
  signatory_name        VARCHAR(150),
  signatory_designation VARCHAR(100),
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB;


-- ============================================================
--  2. APP_USERS
--  Authentication accounts with role-based access.
-- ============================================================
CREATE TABLE IF NOT EXISTS app_users (
  id            INT          NOT NULL AUTO_INCREMENT,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255),
  role          ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_user_email (email)
) ENGINE=InnoDB;


-- ============================================================
--  3. USER_PERMISSIONS
--  Module-level CRUD permissions per user.
--  Modules: donors, donations, expenses, deals, programs,
--           program-categories, users, organizations
-- ============================================================
CREATE TABLE IF NOT EXISTS user_permissions (
  id         INT         NOT NULL AUTO_INCREMENT,
  user_id    INT         NOT NULL,
  module     VARCHAR(50) NOT NULL,
  can_view   BOOLEAN     NOT NULL DEFAULT TRUE,
  can_create BOOLEAN     NOT NULL DEFAULT FALSE,
  can_edit   BOOLEAN     NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN     NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_module (user_id, module),
  CONSTRAINT fk_perm_user
    FOREIGN KEY (user_id) REFERENCES app_users (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;


-- ============================================================
--  4. DONORS
--  Donor master with soft-delete (is_active flag).
--  donor_code is auto-generated via trigger (DNR-0001 …).
-- ============================================================
CREATE TABLE IF NOT EXISTS donors (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  donor_code  VARCHAR(20)  NOT NULL,               -- e.g. DNR-0001
  name        VARCHAR(200) NOT NULL,
  email       VARCHAR(150) NOT NULL,
  phone       VARCHAR(20),
  address     TEXT,
  pan_number  VARCHAR(10),                          -- AAAAA9999A format
  donor_type  ENUM(
                'Individual',
                'Corporate',
                'Trust',
                'Society',
                'Foundation',
                'Other'
              ) NOT NULL DEFAULT 'Individual',
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,      -- 0 = soft-deleted
  created_by  INT,                                  -- FK to app_users.id
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_donor_code  (donor_code),
  UNIQUE KEY uq_donor_email (email),
  INDEX idx_donor_pan    (pan_number),
  INDEX idx_donor_name   (name),
  INDEX idx_donor_active (is_active)
) ENGINE=InnoDB;


-- ============================================================
--  5. DONATIONS
--  One row per received donation; links to the donor.
--  receipt_number is auto-generated (FZ-YYYY-NNNN).
-- ============================================================
CREATE TABLE IF NOT EXISTS donations (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  receipt_number  VARCHAR(20)   NOT NULL,            -- e.g. FZ-2026-0001
  donor_id        INT UNSIGNED  NOT NULL,
  amount          DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  donation_date   DATE          NOT NULL,
  payment_mode    ENUM(
                    'Cash',
                    'Cheque',
                    'NEFT/RTGS',
                    'UPI',
                    'Demand Draft',
                    'Online Transfer'
                  ) NOT NULL,
  cheque_number   VARCHAR(50),                       -- for Cheque / Demand Draft
  bank_name       VARCHAR(150),                      -- for Cheque / DD / NEFT
  transaction_ref VARCHAR(100),                      -- for UPI / Online Transfer
  fund_category   ENUM(
                    'Education',
                    'Healthcare',
                    'Infrastructure',
                    'Relief Fund',
                    'Scholarship',
                    'Research',
                    'Environment',
                    'Women Empowerment',
                    'Child Welfare',
                    'General'
                  ) NOT NULL DEFAULT 'General',
  purpose         VARCHAR(500),
  is_80g_eligible TINYINT(1)    NOT NULL DEFAULT 1,
  notes           TEXT,
  created_by      INT,                               -- FK to app_users.id
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_receipt_number (receipt_number),
  CONSTRAINT fk_donation_donor
    FOREIGN KEY (donor_id) REFERENCES donors (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  INDEX idx_donation_donor (donor_id),
  INDEX idx_donation_date  (donation_date),
  INDEX idx_donation_fund  (fund_category),
  INDEX idx_donation_80g   (is_80g_eligible)
) ENGINE=InnoDB;


-- ============================================================
--  6. EXPENSES
--  Fund utilization records; optionally linked to a donation.
-- ============================================================
CREATE TABLE IF NOT EXISTS expenses (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  donation_id    INT UNSIGNED,                       -- optional link to one donation
  fund_category  ENUM(
                   'Education',
                   'Healthcare',
                   'Infrastructure',
                   'Relief Fund',
                   'Scholarship',
                   'Research',
                   'Environment',
                   'Women Empowerment',
                   'Child Welfare',
                   'General'
                 ) NOT NULL DEFAULT 'General',
  description    VARCHAR(500)  NOT NULL,
  amount         DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  expense_date   DATE          NOT NULL,
  category       ENUM(
                   'Salaries',
                   'Operations',
                   'Events',
                   'Infrastructure',
                   'Medical Aid',
                   'Educational Aid',
                   'Administrative',
                   'Travel',
                   'Equipment',
                   'Other'
                 ) NOT NULL DEFAULT 'Other',
  vendor         VARCHAR(200),
  invoice_number VARCHAR(100),
  payment_mode   ENUM(
                   'Cash',
                   'Cheque',
                   'NEFT/RTGS',
                   'UPI',
                   'Demand Draft',
                   'Online Transfer'
                 ),
  approved_by    VARCHAR(150),
  notes          TEXT,
  created_by     INT,                                -- FK to app_users.id
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_expense_donation
    FOREIGN KEY (donation_id) REFERENCES donations (id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  INDEX idx_expense_donation (donation_id),
  INDEX idx_expense_date     (expense_date),
  INDEX idx_expense_fund     (fund_category),
  INDEX idx_expense_category (category)
) ENGINE=InnoDB;


-- ============================================================
--  7. RECEIPT_LOG
--  Audit trail: one row each time an 80G receipt is generated
--  or reprinted.
-- ============================================================
CREATE TABLE IF NOT EXISTS receipt_log (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  donation_id    INT UNSIGNED NOT NULL,
  receipt_number VARCHAR(20)  NOT NULL,
  generated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  generated_by   VARCHAR(100),
  PRIMARY KEY (id),
  CONSTRAINT fk_receipt_donation
    FOREIGN KEY (donation_id) REFERENCES donations (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  INDEX idx_receipt_donation (donation_id)
) ENGINE=InnoDB;


-- ============================================================
--  8. PROGRAM_CATEGORIES
--  Admin-managed master list of program sub-categories.
-- ============================================================
CREATE TABLE IF NOT EXISTS program_categories (
  id          INT         NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  color       VARCHAR(20) NOT NULL DEFAULT '#6366F1',
  is_active   TINYINT(1)  NOT NULL DEFAULT 1,
  created_by  INT,                                   -- FK to app_users.id
  created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_program_category_name (name)
) ENGINE=InnoDB;


-- ============================================================
--  9. PROGRAMS
--  Charitable programs and initiatives.
--  program_code is auto-generated via trigger (PGM-0001 …).
-- ============================================================
CREATE TABLE IF NOT EXISTS programs (
  id               INT           NOT NULL AUTO_INCREMENT,
  program_code     VARCHAR(20)   NOT NULL,           -- e.g. PGM-0001
  title            VARCHAR(255)  NOT NULL,
  description      TEXT,
  estimated_budget DECIMAL(15,2) NOT NULL DEFAULT 0,
  start_date       DATE,
  end_date         DATE,
  status           ENUM('Active', 'Completed', 'On Hold', 'Cancelled') NOT NULL DEFAULT 'Active',
  created_by       INT,                              -- FK to app_users.id
  created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_program_code (program_code)
) ENGINE=InnoDB;


-- ============================================================
--  10. PROGRAM_BUDGET_ALLOCATIONS
--  Junction table: distributes a program's budget across
--  program categories.
-- ============================================================
CREATE TABLE IF NOT EXISTS program_budget_allocations (
  id               INT           NOT NULL AUTO_INCREMENT,
  program_id       INT           NOT NULL,
  category_id      INT           NOT NULL,
  allocated_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  notes            TEXT,
  created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_prog_cat (program_id, category_id),
  CONSTRAINT fk_alloc_program
    FOREIGN KEY (program_id)  REFERENCES programs (id)           ON DELETE CASCADE,
  CONSTRAINT fk_alloc_category
    FOREIGN KEY (category_id) REFERENCES program_categories (id) ON DELETE CASCADE
) ENGINE=InnoDB;


-- ============================================================
--  11. DEALS
--  Prospective donations / fundraising pipeline.
--  Linked to both a donor and optionally a program.
-- ============================================================
CREATE TABLE IF NOT EXISTS deals (
  id            INT           NOT NULL AUTO_INCREMENT,
  donor_id      INT UNSIGNED  NOT NULL,
  program_id    INT           DEFAULT NULL,          -- optional program link
  title         VARCHAR(255)  NOT NULL,
  amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
  stage         VARCHAR(50)   NOT NULL DEFAULT 'Prospect',
  priority      VARCHAR(20)   NOT NULL DEFAULT 'Medium',
  notes         TEXT,
  expected_date DATE,
  actual_date   DATE,
  created_by    INT,                                 -- FK to app_users.id
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_deals_donor
    FOREIGN KEY (donor_id)   REFERENCES donors (id)   ON DELETE CASCADE,
  CONSTRAINT fk_deals_program
    FOREIGN KEY (program_id) REFERENCES programs (id) ON DELETE SET NULL,
  INDEX idx_deals_donor   (donor_id),
  INDEX idx_deals_program (program_id),
  INDEX idx_deals_stage   (stage)
) ENGINE=InnoDB;


-- ============================================================
--  VIEWS
-- ============================================================

-- V1: Fund utilization summary per category
CREATE OR REPLACE VIEW vw_fund_utilization AS
SELECT
  fc.fund_category,
  COALESCE(d.total_donated,  0.00) AS total_donated,
  COALESCE(e.total_expended, 0.00) AS total_expended,
  COALESCE(d.total_donated,  0.00)
    - COALESCE(e.total_expended, 0.00) AS balance,
  CASE
    WHEN COALESCE(d.total_donated, 0) = 0 THEN 0
    ELSE ROUND(COALESCE(e.total_expended, 0) / d.total_donated * 100, 2)
  END AS utilization_pct,
  COALESCE(d.donation_count, 0) AS donation_count,
  COALESCE(e.expense_count,  0) AS expense_count
FROM (
  SELECT 'Education'        AS fund_category UNION ALL
  SELECT 'Healthcare'                        UNION ALL
  SELECT 'Infrastructure'                    UNION ALL
  SELECT 'Relief Fund'                       UNION ALL
  SELECT 'Scholarship'                       UNION ALL
  SELECT 'Research'                          UNION ALL
  SELECT 'Environment'                       UNION ALL
  SELECT 'Women Empowerment'                 UNION ALL
  SELECT 'Child Welfare'                     UNION ALL
  SELECT 'General'
) fc
LEFT JOIN (
  SELECT fund_category,
         SUM(amount) AS total_donated,
         COUNT(*)    AS donation_count
  FROM   donations
  GROUP  BY fund_category
) d ON d.fund_category = fc.fund_category
LEFT JOIN (
  SELECT fund_category,
         SUM(amount) AS total_expended,
         COUNT(*)    AS expense_count
  FROM   expenses
  GROUP  BY fund_category
) e ON e.fund_category = fc.fund_category;


-- V2: Per-donor financial summary (active donors only)
CREATE OR REPLACE VIEW vw_donor_summary AS
SELECT
  dn.id                                AS donor_id,
  dn.donor_code,
  dn.name                              AS donor_name,
  dn.pan_number,
  dn.donor_type,
  dn.email,
  COALESCE(d.total_donated,  0.00)    AS total_donated,
  COALESCE(e.total_expended, 0.00)    AS total_expended,
  COALESCE(d.total_donated,  0.00)
    - COALESCE(e.total_expended, 0.00) AS balance,
  COALESCE(d.donation_count, 0)       AS donation_count,
  d.last_donation_date
FROM donors dn
LEFT JOIN (
  SELECT donor_id,
         SUM(amount)        AS total_donated,
         COUNT(*)           AS donation_count,
         MAX(donation_date) AS last_donation_date
  FROM   donations
  GROUP  BY donor_id
) d ON d.donor_id = dn.id
LEFT JOIN (
  SELECT don.donor_id,
         SUM(ex.amount) AS total_expended
  FROM   expenses  ex
  JOIN   donations don ON don.id = ex.donation_id
  GROUP  BY don.donor_id
) e ON e.donor_id = dn.id
WHERE dn.is_active = 1;


-- V3: Full donation detail with joined donor information
CREATE OR REPLACE VIEW vw_donation_detail AS
SELECT
  d.id,
  d.receipt_number,
  d.donor_id,
  dn.name       AS donor_name,
  dn.pan_number AS donor_pan,
  dn.email      AS donor_email,
  dn.phone      AS donor_phone,
  dn.address    AS donor_address,
  d.amount,
  d.donation_date,
  d.payment_mode,
  d.cheque_number,
  d.bank_name,
  d.transaction_ref,
  d.fund_category,
  d.purpose,
  d.is_80g_eligible,
  d.notes,
  d.created_at
FROM donations d
JOIN donors dn ON dn.id = d.donor_id;


-- ============================================================
--  STORED PROCEDURES
-- ============================================================

DELIMITER $$

-- SP1: Next receipt number for the current year (FZ-YYYY-NNNN)
CREATE PROCEDURE sp_next_receipt_number (OUT p_receipt_number VARCHAR(20))
BEGIN
  DECLARE v_year  CHAR(4);
  DECLARE v_count INT;
  SET v_year  = YEAR(CURDATE());
  SELECT COUNT(*) INTO v_count
  FROM   donations
  WHERE  YEAR(donation_date) = v_year;
  SET p_receipt_number = CONCAT('FZ-', v_year, '-', LPAD(v_count + 1, 4, '0'));
END$$

-- SP2: Next donor code (DNR-NNNN)
CREATE PROCEDURE sp_next_donor_code (OUT p_donor_code VARCHAR(20))
BEGIN
  DECLARE v_count INT;
  SELECT COUNT(*) INTO v_count FROM donors;
  SET p_donor_code = CONCAT('DNR-', LPAD(v_count + 1, 4, '0'));
END$$

DELIMITER ;


-- ============================================================
--  TRIGGERS
-- ============================================================

DELIMITER $$

-- Auto-generate donor_code on INSERT if not provided
CREATE TRIGGER trg_donor_before_insert
BEFORE INSERT ON donors
FOR EACH ROW
BEGIN
  IF NEW.donor_code IS NULL OR NEW.donor_code = '' THEN
    CALL sp_next_donor_code(@dc);
    SET NEW.donor_code = @dc;
  END IF;
END$$

-- Auto-generate program_code on INSERT if not provided (PGM-NNNN)
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

-- Log receipt generation whenever a donation is inserted (80G only)
CREATE TRIGGER trg_donation_after_insert
AFTER INSERT ON donations
FOR EACH ROW
BEGIN
  IF NEW.is_80g_eligible = 1 THEN
    INSERT INTO receipt_log (donation_id, receipt_number)
    VALUES (NEW.id, NEW.receipt_number);
  END IF;
END$$

DELIMITER ;


-- ============================================================
--  SEED DATA
-- ============================================================

-- Default organization record
INSERT IGNORE INTO organizations
  (id, org_name, address, city, state, pincode, phone, email,
   registration_number, pan_80g, signatory_name, signatory_designation)
VALUES
  (1, 'My Charitable Foundation', '123, Main Street, Sector 5',
   'Mumbai', 'Maharashtra', '400001', '+91-22-12345678',
   'info@myfoundation.org', 'REG/2020/001234', 'AAATM1234A',
   'Dr. A. Kumar', 'Secretary');

-- Default program categories
INSERT IGNORE INTO program_categories (name, description, color) VALUES
  ('Infrastructure',     'Physical infrastructure development',   '#F59E0B'),
  ('Education',          'Educational programs and scholarships', '#3B82F6'),
  ('Healthcare',         'Medical aid and healthcare initiatives','#10B981'),
  ('Operations',         'Day-to-day operational expenses',       '#8B5CF6'),
  ('Community Outreach', 'Community engagement activities',       '#EC4899'),
  ('Research',           'Research and development activities',   '#6366F1');
