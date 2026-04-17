export const DEFAULT_SETTINGS = {
  posX: 0,
  posZ: 0,
  height: 4,
  power: 35,
};

export function renderGameUI(app) {
  app.innerHTML = `
    <div id="playPreloader" class="play-preloader">
      <div class="sigil"></div>
      <p>SUMMONING</p>
    </div>
    <div class="arena-panel">
      <label>
        Arena
        <select id="arenaSelect"></select>
        <span id="arenaTag">Classic</span>
      </label>
      <p id="arenaHint" class="hint"></p>
    </div>
    <div class="action-hud">
      <div class="action-row">
        <div class="height-meter" id="heightMeter" aria-label="Height meter">
          <div class="power-meter-track"></div>
          <div id="heightFill" class="height-meter-fill"></div>
          <div id="heightMarker" class="height-meter-marker"></div>
          <p id="heightValue" class="meter-value">4.0</p>
          <p class="meter-label">height</p>
        </div>
        <div id="actionButtons" class="buttons action-buttons">
          <button id="launchBtn" type="button">Power</button>
          <button id="resetBtn" type="button">Next Round</button>
        </div>
        <div class="power-meter" id="powerMeter" aria-label="Power meter">
          <div class="power-meter-track"></div>
          <div id="powerFill" class="power-meter-fill"></div>
          <div id="powerMarker" class="power-meter-marker"></div>
          <p class="meter-label">power</p>
        </div>
      </div>
    </div>
    <div id="miniMap" class="mini-map" aria-label="Caps position map">
      <div class="mini-map-grid"></div>
      <div id="miniLowerDot" class="mini-dot lower"></div>
      <div id="miniUpperDot" class="mini-dot upper"></div>
      <p class="mini-label lower">lower</p>
      <p class="mini-label upper">upper</p>
    </div>
    <div id="status" class="status" aria-live="polite">
      <p id="statusMove" class="status-move">choose a position to hit</p>
      <p id="statusCpuMove" class="status-cpu-move">computer move: waiting</p>
      <p id="statusScore" class="status-score">r1/4 • you 0 - cpu 0</p>
    </div>
    <div id="centerNotice" class="center-notice" aria-live="polite"></div>
  `;

  return {
    arenaHintEl: app.querySelector("#arenaHint"),
    arenaTagEl: app.querySelector("#arenaTag"),
    arenaSelectEl: app.querySelector("#arenaSelect"),
    heightMeterEl: app.querySelector("#heightMeter"),
    heightFillEl: app.querySelector("#heightFill"),
    heightMarkerEl: app.querySelector("#heightMarker"),
    heightValueEl: app.querySelector("#heightValue"),
    statusEl: app.querySelector("#status"),
    statusMoveEl: app.querySelector("#statusMove"),
    statusCpuMoveEl: app.querySelector("#statusCpuMove"),
    statusScoreEl: app.querySelector("#statusScore"),
    centerNoticeEl: app.querySelector("#centerNotice"),
    launchBtn: app.querySelector("#launchBtn"),
    resetBtn: app.querySelector("#resetBtn"),
    actionButtonsEl: app.querySelector("#actionButtons"),
    miniMapEl: app.querySelector("#miniMap"),
    miniLowerDotEl: app.querySelector("#miniLowerDot"),
    miniUpperDotEl: app.querySelector("#miniUpperDot"),
    miniLowerLabelEl: app.querySelector(".mini-label.lower"),
    miniUpperLabelEl: app.querySelector(".mini-label.upper"),
    powerMeterEl: app.querySelector("#powerMeter"),
    powerFillEl: app.querySelector("#powerFill"),
    powerMarkerEl: app.querySelector("#powerMarker"),
    playPreloaderEl: app.querySelector("#playPreloader"),
  };
}
