USE fundzola;

CREATE TABLE IF NOT EXISTS deals (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  donor_id      INT UNSIGNED NOT NULL,
  title         VARCHAR(255) NOT NULL,
  amount        DECIMAL(12,2) DEFAULT 0,
  stage         VARCHAR(50) NOT NULL DEFAULT 'Prospect',
  priority      VARCHAR(20) DEFAULT 'Medium',
  notes         TEXT,
  expected_date DATE,
  actual_date   DATE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (donor_id) REFERENCES donors(id) ON DELETE CASCADE
);
