USE fundzola;

-- Add 'deal' to module ENUMs in Zoho sync tables
ALTER TABLE zoho_sync_detail
  MODIFY COLUMN module ENUM('donor','donation','expense','deal') NOT NULL;

ALTER TABLE zoho_record_map
  MODIFY COLUMN module ENUM('donor','donation','expense','deal') NOT NULL;
