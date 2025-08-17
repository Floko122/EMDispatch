# Game Ops Dashboard

Full-stack sample for a video-game operations dashboard.

## What's included
- **Backend**: PHP + MySQL (PDO), single `api.php` with actions.
- **Frontend**: HTML + JS + CSS SPA with four panels (map, vehicles, events, activity log).
- **DB**: `db/schema.sql` with all required tables.

## Setup

### Database
1. Create the schema:
   ```sql
   SOURCE db/schema.sql;
   ```

### Backend
1. Place the `backend/` folder on a PHP-capable server.
2. Edit `backend/config.php` to set DB credentials (or use env vars `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`).

### Frontend
1. Serve the `frontend/` folder (can be the same server).
2. Open `frontend/index.html` in a browser.
3. Enter your **API Base** (e.g. `/backend/api.php`) and a **Session Token** (any string).
4. Have the game call `action=sync` at least once to initialize the session.

## API Overview (game → backend)
- `POST /backend/api.php?action=sync`
  Initialize/update session (map bounds, players, vehicles, hospitals, events).

- `POST /backend/api.php?action=update_vehicles`
  Push vehicle status/position changes.

- `POST /backend/api.php?action=update_hospitals`
  Push bed availability changes.

- `POST /backend/api.php?action=update_events`
  Create/update/complete events from the game.

- `GET  /backend/api.php?action=commands_pending&session_token=...&last_id=0`
  Poll for pending frontend-originating commands.

- `POST /backend/api.php?action=commands_ack`
  Acknowledge processed commands (`{command_ids:[...]}`).

## API Overview (frontend → backend)
- `GET  /backend/api.php?action=state&session_token=...`
- `POST /backend/api.php?action=events_create`
- `POST /backend/api.php?action=events_assign`
- `POST /backend/api.php?action=vehicles_assign_player`
- `GET  /backend/api.php?action=logs&session_token=...`

## Coordinate System
The game provides **map bounds** (`min_x,min_y,max_x,max_y`). The frontend maps world coordinates to the displayed map image (object-fit: contain) and supports pan+zoom. Right-click on the map to create a new frontend-side event at the clicked world coordinate.

## Vehicles & Assignment
- Vehicles with **status 1 or 2** are considered "available" in the UI.
- Selecting an event (left-click on the map or via the Events panel) opens a modal to assign units and optionally bind them to a specific player.
- Assignments create `commands` of type `assign`, which the game can poll via `commands_pending` and then `commands_ack` them when processed.

## Grouping (Vehicles panel)
Optionally provide a JSON file like:
```json
{
  "groups": {
    "Ambulances": { "types": ["Ambulance"] },
    "Team Alpha": { "ids": [1,2,3] }
  }
}
```

## Notes
- CORS is wide-open by default; restrict `CORS_ALLOW_ORIGIN` for production.
- For simplicity this sample uses **polling** rather than websockets.
- Add auth as needed; this demo trusts any holder of the `session_token`.
