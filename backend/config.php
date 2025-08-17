<?php
// backend/config.php
// Copy this file to config.local.php and adjust credentials for production.
define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_NAME', getenv('DB_NAME') ?: 'game_ops_dashboard');
define('DB_USER', getenv('DB_USER') ?: 'root');
define('DB_PASS', getenv('DB_PASS') ?: '');
define('DB_CHARSET', 'utf8mb4');

// CORS: allow from anywhere by default (adjust for production)
define('CORS_ALLOW_ORIGIN', getenv('CORS_ALLOW_ORIGIN') ?: '*');
