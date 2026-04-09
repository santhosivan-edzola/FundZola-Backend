USE fundzola;

-- Zoho Books Integration Tables
CREATE TABLE IF NOT EXISTS zoho_config (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  org_id           INT NOT NULL,
  client_id        VARCHAR(255) NOT NULL,
  client_secret    VARCHAR(255) NOT NULL,
  zoho_org_id      VARCHAR(100),
  dc_region        VARCHAR(10)  NOT NULL DEFAULT 'IN',
  access_token     TEXT,
  refresh_token    TEXT,
  token_expires_at BIGINT,
  is_connected     TINYINT(1)   NOT NULL DEFAULT 0,
  sync_enabled     TINYINT(1)   NOT NULL DEFAULT 1,
  last_sync_at     DATETIME,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_org (org_id)
);

CREATE TABLE IF NOT EXISTS zoho_sync_log (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  org_id          INT NOT NULL,
  sync_type       ENUM('manual','scheduled') DEFAULT 'scheduled',
  module          VARCHAR(50),
  direction       ENUM('push','pull','both') DEFAULT 'both',
  status          ENUM('running','success','error','partial') DEFAULT 'running',
  records_pushed  INT DEFAULT 0,
  records_pulled  INT DEFAULT 0,
  error_message   TEXT,
  started_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at     TIMESTAMP NULL,
  INDEX idx_org_id (org_id)
);

CREATE TABLE IF NOT EXISTS zoho_sync_detail (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  log_id       INT NOT NULL,
  org_id       INT NOT NULL,
  module       ENUM('donor','donation','expense') NOT NULL,
  direction    ENUM('push','pull') NOT NULL,
  local_id     INT,
  zoho_id      VARCHAR(100),
  record_name  VARCHAR(255),
  action       ENUM('created','updated','skipped') DEFAULT 'created',
  status       ENUM('success','error') DEFAULT 'success',
  note         VARCHAR(500),
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_log_id (log_id)
);

CREATE TABLE IF NOT EXISTS zoho_record_map (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  org_id         INT NOT NULL,
  module         ENUM('donor','donation','expense') NOT NULL,
  local_id       INT NOT NULL,
  zoho_id        VARCHAR(100) NOT NULL,
  last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_map (org_id, module, local_id)
);
