<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EMDispatch</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <header class="topbar">
    <div class="brand">EMDispatch</div>
    <div id="time-panel">--:--</div>
    <div id="game-states" style="display:flex"></div>
    <div class="settings">
      <label>Session Token: <input id="sessionToken" placeholder="a123" size="10" <?php
        if(isset($_GET['session_token']))
          echo 'value="'.$_GET['session_token'].'"';
        ?>></label>
      <input type="hidden" id="pin" <?php
        if(isset($_GET['pin']))
          echo 'value="'.$_GET['pin'].'"';
        ?>>
      <button id="saveSettings">Save</button>
      <button id="reloadBtn" class="icon-btn only" title="Neu laden"></button>
      <button id="statsBtn" title="Einsatzstatistik anzeigen">Statistik</button>
    </div>
  </header>

  <main class="grid" id="grid">
    <div class="grid-col2" id="grid-left" style="grid-template-rows: 1.4fr 6px 1fr;">
      <section class="panel" id="panel-map" style="grid-column: 1; grid-row: 1;">
        <div class="panel-header"><h2>Karte</h2></div>
        <div class="map-wrapper" id="mapWrapper">
          <img id="mapImage" alt="Map">
          <canvas id="mapCanvas"></canvas>
        </div>
        <div class="legend">
          <span class="chip"><span class="mk mk-veh"></span> Fahrzeug</span>
          <span class="chip"><span class="mk mk-evt"></span> Einsatz</span>
          <span style="color:var(--muted2)">Rechtsklick = neuen Einsatz anlegen</span>
        </div>
      </section>
      <div class="gutter-row" id="gutter-row" data-grid-key="left" data-track-index="0" style="grid-column: 1 / span 1; grid-row: 2" title="Zeilen anpassen"></div>
      <div class="panel-row panel-row-log" style="grid-column: 1; grid-row: 3;">
        <section class="panel panel-log" id="panel-log">
          <div class="panel-header"><h2>Aktivitätslog</h2></div>
          <div class="panel-body log-single">
            <div class="log log-pinned" id="talkLog"></div>
            <div class="log" id="statusLog"></div>
          </div>
        </section>
        <section class="panel panel-hospitals" id="panel-hospitals">
          <div class="panel-header"><h2>Krankenhäuser</h2></div>
          <div class="panel-body"><div id="hospitalsList"></div></div>
        </section>
      </div>
    </div>

    <div class="gutter-col" id="gutter-col" style="grid-column: 2; grid-row: 1 / span 2" title="Spalten anpassen"></div>

    <div class="grid-col" id="grid-right" style="grid-area: 1 / 3; grid-template-rows: 0.82fr 6px 1.25fr;">
      <section class="panel" id="panel-vehicles" style="grid-column: 1; grid-row: 1;">
        <div class="panel-header"><h2>Fahrzeuge</h2></div>
        <div class="panel-body">
          <div class="vtabs" id="vehTabs">
            <button data-tab="fw" class="active">Feuerwehr</button>
            <button data-tab="rd">Rettungsdienst</button>
          </div>
          <div class="toolbar" id="vehToolbar">
            <input type="text" id="vehSearch" placeholder="Suche Fahrzeug / Wache…">
            <div class="seg" id="vehStatusSeg">
              <button data-f="all" class="active">Alle</button>
              <button data-f="free">Frei</button>
              <button data-f="deployed">Im Einsatz</button>
            </div>
          </div>
          <div id="vehiclesList"></div>
        </div>
      </section>

      <div class="gutter-row" id="gutter-row1" data-grid-key="right" data-track-index="0" style="grid-column: 1; grid-row: 2" title="Zeilen anpassen"></div>

      <section class="panel" id="panel-events" style="grid-column: 1; grid-row: 3;">
        <div class="panel-header"><h2>Einsätze</h2></div>
        <div class="panel-body" id="eventsList"></div>
      </section>
    </div>
  </main>

  <!-- Alarmierungsfenster -->
  <div id="assignModal" class="modal hidden">
    <div class="modal-content">
      <div class="modal-header">
        <h3 id="assignEventInfo">Alarmierung</h3>
        <button id="closeAssign">×</button>
      </div>
      <div class="modal-body">
        <div class="modal-col">
          <p class="mlbl mlbl-row">Verfügbare Kräfte (Status 1/2)
            <label class="sorttoggle" title="Fahrzeuge innerhalb der Wache nach Entfernung zum Einsatzort sortieren">
              <input type="checkbox" id="assignSortDist" checked> Nach Distanz sortieren
            </label>
          </p>
          <input type="text" id="assignSearch" class="msel" style="margin-bottom:10px" placeholder="Kräfte suchen…">
          <div id="assignVehicles"></div>
        </div>
        <div class="modal-col">
          <p class="mlbl">Zuweisung an Spieler</p>
          <select id="assignPlayer" class="msel"><option value="">— Alle / Host —</option></select>
          <p class="mlbl mt">Ausgewählt</p>
          <div class="mchosen" id="selectedVehicles"></div>
          <p class="mlbl mt">Bereits zugewiesen</p>
          <div id="assignAssignedVehicles"></div>
          <p class="mlbl mt">Notiz</p>
          <textarea id="assignEventComments" placeholder="z.B. Gefahrgut, Zufahrt Nord"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button id="submitAssign">Alarmieren</button>
      </div>
    </div>
  </div>

  <!-- Statistik -->
  <div id="statsModal" class="modal hidden">
    <div class="modal-content stats-content">
      <div class="modal-header">
        <h3>Statistik</h3>
        <button id="closeStats">×</button>
      </div>
      <div class="modal-body stats-body" id="statsBody"></div>
    </div>
  </div>

  <script src="./icons.js"></script>
  <script src="./app.js"></script>
  <?php
  if(isset($_GET['session_token']))
    echo '<script>saveSettings();</script>';
  ?>
</body>
</html>
