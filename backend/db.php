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

//@Deprecated
function log_activity($pdo, $session_id, $type, $entity_id, $message, $meta = []) {
    /*$stmt = $pdo->prepare('INSERT INTO activity_logs (session_id, type, entity_id, message, meta) VALUES (?, ?, ?, ?, ?)');
    $stmt->execute([$session_id, $type, $entity_id, $message, json_encode($meta, JSON_UNESCAPED_UNICODE)]);
    return $pdo->lastInsertId();*/
    return [];
}

function upsert_player($pdo, $session_id, $player) {
    // $player: ['player_id','name']
    $stmt = $pdo->prepare('INSERT INTO players (session_id, player_uid, name) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = CURRENT_TIMESTAMP');
    $stmt->execute([$session_id, $player, $player ?? "John Doe"]);
}
//Checks in priority the available values for an entry
function check_options($key, $saved, $sent, $default=null){
    if(isset($sent[$key])){
        return $sent[$key];
    }
    if($saved && isset($saved[$key])){
        return $saved[$key];
    }
    return $default;
}

//Update 23.08.2025 Vehicles now can be fed with optional params game_vehicle_id and session_id are of course mandatory
function upsert_vehicle($pdo, $session_id, $veh) {
    $stmt = $pdo->prepare('Select * from vehicles where session_id = ? and game_vehicle_id = ?');
    $stmt->execute([$session_id, $veh['game_vehicle_id']]);
    $saved_data = $stmt->fetch();

    // $veh: ['game_vehicle_id','name','type','x','y','status']
    $stmt = $pdo->prepare('INSERT INTO vehicles (session_id, game_vehicle_id, name, type, modes, x, y, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE name = VALUES(name), type = VALUES(type), modes = VALUES(modes), x = VALUES(x), y = VALUES(y), status = VALUES(status), updated_at = CURRENT_TIMESTAMP');
    $stmt->execute([
        $session_id, 
        $veh['game_vehicle_id'],
        check_options("name",$saved_data,$veh,$veh['game_vehicle_id']),
        check_options("type",$saved_data,$veh,"None"),
        check_options("modes",$saved_data,$veh,null),
        check_options("x",$saved_data,$veh,0),
        check_options("y",$saved_data,$veh,0),
        check_options("status",$saved_data,$veh,2)
    ]);

    if(isset($veh['status']) && $veh['status']==2 && isset($saved_data["id"])){
        unassign_vehicle($pdo,$session_id, $saved_data["id"]);
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

function upsert_messages($pdo, $session_id, $m) {
    // $m: {"entity_id":"xy","message":"xy","long_message":"xyz","state":"active/inactive"}
    //Preload Data
    if (isset($m['entity_id'])&&isset($m['message'])) {//TODO check with empty string
        $stmt = $pdo->prepare('Select * from activity_logs where session_id = ? and entity_id = ? and message = ?');
        $stmt->execute([$session_id, $m['entity_id'], $m['message']]);
        $saved_data = $stmt->fetch();
    }else{
        $saved_data = [];
    }
    //Get event id (which is from here an event not! a vehicle)
    if(isset($m['entity_id'])&&$m['entity_id']!==''){
        $stmt = $pdo->prepare('Select event_id from assignments inner join vehicles on assignments.session_id= vehicles.session_id and vehicle_id=vehicles.id where vehicles.session_id = ? and game_vehicle_id = ?');
        $stmt->execute([$session_id, $m['entity_id']]);
        $event_data = $stmt->fetch();
        if(!empty($event_data)){
            $event_data["type"]="event";
        }else{
            $event_data["type"]="vehicle";
        }
    }else{
        $event_data = [];
    }

    //Prepare Statement:
    $stmt = $pdo->prepare('INSERT INTO activity_logs (session_id, type, entity_id, event_id, message, long_message, meta, state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE event_id = VALUES(event_id), type= VALUES(type), long_message = VALUES(long_message), meta = VALUES(meta), state = VALUES(state)');
    $stmt->execute([
        $session_id, 
        check_options("type",$event_data,$m,"global"),
        check_options("entity_id",$saved_data,$m,default: NULL),
        check_options("event_id",$event_data,$m,default: NULL),
        check_options("message",$saved_data,$m,NULL),
        check_options("long_message",$saved_data,$m,$m['message']),
        json_encode($m),
        check_options("state",$saved_data,$m,"active")
    ]);

    $stmt = $pdo->prepare('Select * from activity_logs where session_id = ? and entity_id = ? and message = ?');
    $stmt->execute([$session_id, $m['entity_id'], $m['message']]);
    return $stmt->fetch();
}
function upsert_event($pdo, $session_id, $e) {
    // $e: ['game_event_id' (nullable for frontend), 'name','x','y','status','created_by']

    //Preload Data
    if (isset($e['id'])) {
        $stmt = $pdo->prepare('Select * from events where session_id = ? and id = ?');
        $stmt->execute([$session_id, $e['id']]);
        $saved_data = $stmt->fetch();
    }else if(isset($e['game_event_id'])){
        $stmt = $pdo->prepare('Select * from events where session_id = ? and game_event_id = ?');
        $stmt->execute([$session_id, $e['game_event_id']]);
        $saved_data = $stmt->fetch();
    }else{
        $saved_data = [];
    }
    //Prepare Statement:
    if(isset($e['id'])){
        //Separate statement needed as id situation will not trigger on duplicate entry
        $stmt = $pdo->prepare('Update events 
        SET name = ?, game_event_id= ?, x = ?, y = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        where id = ?');   
        $stmt->execute([
            check_options("name",$saved_data,$e,NULL),
            check_options("game_event_id",$saved_data,$e,NULL),
            check_options("x",$saved_data,$e,NULL),
            check_options("y",$saved_data,$e,NULL),
            check_options("status",$saved_data,$e,"active"),
            $e['id']
        ]);
    }else{
        $stmt = $pdo->prepare('INSERT INTO events (session_id, game_event_id, name, x, y, status, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE name = VALUES(name), game_event_id= VALUES(game_event_id), x = VALUES(x), y = VALUES(y), status = VALUES(status), updated_at = CURRENT_TIMESTAMP');
        $stmt->execute([
            $session_id, 
            check_options("game_event_id",$saved_data,$e,NULL),
            check_options("name",$saved_data,$e,NULL),
            check_options("x",$saved_data,$e,NULL),
            check_options("y",$saved_data,$e,NULL),
            check_options("status",$saved_data,$e,"active"),
            check_options("created_by",$saved_data,$e,"game")
        ]);
    }

    if (isset($e['game_event_id'])) {
        $stmt = $pdo->prepare('SELECT * FROM events WHERE session_id = ? AND game_event_id = ?');
        $stmt->execute([$session_id, $e['game_event_id']]);
        return $stmt->fetch();
    }else {
        $stmt = $pdo->prepare('SELECT * FROM events WHERE id = ?');
        $stmt->execute([isset($e['id'])?$e['id']:pdo_conn()->lastInsertId()]);
        return $stmt->fetch();
    }
}

function upsert_notes($pdo, $session_id, $n) {
    $stmt = $pdo->prepare('INSERT INTO notes (session_id, event_id, content)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE session_id = VALUES(session_id), event_id = VALUES(event_id), content = VALUES(content), updated_at = CURRENT_TIMESTAMP');
    $stmt->execute([$session_id, $n['event_id'], $n['content'] ?? ""]);

    $stmt = $pdo->prepare('SELECT * FROM notes WHERE session_id = ? AND event_id = ?');
    $stmt->execute([$session_id, $n['event_id']]);
    return $stmt->fetch();
}