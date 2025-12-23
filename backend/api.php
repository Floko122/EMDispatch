<?php
// backend/api.php
require_once __DIR__ . '/db.php';

// Handle CORS preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: ' . CORS_ALLOW_ORIGIN);
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
    header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');
    exit;
}

$pdo = pdo_conn();
$action = $_GET['action'] ?? $_POST['action'] ?? null;

// Utility: sanitize numeric
function n($v) { return is_null($v) ? null : 0 + $v; }

// Utility: UUID v4
function session_token() {
    $data = random_bytes(length: 2);
    return bin2hex($data);
}

// Utility: create a unique session token and insert a session row
function create_session(PDO $pdo, ?string $mod_id, ?array $bounds) {
    $attempts = 0;
    while ($attempts < 10) {
        $attempts++;
        $token = session_token();
        try {
            if ($bounds) {
                $stmt = $pdo->prepare('INSERT INTO sessions (token, mod_id, min_x, min_y, max_x, max_y) VALUES (?, ?, ?, ?, ?, ?)');
                $stmt->execute([
                    $token,
                    $mod_id,
                    n($bounds['min_x'] ?? 0),
                    n($bounds['min_y'] ?? 0),
                    n($bounds['max_x'] ?? 1000),
                    n($bounds['max_y'] ?? 1000),
                ]);
            } else {
                $stmt = $pdo->prepare('INSERT INTO sessions (token, mod_id) VALUES (?, ?)');
                $stmt->execute([$token, $mod_id]);
            }
            // return the full session row
            $stmt = $pdo->prepare('SELECT * FROM sessions WHERE token = ?');
            $stmt->execute([$token]);
            return $stmt->fetch();
        } catch (PDOException $e) {
            // 1062 = duplicate key; try again with a new UUID
            if (isset($e->errorInfo[1]) && (int)$e->errorInfo[1] === 1062) {
                continue;
            }
            trigger_error($e,E_USER_ERROR);
            throw $e;
        }
    }
    throw new Exception('Failed to generate a unique session token after multiple attempts.');
}

