USE fundzola;

CREATE TABLE IF NOT EXISTS deal_allocations (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  deal_id     INT NOT NULL,
  category_id INT NOT NULL,
  amount      DECIMAL(15,2) NOT NULL DEFAULT 0,
  notes       TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_deal_cat (deal_id, category_id),
  FOREIGN KEY (deal_id)     REFERENCES deals(id)              ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES program_categories(id) ON DELETE CASCADE
);
