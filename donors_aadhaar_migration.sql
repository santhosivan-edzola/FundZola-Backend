USE fundzola;

ALTER TABLE donors
  ADD COLUMN IF NOT EXISTS aadhaar_number VARCHAR(12) DEFAULT NULL AFTER pan_number;
