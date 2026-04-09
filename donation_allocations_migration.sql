USE fundzola;

CREATE TABLE IF NOT EXISTS donation_allocations (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  donation_id   INT UNSIGNED  NOT NULL,
  category_id   INT UNSIGNED  NOT NULL,
  amount        DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_don_cat (donation_id, category_id),
  FOREIGN KEY (donation_id) REFERENCES donations(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES program_categories(id) ON DELETE CASCADE,
  INDEX idx_da_donation (donation_id)
) ENGINE=InnoDB;
