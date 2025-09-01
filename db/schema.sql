-- db/schema.sql
-- MySQL schema for Game Ops Dashboard (with mod_id + map images)

CREATE DATABASE IF NOT EXISTS game_ops_dashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE game_ops_dashboard;

SET NAMES utf8mb4;

-- Map packs / mods: store the background map image by mod_id
CREATE TABLE IF NOT EXISTS mods (
  mod_id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255),
  map_image LONGBLOB,
  mime_type VARCHAR(128) DEFAULT 'image/png',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(255) NOT NULL UNIQUE,
  mod_id VARCHAR(255) NULL, -- fixed per session
  min_x DOUBLE DEFAULT 0,
  min_y DOUBLE DEFAULT 0,
  max_x DOUBLE DEFAULT 1000,
  max_y DOUBLE DEFAULT 1000,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sessions_mod FOREIGN KEY (mod_id) REFERENCES mods(mod_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS players (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  player_uid VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_player (session_id, player_uid),
  CONSTRAINT fk_players_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vehicles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  game_vehicle_id VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  type VARCHAR(255),
  modes VARCHAR(255),
  x DOUBLE,
  y DOUBLE,
  status INT,
  assigned_player_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_vehicle (session_id, game_vehicle_id),
  INDEX idx_session (session_id),
  CONSTRAINT fk_vehicles_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_vehicles_player FOREIGN KEY (assigned_player_id) REFERENCES players(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS hospitals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  game_hospital_id VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  x DOUBLE,
  y DOUBLE,
  icu_total INT DEFAULT 0,
  icu_available INT DEFAULT 0,
  ward_total INT DEFAULT 0,
  ward_available INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_hospital (session_id, game_hospital_id),
  CONSTRAINT fk_hospitals_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  game_event_id VARCHAR(255) NULL,
  name VARCHAR(255),
  x DOUBLE,
  y DOUBLE,
  status ENUM('active','completed','canceled') DEFAULT 'active',
  created_by ENUM('game','frontend') DEFAULT 'game',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_event_game (session_id, game_event_id),
  INDEX idx_session_status (session_id, status),
  CONSTRAINT fk_events_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  event_id INT NOT NULL,
  vehicle_id INT NOT NULL,
  assigned_player_id INT NULL,
  status ENUM('enroute','on_scene','completed','canceled') DEFAULT 'enroute',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_assignment (event_id, vehicle_id),
  INDEX idx_session_event (session_id, event_id),
  CONSTRAINT fk_asg_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_asg_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_asg_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
  CONSTRAINT fk_asg_player FOREIGN KEY (assigned_player_id) REFERENCES players(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  event_id INT NOT NULL,
  content TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_session_note (session_id, event_id),
  UNIQUE KEY uniq_note_game (session_id, event_id),
  CONSTRAINT nt_asg_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT nt_asg_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS commands (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  type ENUM('move','alarm','assign','unassign') NOT NULL,
  payload JSON NOT NULL,
  processed TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  INDEX idx_session_processed (session_id, processed, id),
  CONSTRAINT fk_commands_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS activity_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  type ENUM('vehicle','hospital','event','command') NOT NULL,
  entity_id INT NULL,
  message VARCHAR(512) NOT NULL,
  meta JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session (session_id, id),
  CONSTRAINT fk_logs_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS clock (
  session_id INT NOT NULL PRIMARY KEY,
  time_hours TINYINT(1) DEFAULT 0,
  time_minutes TINYINT(1) DEFAULT 0
) ENGINE=InnoDB;