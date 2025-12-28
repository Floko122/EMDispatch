<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Game Ops Dashboard</title>
  <link rel="stylesheet" href="./styles.css"/>
</head>
<body>
  <header class="topbar">
    <div class="brand">EM Dispatcher</div>
    <div id="time-panel"></div>
    <div id="game-states"></div>
    <div class="settings">
      <label style="display:none">API Base: <input style="display:none" id="apiBase" type="text" placeholder="../backend/api.php" value="<?php  echo dirname($_SERVER['PHP_SELF'])."/../backend/api.php";?>"/></label>
      <label>Session Token: <input id="sessionToken" placeholder="a123" <?php  
			if(isset($_GET['session_token']))
				echo 'value="'.$_GET['session_token'].'"';
			?>/></label>
      <button id="saveSettings">Save</button>
      <button id="reloadBtn" title="Reload state">↻</button>
    </div>
  </header>
  <main class="grid" id="grid">
    <!-- Row 1 -->
     <div class="grid-col2" id="grid-left">
        <section class="panel" id="panel-map" style="grid-column: 1; grid-row: 1;">
          <div class="panel-header">
            <h2>Map</h2>
          </div>
          <div class="map-wrapper" id="mapWrapper">
            <img id="mapImage" src="" alt="Map"/>
            <canvas id="mapCanvas"></canvas>
          </div>
          <div class="legend">
            <span class="chip veh">Vehicle</span>
            <span class="chip evt">Event</span>
          </div>
        </section>
      <div class="gutter-row" id="gutter-row" data-grid-key="left" data-track-index="0" style="grid-column: 1 / span 1; grid-row: 2" title="Drag to resize rows"></div>
      <div class="panel-row panel-row-log" style="grid-column: 1; grid-row: 3;">
        <section class="panel panel-log" id="panel-log">
          <div class="panel-header">
            <h2>Activity Log</h2>
          </div>
          <div class="panel-body log" id="activityLog"></div>
        </section>
        <section class="panel panel-hospitals" id="panel-hospitals">
          <div class="panel-header">
            <h2>Hospitals</h2>
          </div>
          <div class="panel-body">
            <div id="hospitalsList"></div>
          </div>
        </section>
      </div>

    </div>

    <div class="gutter-col" id="gutter-col" style="grid-column: 2; grid-row: 1 / span 2" title="Drag to resize columns"></div>

    <div class="grid-col" id="grid-right" style="grid-column: 3; grid-row: 1;">
      <section class="panel" id="panel-vehicles" style="grid-column: 1; grid-row: 1;">
        <div class="panel-header">
          <h2>Vehicles</h2>
        </div>
        <div class="panel-body ">
          <div id="vehiclesList"></div>
        </div>
      </section>
      
      <div class="gutter-row" id="gutter-row1" data-grid-key="right" data-track-index="0" style="grid-column: 1; grid-row: 2" title="Drag to resize rows"></div>


      <section class="panel" id="panel-events" style="grid-column: 1; grid-row: 3;">
        <div class="panel-header">
          <h2>Events</h2>
        </div>
        <div class="panel-body" id="eventsList"></div>
      </section>
    </div>
    
  </main>

  <!-- Assignment Modal -->
  <div id="assignModal" class="modal hidden">
    <div class="modal-content">
      <div class="modal-header">
        <h3 id="assignEventInfo">Assign Units to Event</h3>
        <button id="closeAssign">×</button>
      </div>
      <div class="modal-body row">
        <div class="column" style="width: 20%;">
          <!--<div id="assignEventInfo"></div>-->
          <div class="panel2">
            <header>Notes</header>
            <textarea id="assignEventComments"></textarea>
          </div>
        </div>
        <div class="column" style="width: 75%;">
          <div class="form-row">
            <label>Assign to Player:</label>
            <select id="assignPlayer">
              <option value="">— None —</option>
            </select>
          </div>
          <div class="form-row">
            <label>Assigned:</label>
            <div id="assignAssignedVehicles" class="checklist"></div>
          </div>
          <div class="form-row">
            <label>Selected:</label>
            <div id="selectedVehicles"></div>
          </div>
          <div class="form-row">
            <label>Available Units (status 1 or 2):</label>
            <div id="assignVehicles" class="checklist"></div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button id="submitAssign">Send</button>
      </div>
    </div>
  </div>

  <script src="./app.js"></script>
  <?php  
  if(isset($_GET['session_token']))
    echo '<script>saveSettings();</script>';
  ?>
</body>
</html>
