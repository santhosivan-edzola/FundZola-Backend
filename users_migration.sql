USE fundzola;

-- ── App users ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_users (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  role          ENUM('admin','user') DEFAULT 'user',
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ── Module permissions per user ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_permissions (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  user_id     INT NOT NULL,
  module      VARCHAR(50) NOT NULL,
  can_view    BOOLEAN DEFAULT true,
  can_create  BOOLEAN DEFAULT false,
  can_edit    BOOLEAN DEFAULT false,
  can_delete  BOOLEAN DEFAULT false,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_user_module (user_id, module)
);

-- ── Add created_by to data tables ─────────────────────────────────────────────
ALTER TABLE donors    ADD COLUMN IF NOT EXISTS created_by INT DEFAULT NULL;
ALTER TABLE donations ADD COLUMN IF NOT EXISTS created_by INT DEFAULT NULL;
ALTER TABLE expenses  ADD COLUMN IF NOT EXISTS created_by INT DEFAULT NULL;
ALTER TABLE deals     ADD COLUMN IF NOT EXISTS created_by INT DEFAULT NULL;
