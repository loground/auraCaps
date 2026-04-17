import "./style.css";
import { ARENA_CONFIGS, DEFAULT_ARENA_KEY } from "./game/arena-configs.js";

const app = document.querySelector("#app");
const hoverSfxTemplate = new Audio("/sounds/menuHover.mp3");
hoverSfxTemplate.preload = "auto";
const hoverTargetsSelector = "button";
const collectionHoverTargetsSelector = ".disc-card, .inspect-btn";
let lastHoverSfxAt = 0;
let soundEnabled = true;
const AURA_SESSION_KEY = "aura_session_v1";
let auraSession = loadAuraSession();

function loadAuraSession() {
  try {
    const raw = window.localStorage.getItem(AURA_SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.connected) {
      return null;
    }
    return {
      connected: true,
      walletAddress: parsed.walletAddress || "",
      user: parsed.user || null,
    };
  } catch {
    return null;
  }
}

function saveAuraSession(session) {
  try {
    if (session?.connected) {
      window.localStorage.setItem(AURA_SESSION_KEY, JSON.stringify(session));
      return;
    }
    window.localStorage.removeItem(AURA_SESSION_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function composeCleanups(...cleanups) {
  return () => {
    for (const cleanup of cleanups) {
      if (typeof cleanup === "function") {
        cleanup();
      }
    }
  };
}

function syncSoundButtonsUI() {
  const menuBtn = app.querySelector("#soundToggle");
  if (menuBtn) {
    menuBtn.classList.toggle("active", soundEnabled);
    menuBtn.textContent = `sound: ${soundEnabled ? "on" : "off"}`;
  }
  const menuMuteBtn = app.querySelector("#menuMuteToggle");
  if (menuMuteBtn) {
    menuMuteBtn.classList.toggle("muted", !soundEnabled);
    menuMuteBtn.textContent = soundEnabled ? "mute: off" : "mute: on";
  }
  const muteBtn = app.querySelector("#globalMuteBtn");
  if (muteBtn) {
    muteBtn.classList.toggle("muted", !soundEnabled);
    muteBtn.textContent = soundEnabled ? "mute: off" : "mute: on";
  }
}

function addGlobalMuteButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.id = "globalMuteBtn";
  button.className = "global-mute-btn";
  app.appendChild(button);

  const onClick = () => {
    soundEnabled = !soundEnabled;
    syncSoundButtonsUI();
  };

  button.addEventListener("click", onClick);
  syncSoundButtonsUI();

  return () => {
    button.removeEventListener("click", onClick);
    button.remove();
  };
}

function playHoverSfx() {
  if (!soundEnabled) {
    return;
  }
  const now = performance.now();
  if (now - lastHoverSfxAt < 45) {
    return;
  }
  lastHoverSfxAt = now;

  try {
    const hoverSfx = hoverSfxTemplate.cloneNode();
    hoverSfx.volume = 0.7;
    const playPromise = hoverSfx.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  } catch {
    // Ignore autoplay or playback errors.
  }
}

app.addEventListener("mouseover", (event) => {
  if (app.classList.contains("mode-play")) {
    return;
  }

  if (!(event.target instanceof Element)) {
    return;
  }

  const selector = app.classList.contains("mode-collection")
    ? collectionHoverTargetsSelector
    : hoverTargetsSelector;

  const target = event.target.closest(selector);
  if (!target || !app.contains(target)) {
    return;
  }

  if (target.matches("button:disabled")) {
    return;
  }

  const fromTarget =
    event.relatedTarget instanceof Element
      ? event.relatedTarget.closest(selector)
      : null;
  if (fromTarget === target) {
    return;
  }

  playHoverSfx();
});

let cleanupScreen = null;
let game = null;
let viewVersion = 0;
let currentTheme = "hell";
let menuModulePromise = null;
let collectionModulePromise = null;
let gameModulePromise = null;

function showPlaySetupModal({ theme }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "play-setup-modal";

    const arenaKeys =
      theme === "heaven" || theme === "jungle-bay"
        ? ["classic"]
        : Object.keys(ARENA_CONFIGS);
    const arenaOptions = arenaKeys
      .map(
        (key) =>
          `<option value="${key}">${ARENA_CONFIGS[key]?.label ?? key}</option>`
      )
      .join("");

    overlay.innerHTML = `
      <div class="play-setup-backdrop"></div>
      <div class="play-setup-panel">
        <h2>Choose Battle Setup</h2>
        <p>Select map and mode before launching the round.</p>
        <label>
          Map
          <select id="setupArenaSelect">${arenaOptions}</select>
        </label>
        <div class="mode-picker">
          <span class="mode-label">Mode</span>
          <div class="mode-buttons">
            <button id="setupModeClassicBtn" class="mode-btn active" type="button">Classic</button>
            <button id="setupModeSlammerBtn" class="mode-btn" type="button">Slammer</button>
          </div>
        </div>
        <p id="setupModeHint" class="setup-hint">
          Classic: 2 caps duel. Land and spin to end with more green faces up.
        </p>
        <div class="play-setup-actions">
          <button id="setupCancelBtn" type="button">back</button>
          <button id="setupLaunchBtn" type="button">launch</button>
        </div>
      </div>
    `;

    app.appendChild(overlay);

    const arenaSelect = overlay.querySelector("#setupArenaSelect");
    const modeClassicBtn = overlay.querySelector("#setupModeClassicBtn");
    const modeSlammerBtn = overlay.querySelector("#setupModeSlammerBtn");
    const modeHint = overlay.querySelector("#setupModeHint");
    const cancelBtn = overlay.querySelector("#setupCancelBtn");
    const launchBtn = overlay.querySelector("#setupLaunchBtn");
    const backdrop = overlay.querySelector(".play-setup-backdrop");
    let selectedMode = "classic";

    if (arenaSelect) {
      arenaSelect.value = arenaKeys.includes(DEFAULT_ARENA_KEY)
        ? DEFAULT_ARENA_KEY
        : arenaKeys[0];
    }

    const updateModeUI = () => {
      if (!modeHint) {
        return;
      }
      modeClassicBtn?.classList.toggle("active", selectedMode === "classic");
      modeSlammerBtn?.classList.toggle("active", selectedMode === "slammer");
      modeHint.textContent =
        selectedMode === "slammer"
          ? "Slammer: 6 caps stack on floor. Throw heavier slammer and flip 4+ caps face up to win."
          : "Classic: 2 caps duel. Land and spin to end with more green faces up.";
    };
    updateModeUI();

    const onModeClassic = () => {
      selectedMode = "classic";
      updateModeUI();
    };
    const onModeSlammer = () => {
      selectedMode = "slammer";
      updateModeUI();
    };
    modeClassicBtn?.addEventListener("click", onModeClassic);
    modeSlammerBtn?.addEventListener("click", onModeSlammer);

    const cleanup = () => {
      modeClassicBtn?.removeEventListener("click", onModeClassic);
      modeSlammerBtn?.removeEventListener("click", onModeSlammer);
      cancelBtn?.removeEventListener("click", onCancel);
      launchBtn?.removeEventListener("click", onLaunch);
      backdrop?.removeEventListener("click", onCancel);
      overlay.remove();
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onLaunch = () => {
      const value = {
        arenaKey: arenaSelect?.value || DEFAULT_ARENA_KEY,
        gameMode: selectedMode,
      };
      cleanup();
      resolve(value);
    };

    cancelBtn?.addEventListener("click", onCancel);
    launchBtn?.addEventListener("click", onLaunch);
    backdrop?.addEventListener("click", onCancel);
  });
}

function loadMenuModule() {
  menuModulePromise ??= import("./screens/menu.js");
  return menuModulePromise;
}

function loadCollectionModule() {
  collectionModulePromise ??= import("./screens/collection.js");
  return collectionModulePromise;
}

function loadGameModule() {
  gameModulePromise ??= import("./game/DiscDropGame.js");
  return gameModulePromise;
}

function clearCurrentScreen() {
  if (cleanupScreen) {
    cleanupScreen();
    cleanupScreen = null;
  }
  if (game) {
    game.destroy();
    game = null;
  }
  app.innerHTML = "";
}

function addBackButton(onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "back-btn";
  button.textContent = "back";
  button.addEventListener("click", onClick);
  app.appendChild(button);

  return () => {
    button.removeEventListener("click", onClick);
    button.remove();
  };
}

function setViewMode(mode) {
  app.className = `mode-${mode} theme-${currentTheme}`;
}

function setTheme(nextTheme) {
  currentTheme = nextTheme;
}

async function showMenu() {
  const localVersion = ++viewVersion;
  clearCurrentScreen();
  setViewMode("menu");
  const { mountMenuScreen } = await loadMenuModule();
  if (localVersion !== viewVersion) {
    return;
  }
  cleanupScreen = mountMenuScreen({
    app,
    theme: currentTheme,
    soundEnabled,
    auraSession,
    onSoundToggle: () => {
      soundEnabled = !soundEnabled;
      syncSoundButtonsUI();
      return soundEnabled;
    },
    onAuraSuccess: (result) => {
      auraSession = {
        connected: true,
        walletAddress: result?.walletAddress || "",
        user: result?.user || null,
      };
      saveAuraSession(auraSession);
    },
    onThemeChange: (nextTheme) => {
      if (nextTheme !== currentTheme) {
        setTheme(nextTheme);
        showMenu();
      }
    },
    onPlay: showPlay,
    onCollection: showCollection,
  });
}

async function showPlay() {
  const localVersion = ++viewVersion;
  const setup = await showPlaySetupModal({ theme: currentTheme });
  if (localVersion !== viewVersion) {
    return;
  }
  if (!setup) {
    return;
  }

  clearCurrentScreen();
  setViewMode("play");
  const { DiscDropGame } = await loadGameModule();
  if (localVersion !== viewVersion) {
    return;
  }
  game = new DiscDropGame(app, {
    theme: currentTheme,
    soundEnabled,
    isSoundEnabled: () => soundEnabled,
    initialArenaKey: setup.arenaKey,
    gameMode: setup.gameMode,
  });
  await game.init();
  if (localVersion !== viewVersion) {
    return;
  }
  cleanupScreen = composeCleanups(addBackButton(showMenu), addGlobalMuteButton());
}

async function showCollection() {
  const localVersion = ++viewVersion;
  clearCurrentScreen();
  setViewMode("collection");
  const { mountCollectionScreen } = await loadCollectionModule();
  if (localVersion !== viewVersion) {
    return;
  }
  cleanupScreen = composeCleanups(
    mountCollectionScreen({ app, onBack: showMenu }),
    addGlobalMuteButton()
  );
}

showMenu();
