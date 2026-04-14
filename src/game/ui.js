export const DEFAULT_SETTINGS = {
  posX: 0,
  posZ: 0,
  height: 4,
  power: 35,
  spin: 18,
};

const SLIDER_FORMATTERS = {
  posX: (value) => value.toFixed(1),
  posZ: (value) => value.toFixed(1),
  height: (value) => value.toFixed(1),
  power: (value) => value.toFixed(1),
  spin: (value) => value.toFixed(1),
};

const SLIDER_DEFS = [
  { id: "posX", key: "posX" },
  { id: "posZ", key: "posZ" },
  { id: "height", key: "height" },
  { id: "power", key: "power" },
  { id: "spin", key: "spin" },
];

export function renderGameUI(app) {
  app.innerHTML = `
    <div class="panel">
      <h1>Disc Drop</h1>
      <p>Goal: end with two green faces up. Orbit with mouse drag.</p>
      <label>
        Arena
        <select id="arenaSelect"></select>
        <span id="arenaTag">Classic</span>
      </label>
      <p id="arenaHint" class="hint"></p>
      <label>
        Position X
        <input id="posX" type="range" min="-4" max="4" step="0.1" value="0" />
        <span id="posXValue">0.0</span>
      </label>
      <label>
        Position Z
        <input id="posZ" type="range" min="-4" max="4" step="0.1" value="0" />
        <span id="posZValue">0.0</span>
      </label>
      <label>
        Height
        <input id="height" type="range" min="2" max="8" step="0.1" value="4" />
        <span id="heightValue">4.0</span>
      </label>
      <label>
        Power
        <input id="power" type="range" min="0" max="100" step="0.1" value="35" />
        <span id="powerValue">35.0</span>
      </label>
      <label>
        Spin
        <input id="spin" type="range" min="-40" max="40" step="0.1" value="18" />
        <span id="spinValue">18.0</span>
      </label>
      <div class="buttons">
        <button id="launchBtn" type="button">Launch</button>
        <button id="resetBtn" type="button">Reset Round</button>
      </div>
      <p id="status" class="status">Set your shot and press Launch.</p>
    </div>
  `;

  const sliders = {};
  for (const { id, key } of SLIDER_DEFS) {
    sliders[key] = {
      input: app.querySelector(`#${id}`),
      value: app.querySelector(`#${id}Value`),
      format: SLIDER_FORMATTERS[key],
    };
  }

  return {
    arenaHintEl: app.querySelector("#arenaHint"),
    arenaTagEl: app.querySelector("#arenaTag"),
    arenaSelectEl: app.querySelector("#arenaSelect"),
    statusEl: app.querySelector("#status"),
    launchBtn: app.querySelector("#launchBtn"),
    resetBtn: app.querySelector("#resetBtn"),
    sliders,
  };
}