try {
    switch ($action) {

        case 'session_create':
            // Create a brand-new session with a server-generated unique token (UUID v4).
            // Optional JSON: { "mod_id": "...", "map_bounds": {min_x,min_y,max_x,max_y} }
            $data = get_json_input();
            $mod_id = $data['mod_id'] ?? null;
            $bounds = $data['map_bounds'] ?? null;

            $session = create_session($pdo, $mod_id, $bounds);
            respond_json(200, [
                'ok' => true,
                'session_id' => (int)$session['id'],
                'session_token' => $session['token'],
                'mod_id' => $session['mod_id'],
                'map_bounds' => [
                    'min_x' => (float)$session['min_x'],
                    'min_y' => (float)$session['min_y'],
                    'max_x' => (float)$session['max_x'],
                    'max_y' => (float)$session['max_y'],
                ],
            ]);
            break;

        case 'sync':
            // Initialize or update a session with bulk payload from the game.
            // JSON input: {
            //   session_token, mod_id,
            //   map_bounds:{min_x,min_y,max_x,max_y},
            //   players:[{player_id,name}],
            //   vehicles:[{game_vehicle_id,name,type,x,y,status}],
            //   hospitals:[{game_hospital_id,name,x,y,icu_total,icu_available,ward_total,ward_available}],
            //   events:[{game_event_id,name,x,y,status}]
            // }
            $data = get_json_input();
            $token = $data['session_token'] ?? null;
            if (!$token) respond_json(400, ['error' => 'Missing session_token']);

            $mod_id = $data['mod_id'] ?? null;

            $pdo->beginTransaction();
            // Upsert session (NEVER change mod_id once set)
            $bounds = $data['map_bounds'] ?? null;
            if ($bounds) {
                $stmt = $pdo->prepare('INSERT INTO sessions (token, mod_id, min_x, min_y, max_x, max_y)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        min_x = VALUES(min_x),
                        min_y = VALUES(min_y),
                        max_x = VALUES(max_x),
                        max_y = VALUES(max_y),
                        updated_at = CURRENT_TIMESTAMP,
                        mod_id = IFNULL(mod_id, VALUES(mod_id))');
                $stmt->execute([
                    $token, $mod_id,
                    n($bounds['min_x'] ?? 0), n($bounds['min_y'] ?? 0),
                    n($bounds['max_x'] ?? 1000), n($bounds['max_y'] ?? 1000)
                ]);
            } else {
                $stmt = $pdo->prepare('INSERT INTO sessions (token, mod_id)
                    VALUES (?, ?)
                    ON DUPLICATE KEY UPDATE
                        updated_at = CURRENT_TIMESTAMP,
                        mod_id = IFNULL(mod_id, VALUES(mod_id))');
                $stmt->execute([$token, $mod_id]);
            }

            // Load session id
            $stmt = $pdo->prepare('SELECT * FROM sessions WHERE token = ?');
            $stmt->execute([$token]);
            $session = $stmt->fetch();
            $sid = $session['id'];

            foreach (($data['players'] ?? []) as $p) { upsert_player($pdo, $sid, $p); }
            foreach (($data['vehicles'] ?? []) as $v) { upsert_vehicle($pdo, $sid, $v); }
            foreach (($data['hospitals'] ?? []) as $h) { upsert_hospital($pdo, $sid, $h); }
            foreach (($data['events'] ?? []) as $e) { $e['created_by'] = 'game'; upsert_event($pdo, $sid, $e); }

            if(isset($data['time'] )){
                $stmt = $pdo->prepare('INSERT INTO clock (session_id, time_hours, time_minutes)
                    VALUES (?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        time_hours = VALUES(time_hours),
                        time_minutes = VALUES(time_minutes)');
                $stmt->execute([$sid, $data['time']['h'], $data['time']['m']]);
            }

            $pdo->commit();
            respond_json(200, ['ok' => true, 'session_id' => $sid]);
            break;

        case 'mods_put':
            // Upsert a mod's map image.
            // JSON: { "mod_id": "mod-001", "mime_type": "image/png", "name":"City Alpha", "image_base64":"..."}
            $data = get_json_input();
            $mod_id = $data['mod_id'] ?? null;
            $image_b64 = $data['image_base64'] ?? null;
            $mime = $data['mime_type'] ?? 'image/jpeg';
            $name = $data['name'] ?? null;
            if (!$mod_id || !$image_b64) respond_json(400, ['error'=>'mod_id and image_base64 required']);

            $image_b64 = preg_replace('#^data:[^;]+;base64,#', '', $image_b64);
            $bin = base64_decode($image_b64, true);
            if ($bin === false) respond_json(400, ['error'=>'Invalid base64 for image']);

            $stmt = $pdo->prepare('INSERT INTO mods (mod_id, name, map_image, mime_type)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE name = VALUES(name), map_image = VALUES(map_image),
                    mime_type = VALUES(mime_type), updated_at = CURRENT_TIMESTAMP');
            $stmt->execute([$mod_id, $name, $bin, $mime]);
            respond_json(200, ['ok'=>true, 'mod_id'=>$mod_id]);
            break;

        case 'map_image':
            // Returns the binary map image for the session's mod_id
            $token = $_GET['session_token'] ?? null;
            $session = require_session($pdo, $token);
            header('Access-Control-Allow-Origin: ' . CORS_ALLOW_ORIGIN);

            if (!$session['mod_id']) {
                http_response_code(404);
                header('Content-Type: text/plain');
                echo 'No mod_id set for session';
                exit;
            }
            $stmt = $pdo->prepare('SELECT map_image, mime_type FROM mods WHERE mod_id = ?');
            $stmt->execute([$session['mod_id']]);
            $row = $stmt->fetch();
            if (!$row || !$row['map_image']) {
                http_response_code(404);
                header('Content-Type: text/plain');
                echo 'Map image not found';
                exit;
            }
            header('Content-Type: ' . ($row['mime_type'] ?: 'image/jpeg'));
            header('Cache-Control: private, max-age=60');
            echo $row['map_image'];
            exit;

        case 'state':
            // Get full state for the frontend
            $token = $_GET['session_token'] ?? null;
            $session = require_session($pdo, $token);
            $sid = $session['id'];

            $players = $pdo->prepare('SELECT id, player_uid as player_id, name FROM players WHERE session_id = ? ORDER BY name');
            $players->execute([$sid]);
            $players = $players->fetchAll();

            $vehicles = $pdo->prepare('SELECT * FROM vehicles WHERE session_id = ?');
            $vehicles->execute([$sid]);
            $vehicles = $vehicles->fetchAll();

            $hospitals = $pdo->prepare('SELECT * FROM hospitals WHERE session_id = ?');
            $hospitals->execute([$sid]);
            $hospitals = $hospitals->fetchAll();

            $events = $pdo->prepare("SELECT * FROM events WHERE session_id = ? AND status != 'completed'");
            $events->execute([$sid]);
            $events = $events->fetchAll();

            $time = $pdo->prepare("SELECT * FROM clock WHERE session_id = ?");
            $time->execute([$sid]);
            $time = $time->fetch();

            $resp = [
                'session' => [
                    'token' => $session['token'],
                    'mod_id' => $session['mod_id'],
                    'map_bounds' => [
                        'min_x' => (float)$session['min_x'],
                        'min_y' => (float)$session['min_y'],
                        'max_x' => (float)$session['max_x'],
                        'max_y' => (float)$session['max_y'],
                    ],
                ],
                'players' => $players,
                'vehicles' => $vehicles,
                'hospitals' => $hospitals,
                'events' => $events,
                'time' => $time,
            ];
            respond_json(200, $resp);
            break;

        case 'update_vehicles':
            $data = get_json_input();
            $token = $data['session_token'] ?? null;
            $session = require_session($pdo, $token);
            $sid = $session['id'];

            foreach (($data['updates'] ?? []) as $u) {
                $prev = get_vehicle_by_game_id($pdo, $sid, $u['game_vehicle_id']);
                upsert_vehicle($pdo, $sid, $u);
                $curr = get_vehicle_by_game_id($pdo, $sid, $u['game_vehicle_id']);
                if ($prev) {
                    if ($prev['status'] != $curr['status']) {
                        log_activity($pdo, $sid, 'vehicle', $curr['id'], 'Vehicle status changed', [
                            'vehicle_id' => $curr['id'], 'game_vehicle_id' => $curr['game_vehicle_id'],
                            'from' => (int)$prev['status'], 'to' => (int)$curr['status']
                        ]);
                    }
                    if ($prev['x'] != $curr['x'] || $prev['y'] != $curr['y']) {
                        log_activity($pdo, $sid, 'vehicle', $curr['id'], 'Vehicle moved', [
                            'vehicle_id' => $curr['id'], 'from' => ['x'=>(float)$prev['x'],'y'=>(float)$prev['y']],
                            'to' => ['x'=>(float)$curr['x'],'y'=>(float)$curr['y']]
                        ]);
                    }
                } else {
                    log_activity($pdo, $sid, 'vehicle', $curr['id'], 'Vehicle appeared', ['vehicle_id' => $curr['id']]);
                }
            }
            respond_json(200, ['ok' => true]);
            break;

        case 'update_hospitals':
            $data = get_json_input();
            $token = $data['session_token'] ?? null;
            $session = require_session($pdo, $token);
            $sid = $session['id'];

            foreach (($data['updates'] ?? []) as $h) {
                $stmt = $pdo->prepare('SELECT * FROM hospitals WHERE session_id = ? AND game_hospital_id = ?');
                $stmt->execute([$sid, $h['game_hospital_id']]);
                $prev = $stmt->fetch();

                upsert_hospital($pdo, $sid, $h);

                $stmt->execute([$sid, $h['game_hospital_id']]);
                $curr = $stmt->fetch();

                if ($prev) {
                    if ($prev['icu_available'] != $curr['icu_available'] || $prev['ward_available'] != $curr['ward_available']) {
                        log_activity($pdo, $sid, 'hospital', $curr['id'], 'Hospital bed update', [
                            'hospital_id' => $curr['id'],
                            'icu_from' => (int)$prev['icu_available'], 'icu_to' => (int)$curr['icu_available'],
                            'ward_from' => (int)$prev['ward_available'], 'ward_to' => (int)$curr['ward_available']
                        ]);
                    }
                } else {
                    log_activity($pdo, $sid, 'hospital', $curr['id'], 'Hospital added', ['hospital_id'=>$curr['id']]);
                }
            }
            respond_json(200, ['ok'=>true]);
            break;

        case 'update_events':
            $data = get_json_input();
            $token = $data['session_token'] ?? null;
            $session = require_session($pdo, $token);
            $sid = $session['id'];

            foreach (($data['updates'] ?? []) as $e) {
                if (isset($e['game_event_id'])) {
                    $stmt = $pdo->prepare('SELECT * FROM events WHERE session_id = ? AND game_event_id = ?');
                    $stmt->execute([$sid, $e['game_event_id']]);
                    $prev = $stmt->fetch();
                } else {
                    $prev = null;
                }
                $e['created_by'] = 'game';
                $curr = upsert_event($pdo, $sid, $e);

                if ($prev) {
                    if ($prev['status'] !== $curr['status']) {
                        log_activity($pdo, $sid, 'event', $curr['id'], 'Event status changed', [
                            'event_id' => $curr['id'], 'from' => $prev['status'], 'to' => $curr['status']
                        ]);
                    } else if ($prev['x'] != $curr['x'] || $prev['y'] != $curr['y']) {
                        log_activity($pdo, $sid, 'event', $curr['id'], 'Event moved', [
                            'event_id'=>$curr['id'], 'from'=>['x'=>(float)$prev['x'],'y'=>(float)$prev['y']], 'to'=>['x'=>(float)$curr['x'],'y'=>(float)$curr['y']]
                        ]);
                    }
                } else {
                    log_activity($pdo, $sid, 'event', $curr['id'], 'Event created', ['event_id'=>$curr['id'], 'source'=>'game']);
                }
            }
            respond_json(200, ['ok'=>true]);
            break;

        case 'events_create':
            $data = get_json_input();
            $token = $data['session_token'] ?? null;
            $session = require_session($pdo, $token);
            $sid = $session['id'];
            $e = [
                'name' => $data['name'] ?? 'Event',
                'x' => n($data['x'] ?? 0),
                'y' => n($data['y'] ?? 0),
                'status' => 'active',
                'created_by' => 'frontend'
            ];
            $event = upsert_event($pdo, $sid, $e);
            log_activity($pdo, $sid, 'event', $event['id'], 'Event created', ['event_id'=>$event['id'], 'source'=>'frontend']);
            //Create Command for Game
            $payload = [
                'event_id' => (int)$event['id'],
                'name' => $data['name'],
                'target' => ['x'=>(float)$data['x'],'y'=>(float)$data['y']]
            ];

            $stmt = $pdo->prepare('INSERT INTO commands (session_id, type, payload) VALUES (?, ?, ?)');
            $stmt->execute([$sid, 'event_create', json_encode($payload, JSON_UNESCAPED_UNICODE)]);

            respond_json(200, ['ok'=>true, 'event'=>$event]);
            break;

        case 'events_finish':
            // Mark a frontend-created event as completed
            // JSON: { session_token, event_id }
            $data = get_json_input();
            $token = $data['session_token'] ?? null;
            $session = require_session($pdo, $token);
            $sid = $session['id'];

            $event_id = $data['event_id'] ?? null;
            if (!$event_id) respond_json(400, ['error'=>'Missing event_id']);

            $stmt = $pdo->prepare('SELECT * FROM events WHERE id = ? AND session_id = ?');
            $stmt->execute([$event_id, $sid]);
            $ev = $stmt->fetch();
            if (!$ev) respond_json(404, ['error'=>'Event not found']);
            if ($ev['created_by'] !== 'frontend') respond_json(403, ['error'=>'Only frontend-created events can be finished here']);

            $stmt = $pdo->prepare("UPDATE events SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND session_id = ?");
            $stmt->execute([$event_id, $sid]);

            log_activity($pdo, $sid, 'event', $event_id, 'Event finished (frontend)', ['event_id'=>$event_id]);
            
            //Create Command for Game
            $payload = [
                'event_id' => (int)$event_id,
                'event_game_id' => (int)$ev["game_event_id"]
            ];

            $stmt = $pdo->prepare('INSERT INTO commands (session_id, type, payload) VALUES (?, ?, ?)');
            $stmt->execute([$sid, 'event_delete', json_encode($payload, JSON_UNESCAPED_UNICODE)]);

            respond_json(200, ['ok'=>true]);
            break;

        case 'events_assign':
            $data = get_json_input();
            $token = $data['session_token'] ?? null;
            $session = require_session($pdo, $token);
            $sid = $session['id'];

            $event_id = $data['event_id'] ?? null;
            if (!$event_id) respond_json(400, ['error'=>'Missing event_id']);
            $stmt = $pdo->prepare('SELECT * FROM events WHERE id = ? AND session_id = ?');
            $stmt->execute([$event_id, $sid]);
            $event = $stmt->fetch();
            if (!$event) respond_json(404, ['error'=>'Event not found']);

            $vehicle_ids = $data['vehicle_ids'] ?? [];
            $player_id = $data['player_id'] ?? null;
            $modes = $data['modes'] ?? null;

            if ($player_id) {
                $stmt = $pdo->prepare('SELECT 1 FROM players WHERE id = ? AND session_id = ?');
                $stmt->execute([$player_id, $sid]);
                if (!$stmt->fetchColumn()) $player_id = null;
            }

            // Prepared lookups
            $vehLookup = $pdo->prepare('SELECT id, game_vehicle_id FROM vehicles WHERE id = ? AND session_id = ?');

            $pdo->beginTransaction();
            foreach ($vehicle_ids as $vid) {
                // Fetch game_vehicle_id for payload
                $vehLookup->execute([$vid, $sid]);
                $veh = $vehLookup->fetch();
                if (!$veh) {
                    // Skip unknown vehicle id (or respond_json with 404 if you prefer hard fail)
                    continue;
                }
                unassign_vehicle($pdo,$sid, $vid);
                
                $stmt = $pdo->prepare('INSERT INTO assignments (session_id, event_id, vehicle_id, assigned_player_id, status)
                    VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE assigned_player_id = VALUES(assigned_player_id), status = VALUES(status), updated_at = CURRENT_TIMESTAMP');
                $stmt->execute([$sid, $event_id, $vid, $player_id, 'enroute']);

                $payload = [
                    'event_id' => (int)$event_id,
                    'event_game_id' => $event['game_event_id'] ?? null,   // optional helper
                    'vehicle_id' => (int)$vid,
                    'game_vehicle_id' => $veh['game_vehicle_id'],         // ← added
                    'target' => ['x'=>(float)$event['x'],'y'=>(float)$event['y']],
                    'assign_to_player_id' => $player_id ? (int)$player_id : null
                ];
                
                if(isset($modes[$vid]) ){
                    $payload["mode"]=$modes[$vid];
                }

                $stmt = $pdo->prepare('INSERT INTO commands (session_id, type, payload) VALUES (?, ?, ?)');
                $stmt->execute([$sid, 'assign', json_encode($payload, JSON_UNESCAPED_UNICODE)]);

                if ($player_id) {
                    $stmt = $pdo->prepare('UPDATE vehicles SET assigned_player_id = ? WHERE id = ? AND session_id = ?');
                    $stmt->execute([$player_id, $vid, $sid]);
                }
            }
            $pdo->commit();

            log_activity($pdo, $sid, 'event', $event_id, 'Units assigned to event', [
                'event_id'=>$event_id, 'vehicle_ids'=>$vehicle_ids, 'player_id'=>$player_id
            ]);
            respond_json(200, ['ok'=>true]);
            break;
            
        case 'events_get_vehicles':
            $data = get_json_input();
            $token = $data['session_token'] ?? null;
            $session = require_session($pdo, $token);
            $sid = $session['id'];

            $event_id = $data['event_id'] ?? null;
            if (!$event_id) respond_json(400, ['error'=>'Missing event_id']);
            $stmt = $pdo->prepare('SELECT vehicles.id, name, vehicles.status as status FROM assignments join vehicles on vehicles.session_id = assignments.session_id and vehicles.id=assignments.vehicle_id WHERE assignments.event_id = ? AND assignments.session_id = ?');
            $stmt->execute([$event_id, $sid]);
            $vehicles = $stmt->fetchAll();
            respond_json(200, ['ok'=>true,'vehicles'=>$vehicles]);
            break;

        case 'events_unassign':
            $data = get_json_input();
            $token = $data['session_token'] ?? null;
            $session = require_session($pdo, $token);
            $sid = $session['id'];

            $vehicle_ids = $data['vehicle_ids'] ?? [];
            if (!is_array($vehicle_ids) || count($vehicle_ids) === 0) {
                respond_json(400, ['error' => 'Missing vehicle_ids']);
            }

            // Prepared lookups
            $vehLookup = $pdo->prepare('SELECT id, game_vehicle_id FROM vehicles WHERE id = ? AND session_id = ?');

            $pdo->beginTransaction();
            foreach ($vehicle_ids as $vid) {
                // Verify vehicle belongs to this session and fetch game_vehicle_id for payload
                $vehLookup->execute([$vid, $sid]);
                $veh = $vehLookup->fetch();
                if (!$veh) {
                    // Skip unknown vehicle id (mirror events_assign behavior)
                    continue;
                }

                unassign_vehicle($pdo,$sid, $vid);

                // Emit a command so the game client can react
                $payload = [
                    'event_id' => -1,
                    'vehicle_id' => (int)$vid,
                    'game_vehicle_id' => $veh['game_vehicle_id'],
                    'assign_to_player_id' => null
                ];
                $stmt = $pdo->prepare(query: 'INSERT INTO commands (session_id, type, payload) VALUES (?, ?, ?)');
                $stmt->execute([$sid, 'unassign', json_encode($payload, JSON_UNESCAPED_UNICODE)]);
            }
            $pdo->commit();

            log_activity($pdo, $sid, 'event', null, 'Units unassigned from event', [
                'vehicle_ids' => $vehicle_ids
            ]);
            respond_json(200, ['ok' => true]);
            break;
        
        case 'events_get_note':
            $data = get_json_input();
            $token = $data['session_token'] ?? null;
            $event = $data['event_id'] ?? null;
            $session = require_session($pdo, $token);
            $sid = $session['id'];

            if(!$token || !$event){
                respond_json(400, ['error' => 'session_token, event_id needed']);
            }
            $stmt = $pdo->prepare('SELECT * FROM notes WHERE session_id = ? AND event_id = ?');
            $stmt->execute([$sid, $event]);
            $rows = $stmt->fetchAll();
            respond_json(200, ['notes'=>$rows]);
            break;
            
        case 'events_set_note':
            $data = get_json_input();
            $token = $data['session_token'] ?? null;
            $event = $data['event_id'] ?? null;
            $content = $data['content'] ?? null;
            if(!$token || !$event || !$content){
                respond_json(400, ['error' => 'session_token, event_id, content needed '.$data]);
            }
            $session = require_session($pdo, $token);

            $sid = $session['id'];
            $note = upsert_notes($pdo, $sid, $data);
            respond_json(200, ['ok'=>true, 'note'=>$note]);
            break;

        case 'vehicles_assign_player':
            $data = get_json_input();
            $token = $data['session_token'] ?? null;
            $session = require_session($pdo, $token);
            $sid = $session['id'];
            $vehicle_id = $data['vehicle_id'] ?? null;
            $player_id = $data['player_id'] ?? null;
            if (!$vehicle_id || !$player_id) respond_json(400, ['error'=>'Missing vehicle_id or player_id']);
            $stmt = $pdo->prepare('UPDATE vehicles SET assigned_player_id = ? WHERE id = ? AND session_id = ?');
            $stmt->execute([$player_id, $vehicle_id, $sid]);
            log_activity($pdo, $sid, 'vehicle', $vehicle_id, 'Vehicle assigned to player', ['vehicle_id'=>$vehicle_id, 'player_id'=>$player_id]);
            respond_json(200, ['ok'=>true]);
            break;

        case 'commands_pending':
            $token = $_GET['session_token'] ?? null;
            $session = require_session($pdo, $token);
            $sid = $session['id'];
            $last_id = isset($_GET['last_id']) ? (int)$_GET['last_id'] : 0;
            $stmt = $pdo->prepare('SELECT * FROM commands WHERE session_id = ? AND id > ? AND processed = 0 ORDER BY id ASC LIMIT 500');
            $stmt->execute([$sid, $last_id]);
            $rows = $stmt->fetchAll();
            respond_json(200, ['commands'=>$rows]);
            break;

        case 'commands_ack':
            $data = get_json_input();
            $token = $data['session_token'] ?? null;
            $session = require_session($pdo, $token);
            $sid = $session['id'];
            $ids = $data['command_ids'] ?? [];
            if (!$ids) respond_json(400, ['error'=>'Empty command_ids']);
            $in = implode(',', array_fill(0, count($ids), '?'));
            $params = $ids;
            array_unshift($params, $sid);
            $stmt = $pdo->prepare("UPDATE commands SET processed = 1, processed_at = CURRENT_TIMESTAMP WHERE session_id = ? AND id IN ($in)");
            $stmt->execute($params);
            respond_json(200, ['ok'=>true, 'updated'=>count($ids)]);
            break;

        case 'logs':
            $token = $_GET['session_token'] ?? null;
            $session = require_session($pdo, $token);
            $sid = $session['id'];
            $since_id = isset($_GET['since_id']) ? (int)$_GET['since_id'] : 0;
            $stmt = $pdo->prepare('SELECT * FROM activity_logs WHERE session_id = ? AND id > ? ORDER BY id ASC LIMIT 1000');
            $stmt->execute([$sid, $since_id]);
            $rows = $stmt->fetchAll();
            respond_json(200, ['logs'=>$rows]);
            break;

        default:
            respond_json(400, ['error' => 'Unknown or missing action']);
    }
} catch (Exception $e) {
    respond_json(500, ['error' => $e->getMessage()]);
}
