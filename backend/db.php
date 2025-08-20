<?php
// backend/db.php
require_once __DIR__ . '/config.php';

function pdo_conn() {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;
        $options = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ];
        $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
    }
    return $pdo;
}

function respond_json($code, $data) {
    http_response_code($code);
    header('Content-Type: application/json');
    header('Access-Control-Allow-Origin: ' . CORS_ALLOW_ORIGIN);
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
    header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');
    echo json_encode($data);
    exit;
}

function get_json_input() {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
        respond_json(400, ['error' => 'Invalid JSON']);
    }
    return $data ?: [];
}

function require_session($pdo, $token) {
    if (!$token) {
        respond_json(400, ['error' => 'Missing session_token']);
    }
    $stmt = $pdo->prepare('SELECT * FROM sessions WHERE token = ?');
    $stmt->execute([$token]);
    $session = $stmt->fetch();
    if (!$session) {
        respond_json(404, ['error' => 'Session not found. Initialize with action=sync first.', 'token' => $token]);
    }
    return $session;
}

function log_activity($pdo, $session_id, $type, $entity_id, $message, $meta = []) {
    $stmt = $pdo->prepare('INSERT INTO activity_logs (session_id, type, entity_id, message, meta) VALUES (?, ?, ?, ?, ?)');
    $stmt->execute([$session_id, $type, $entity_id, $message, json_encode($meta, JSON_UNESCAPED_UNICODE)]);
    return $pdo->lastInsertId();
}

function upsert_player($pdo, $session_id, $player) {
    // $player: ['player_id','name']
    $stmt = $pdo->prepare('INSERT INTO players (session_id, player_uid, name) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = CURRENT_TIMESTAMP');
    $stmt->execute([$session_id, $player['player_id'], $player['name'] ?? null]);
}

function upsert_vehicle($pdo, $session_id, $veh) {
    // $veh: ['game_vehicle_id','name','type','x','y','status']
    $stmt = $pdo->prepare('INSERT INTO vehicles (session_id, game_vehicle_id, name, type, x, y, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE name = VALUES(name), type = VALUES(type), x = VALUES(x), y = VALUES(y), status = VALUES(status), updated_at = CURRENT_TIMESTAMP');
    $stmt->execute([$session_id, $veh['game_vehicle_id'], $veh['name'] ?? null, $veh['type'] ?? null, $veh['x'] ?? null, $veh['y'] ?? null, $veh['status'] ?? null]);

    if($veh['status']==2){
        $vid = get_vehicle_by_game_id($pdo,$session_id, $veh['game_vehicle_id'])["id"];
        unassign_vehicle($pdo,$session_id, $vid);
    }

    return get_vehicle_by_game_id($pdo, $session_id, $veh['game_vehicle_id']);
}

function unassign_vehicle($pdo, $session_id, $veh) {
    // $veh: ['game_vehicle_id','name','type','x','y','status']
    $stmt = $pdo->prepare('DELETE FROM assignments WHERE session_id = ? and vehicle_id = ?');
    $stmt->execute([$session_id, $veh]);
    return $stmt->rowCount();
}

function get_vehicle_by_game_id($pdo, $session_id, $game_vehicle_id) {
    $stmt = $pdo->prepare('SELECT * FROM vehicles WHERE session_id = ? AND game_vehicle_id = ?');
    $stmt->execute([$session_id, $game_vehicle_id]);
    return $stmt->fetch();
}

function upsert_hospital($pdo, $session_id, $h) {
    // $h: ['game_hospital_id','name','x','y','icu_available','ward_available','icu_total','ward_total']
    $stmt = $pdo->prepare('INSERT INTO hospitals (session_id, game_hospital_id, name, x, y, icu_available, ward_available, icu_total, ward_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE name = VALUES(name), x = VALUES(x), y = VALUES(y),
            icu_available = VALUES(icu_available), ward_available = VALUES(ward_available),
            icu_total = VALUES(icu_total), ward_total = VALUES(ward_total), updated_at = CURRENT_TIMESTAMP');
    $stmt->execute([$session_id, $h['game_hospital_id'], $h['name'] ?? null, $h['x'] ?? null, $h['y'] ?? null,
                    $h['icu_available'] ?? null, $h['ward_available'] ?? null, $h['icu_total'] ?? null, $h['ward_total'] ?? null]);
}

function upsert_event($pdo, $session_id, $e) {
    // $e: ['game_event_id' (nullable for frontend), 'name','x','y','status','created_by']
    if (isset($e['game_event_id'])) {
        $stmt = $pdo->prepare('INSERT INTO events (session_id, game_event_id, name, x, y, status, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE name = VALUES(name), x = VALUES(x), y = VALUES(y), status = VALUES(status), updated_at = CURRENT_TIMESTAMP');
        $stmt->execute([$session_id, $e['game_event_id'], $e['name'] ?? null, $e['x'] ?? null, $e['y'] ?? null, $e['status'] ?? 'active', $e['created_by'] ?? 'game']);
        // return id
        $stmt = $pdo->prepare('SELECT * FROM events WHERE session_id = ? AND game_event_id = ?');
        $stmt->execute([$session_id, $e['game_event_id']]);
        return $stmt->fetch();
    } else {
        $stmt = $pdo->prepare('INSERT INTO events (session_id, name, x, y, status, created_by) VALUES (?, ?, ?, ?, ?, ?)');
        $stmt->execute([$session_id, $e['name'] ?? 'Event', $e['x'] ?? 0, $e['y'] ?? 0, $e['status'] ?? 'active', $e['created_by'] ?? 'frontend']);
        $stmt = $pdo->prepare('SELECT * FROM events WHERE id = ?');
        $stmt->execute([pdo_conn()->lastInsertId()]);
        return $stmt->fetch();
    }
}
