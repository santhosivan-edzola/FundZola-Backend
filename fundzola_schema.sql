-- ============================================================
--  FUNDZOLA - MySQL Schema
--  Donor & Donation Management System
-- ============================================================

CREATE DATABASE IF NOT EXISTS fundzola
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE fundzola;

-- ============================================================
--  1. ORGANIZATIONS
--  Stores the NGO / trust details used on 80G receipts
-- ============================================================
CREATE TABLE organizations (
  id                    INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  org_name              VARCHAR(200)      NOT NULL,
  address               TEXT,
  city                  VARCHAR(100),
  state                 VARCHAR(100),
  pincode               VARCHAR(10),
  phone                 VARCHAR(20),
  email                 VARCHAR(150),
  registration_number   VARCHAR(100),       -- Trust / NGO reg no.
  pan_80g               VARCHAR(10),        -- 80G registration PAN
  signatory_name        VARCHAR(150),
  signatory_designation VARCHAR(100),
  created_at            DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- Seed default org
INSERT INTO organizations
  (org_name, address, city, state, pincode, phone, email,
   registration_number, pan_80g, signatory_name, signatory_designation)
VALUES
  ('My Charitable Foundation', '123, Main Street, Sector 5',
   'Mumbai', 'Maharashtra', '400001', '+91-22-12345678',
   'info@myfoundation.org', 'REG/2020/001234', 'AAATM1234A',
   'Dr. A. Kumar', 'Secretary');


-- ============================================================
--  2. DONORS
-- ============================================================
CREATE TABLE donors (
  id            INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  donor_code    VARCHAR(20)       NOT NULL,             -- e.g. DNR-0001
  name          VARCHAR(200)      NOT NULL,
  email         VARCHAR(150)      NOT NULL,
  phone         VARCHAR(20),
  address       TEXT,
  pan_number    VARCHAR(10),                            -- AAAAA9999A format
  donor_type    ENUM(
                  'Individual',
                  'Corporate',
                  'Trust',
                  'Society',
                  'Foundation',
                  'Other'
                ) NOT NULL DEFAULT 'Individual',
  is_active     TINYINT(1)        NOT NULL DEFAULT 1,   -- 0 = soft-deleted
  created_by    VARCHAR(100),                           -- admin who added
  created_at    DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_donor_code  (donor_code),
  UNIQUE KEY uq_donor_email (email),
  INDEX idx_donor_pan       (pan_number),
  INDEX idx_donor_name      (name),
  INDEX idx_donor_active    (is_active)
) ENGINE=InnoDB;


-- ============================================================
--  3. DONATIONS
-- ============================================================
CREATE TABLE donations (
  id               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  receipt_number   VARCHAR(20)      NOT NULL,           -- FZ-2026-0001
  donor_id         INT UNSIGNED     NOT NULL,
  amount           DECIMAL(12,2)    NOT NULL CHECK (amount > 0),
  donation_date    DATE             NOT NULL,
  payment_mode     ENUM(
                     'Cash',
                     'Cheque',
                     'NEFT/RTGS',
                     'UPI',
                     'Demand Draft',
                     'Online Transfer'
                   ) NOT NULL,
  cheque_number    VARCHAR(50),                         -- for Cheque / DD
  bank_name        VARCHAR(150),                        -- for Cheque / DD / NEFT
  transaction_ref  VARCHAR(100),                        -- for UPI / online
  fund_category    ENUM(
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
  purpose          VARCHAR(500),                        -- free-text purpose
  is_80g_eligible  TINYINT(1)       NOT NULL DEFAULT 1,
  notes            TEXT,
  created_at       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_receipt_number (receipt_number),
  CONSTRAINT fk_donation_donor
    FOREIGN KEY (donor_id) REFERENCES donors (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  INDEX idx_donation_donor        (donor_id),
  INDEX idx_donation_date         (donation_date),
  INDEX idx_donation_fund         (fund_category),
  INDEX idx_donation_80g          (is_80g_eligible)
) ENGINE=InnoDB;


-- ============================================================
--  4. EXPENSES
-- ============================================================
CREATE TABLE expenses (
  id               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  donation_id      INT UNSIGNED,                        -- optional direct link to one donation
  fund_category    ENUM(
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
  description      VARCHAR(500)     NOT NULL,
  amount           DECIMAL(12,2)    NOT NULL CHECK (amount > 0),
  expense_date     DATE             NOT NULL,
  category         ENUM(
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
  vendor           VARCHAR(200),
  invoice_number   VARCHAR(100),
  payment_mode     ENUM(
                     'Cash',
                     'Cheque',
                     'NEFT/RTGS',
                     'UPI',
                     'Demand Draft',
                     'Online Transfer'
                   ),
  approved_by      VARCHAR(150),
  notes            TEXT,
  created_at       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_expense_donation
    FOREIGN KEY (donation_id) REFERENCES donations (id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  INDEX idx_expense_donation  (donation_id),
  INDEX idx_expense_date      (expense_date),
  INDEX idx_expense_fund      (fund_category),
  INDEX idx_expense_category  (category)
) ENGINE=InnoDB;


-- ============================================================
--  5. RECEIPT_LOG
--  Audit trail: every time a receipt is generated/reprinted
-- ============================================================
CREATE TABLE receipt_log (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  donation_id    INT UNSIGNED  NOT NULL,
  receipt_number VARCHAR(20)   NOT NULL,
  generated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  generated_by   VARCHAR(100),
  PRIMARY KEY (id),
  CONSTRAINT fk_receipt_donation
    FOREIGN KEY (donation_id) REFERENCES donations (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  INDEX idx_receipt_donation (donation_id)
) ENGINE=InnoDB;


-- ============================================================
--  VIEWS
-- ============================================================

-- V1: Fund utilization summary per category
CREATE OR REPLACE VIEW vw_fund_utilization AS
SELECT
  fc.fund_category,
  COALESCE(d.total_donated,  0.00)  AS total_donated,
  COALESCE(e.total_expended, 0.00)  AS total_expended,
  COALESCE(d.total_donated,  0.00)
    - COALESCE(e.total_expended, 0.00) AS balance,
  CASE
    WHEN COALESCE(d.total_donated, 0) = 0 THEN 0
    ELSE ROUND(
      COALESCE(e.total_expended, 0) / d.total_donated * 100, 2
    )
  END AS utilization_pct,
  COALESCE(d.donation_count, 0)  AS donation_count,
  COALESCE(e.expense_count,  0)  AS expense_count
FROM (
  -- all possible fund categories
  SELECT 'Education'         AS fund_category UNION ALL
  SELECT 'Healthcare'                         UNION ALL
  SELECT 'Infrastructure'                     UNION ALL
  SELECT 'Relief Fund'                        UNION ALL
  SELECT 'Scholarship'                        UNION ALL
  SELECT 'Research'                           UNION ALL
  SELECT 'Environment'                        UNION ALL
  SELECT 'Women Empowerment'                  UNION ALL
  SELECT 'Child Welfare'                      UNION ALL
  SELECT 'General'
) fc
LEFT JOIN (
  SELECT fund_category,
         SUM(amount)  AS total_donated,
         COUNT(*)     AS donation_count
  FROM   donations
  GROUP  BY fund_category
) d ON d.fund_category = fc.fund_category
LEFT JOIN (
  SELECT fund_category,
         SUM(amount)  AS total_expended,
         COUNT(*)     AS expense_count
  FROM   expenses
  GROUP  BY fund_category
) e ON e.fund_category = fc.fund_category;


-- V2: Per-donor summary
CREATE OR REPLACE VIEW vw_donor_summary AS
SELECT
  dn.id                                AS donor_id,
  dn.donor_code,
  dn.name                              AS donor_name,
  dn.pan_number,
  dn.donor_type,
  dn.email,
  COALESCE(d.total_donated,   0.00)   AS total_donated,
  COALESCE(e.total_expended,  0.00)   AS total_expended,
  COALESCE(d.total_donated,   0.00)
    - COALESCE(e.total_expended, 0.00) AS balance,
  COALESCE(d.donation_count,  0)      AS donation_count,
  d.last_donation_date
FROM donors dn
LEFT JOIN (
  SELECT donor_id,
         SUM(amount)    AS total_donated,
         COUNT(*)       AS donation_count,
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


-- V3: Full donation detail (joins donor name)
CREATE OR REPLACE VIEW vw_donation_detail AS
SELECT
  d.id,
  d.receipt_number,
  d.donor_id,
  dn.name          AS donor_name,
  dn.pan_number    AS donor_pan,
  dn.email         AS donor_email,
  dn.phone         AS donor_phone,
  dn.address       AS donor_address,
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

-- SP1: Get next receipt number for the current year
CREATE PROCEDURE sp_next_receipt_number (OUT p_receipt_number VARCHAR(20))
BEGIN
  DECLARE v_year   CHAR(4);
  DECLARE v_count  INT;

  SET v_year  = YEAR(CURDATE());
  SELECT COUNT(*) INTO v_count
  FROM   donations
  WHERE  YEAR(donation_date) = v_year;

  SET p_receipt_number = CONCAT('FZ-', v_year, '-', LPAD(v_count + 1, 4, '0'));
END$$

-- SP2: Auto-generate donor_code before insert
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

-- Auto-set donor_code on INSERT if not provided
CREATE TRIGGER trg_donor_before_insert
BEFORE INSERT ON donors
FOR EACH ROW
BEGIN
  IF NEW.donor_code IS NULL OR NEW.donor_code = '' THEN
    CALL sp_next_donor_code(@dc);
    SET NEW.donor_code = @dc;
  END IF;
END$$

-- Log receipt generation whenever a donation is inserted
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
--  SAMPLE DATA  (remove before production)
-- ============================================================

INSERT INTO donors (donor_code, name, email, phone, address, pan_number, donor_type) VALUES
  ('DNR-0001', 'Ramesh Iyer',        'ramesh.iyer@email.com',    '9876543210', '12, Park Street, Chennai',      'ABCRI1234D', 'Individual'),
  ('DNR-0002', 'Priya Sharma',       'priya.sharma@email.com',   '9845012345', '7, MG Road, Bengaluru',          'BCGPS5678E', 'Individual'),
  ('DNR-0003', 'Tata Trusts',        'contact@tatatrusts.org',   '2222345678', 'Bombay House, Mumbai',           'AABCT1234C', 'Trust'),
  ('DNR-0004', 'Infosys Foundation', 'giving@infosys.com',       '8028520261', 'Electronics City, Bengaluru',   'AAACI1234P', 'Corporate');

INSERT INTO donations
  (receipt_number, donor_id, amount, donation_date, payment_mode, fund_category, purpose, is_80g_eligible)
VALUES
  ('FZ-2026-0001', 1, 10000.00, '2026-01-10', 'UPI',       'Education',  'Annual scholarship fund', 1),
  ('FZ-2026-0002', 2,  5000.00, '2026-01-15', 'Cheque',    'Healthcare', 'Medical camp support',    1),
  ('FZ-2026-0003', 3, 50000.00, '2026-02-01', 'NEFT/RTGS', 'Education',  'School infrastructure',  1),
  ('FZ-2026-0004', 4, 25000.00, '2026-02-20', 'NEFT/RTGS', 'General',    'General corpus fund',    1);

INSERT INTO expenses
  (donation_id, fund_category, description, amount, expense_date, category, vendor, approved_by)
VALUES
  (1,    'Education',  'Scholarship disbursement - Batch 2026',  8000.00, '2026-02-05', 'Educational Aid', 'Direct Transfer',   'Dr. A. Kumar'),
  (2,    'Healthcare', 'Medical camp supplies',                   3500.00, '2026-02-10', 'Medical Aid',     'MedSupply Co.',     'Dr. A. Kumar'),
  (3,    'Education',  'Classroom furniture',                    20000.00, '2026-03-01', 'Infrastructure',  'FurniWorld',        'Dr. A. Kumar'),
  (NULL, 'General',    'Office administrative expenses',          2000.00, '2026-03-05', 'Administrative',  'Office Depot',      'Dr. A. Kumar');


-- ============================================================
--  QUICK SANITY QUERIES
-- ============================================================

-- Verify fund utilization
-- SELECT * FROM vw_fund_utilization WHERE total_donated > 0;

-- Verify donor summary
-- SELECT * FROM vw_donor_summary;

-- Full donation detail
-- SELECT * FROM vw_donation_detail;
