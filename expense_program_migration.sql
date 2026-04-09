USE fundzola;

-- Add program, category, and type to expenses
ALTER TABLE expenses
  ADD COLUMN program_id    INT           DEFAULT NULL,
  ADD COLUMN category_id   INT           DEFAULT NULL,
  ADD COLUMN expense_type  ENUM('Full','Split') NOT NULL DEFAULT 'Full';

-- Split expense allocations (one row per donation for Split expenses)
CREATE TABLE IF NOT EXISTS expense_allocations (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  expense_id  INT UNSIGNED  NOT NULL,
  donation_id INT UNSIGNED  NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (expense_id)  REFERENCES expenses(id)  ON DELETE CASCADE,
  FOREIGN KEY (donation_id) REFERENCES donations(id) ON DELETE CASCADE,
  INDEX idx_ea_expense  (expense_id),
  INDEX idx_ea_donation (donation_id)
) ENGINE=InnoDB;
