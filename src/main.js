import "./style.css";
import { ARENA_CONFIGS, DEFAULT_ARENA_KEY } from "./game/arena-configs.js";
import { getCapWeightMultiplier } from "./game/cap-physics.js";
import { playSound, preloadSounds, unlockSounds } from "./sound.js";
import {
  mountWalletConnectButton,
  setWalletAccessTheme,
  showInitialAccessModal,
} from "./wallet-access.js";
import {
  getVibeMarketState,
  loadVibeMarketCollectionForWallet,
} from "./vibe-market.js";

const app = document.querySelector("#app");
const THEME_STORAGE_KEY = "caps_last_theme_v1";
const THEME_OPTIONS = ["hell", "heaven", "jungle-bay", "bankr"];
const DEFAULT_THEME = "jungle-bay";
const SOUND_PATHS = [
  "/sounds/menuHover.mp3",
  "/sounds/throw.mp3",
  "/sounds/throw2.mp3",
  "/sounds/throw3.mp3",
  "/sounds/throw4.mp3",
  "/sounds/throw5.mp3",
  "/sounds/hit.mp3",
  "/sounds/win1.mp3",
  "/sounds/win2.mp3",
  "/sounds/win3.mp3",
];
preloadSounds(SOUND_PATHS);
const hoverTargetsSelector = "button";
const collectionHoverTargetsSelector = ".disc-card, .inspect-btn";
let lastHoverSfxAt = 0;
let soundEnabled = true;
const PLAYER_IDENTITY_KEY = "caps_player_identity_v1";
const ACTIVE_PVP_ROOM_KEY = "caps_active_pvp_room_v1";
const PVP_ENABLED = false;
const ROUTES = {
  menu: "/",
  battles: "/battles",
  collection: "/collection",
};
const playerIdentity = loadPlayerIdentity();
let pendingPvpInviteCode = PVP_ENABLED
  ? new URLSearchParams(window.location.search).get("pvp") || ""
  : "";
let pendingPvpInviteStarted = false;

window.addEventListener("pointerdown", unlockSounds, { once: true, passive: true });
window.addEventListener("touchstart", unlockSounds, { once: true, passive: true });

function loadPlayerIdentity() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PLAYER_IDENTITY_KEY) || "null");
    if (stored?.playerId) {
      return stored;
    }
  } catch {
    // Create a fresh local identity below.
  }
  const id = crypto.randomUUID();
  const identity = {
    playerId: id,
    username: `Player ${id.slice(0, 4).toUpperCase()}`,
  };
  try {
    window.localStorage.setItem(PLAYER_IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    // Ignore storage failures.
  }
  return identity;
}

function loadActivePvpRoom() {
  try {
    const raw = window.localStorage.getItem(ACTIVE_PVP_ROOM_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveActivePvpRoom(room) {
  try {
    if (!room?.id && !room?.code) {
      window.localStorage.removeItem(ACTIVE_PVP_ROOM_KEY);
      return;
    }
    window.localStorage.setItem(
      ACTIVE_PVP_ROOM_KEY,
      JSON.stringify({
        id: room.id || "",
        code: room.code || "",
        status: room.status || "",
        savedAt: Date.now(),
      })
    );
  } catch {
    // Ignore storage failures.
  }
}

function clearActivePvpRoom() {
  try {
    window.localStorage.removeItem(ACTIVE_PVP_ROOM_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function clearPvpResumeTarget() {
  pendingPvpInviteCode = "";
  pendingPvpInviteStarted = false;
  clearActivePvpRoom();
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("pvp")) {
      url.searchParams.delete("pvp");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    // Ignore URL cleanup failures.
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
  playSound("/sounds/menuHover.mp3", 0.7);
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
let cleanupPvpController = null;
let game = null;
let viewVersion = 0;
let currentTheme = pickRefreshTheme();
let menuModulePromise = null;
let collectionModulePromise = null;
let gameModulePromise = null;
let pvpModulePromise = null;

function getCurrentRoute() {
  const path = window.location.pathname.replace(/\/+$/, "") || ROUTES.menu;
  return Object.values(ROUTES).includes(path) ? path : ROUTES.menu;
}

function setRoute(path, { replace = false } = {}) {
  const url = new URL(window.location.href);
  url.pathname = path;
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  if (nextUrl === `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    return;
  }
  if (replace) {
    window.history.replaceState({}, "", nextUrl);
    return;
  }
  window.history.pushState({}, "", nextUrl);
}

function navigateToMenu({ replace = false } = {}) {
  setRoute(ROUTES.menu, { replace });
  showMenu();
}

function navigateToCollection() {
  setRoute(ROUTES.collection);
  showCollection();
}

function navigateToBattles({ pvpRoomCode = "" } = {}) {
  setRoute(ROUTES.battles);
  showPlay({ pvpRoomCode });
}

function returnToMenuFromCancelledBattle() {
  if (getCurrentRoute() === ROUTES.battles) {
    navigateToMenu({ replace: true });
  }
}

async function renderCurrentRoute() {
  const route = getCurrentRoute();
  if (route === ROUTES.collection) {
    await showCollection();
    return;
  }
  if (route === ROUTES.battles) {
    await showMenu({ startPendingPvpInvite: false });
    if (getCurrentRoute() === ROUTES.battles) {
      await showPlay({ pvpRoomCode: pendingPvpInviteCode });
    }
    return;
  }
  await showMenu();
}

function pickRefreshTheme() {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const selected = THEME_OPTIONS.includes(storedTheme)
      ? storedTheme
      : DEFAULT_THEME;
    window.localStorage.setItem(THEME_STORAGE_KEY, selected);
    return selected;
  } catch {
    return DEFAULT_THEME;
  }
}

function showPlaySetupModal({ theme }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "play-setup-modal";
    overlay.innerHTML = `
      <div class="play-setup-backdrop"></div>
      <div class="play-setup-panel">
        <button id="setupCloseBtn" class="play-setup-close" type="button" aria-label="Close setup">×</button>
        <h2 id="setupTitle">Choose Game Mode</h2>
        <p id="setupIntro">Pick the rules first. Battle type comes next.</p>
        <div id="setupModeStep" class="setup-step">
          <div class="mode-buttons setup-mode-buttons">
            <button id="setupModeClassicBtn" class="mode-btn setup-mode-card active" type="button">
              Classic
            </button>
            <button id="setupModeSlammerBtn" class="mode-btn setup-mode-card" type="button">
              Slammer
            </button>
          </div>
          <div class="setup-rules-preview">
            <img id="setupRulesGif" src="/gameImgs/rulesClassic.gif" alt="Classic mode rules preview" />
          </div>
          <p id="setupModeHint" class="setup-hint">
            Classic: 2 caps duel. Throw the caps to make both caps turn faces up. Player with the highest score wins. No borders, so aim carefully.
          </p>
        </div>
        <div id="setupBattleStep" class="setup-step hidden">
          <span class="mode-label">Battle Mode</span>
          <div class="mode-buttons">
            <button id="setupBattleTrainingBtn" class="mode-btn" type="button">Training</button>
            <button id="setupBattleVsAiBtn" class="mode-btn active" type="button">Vs AI</button>
            ${PVP_ENABLED ? '<button id="setupBattlePvpBtn" class="mode-btn" type="button">PvP</button>' : ""}
          </div>
          <p id="setupBattleHint" class="setup-hint">
            Vs AI: 4 rounds against computer. Best score wins the match.
          </p>
        </div>
        <div class="play-setup-actions">
          <button id="setupBackBtn" class="hidden" type="button">Back</button>
          <button id="setupLaunchBtn" type="button">Next</button>
        </div>
      </div>
    `;

    app.appendChild(overlay);

    const title = overlay.querySelector("#setupTitle");
    const intro = overlay.querySelector("#setupIntro");
    const modeStep = overlay.querySelector("#setupModeStep");
    const battleStep = overlay.querySelector("#setupBattleStep");
    const battleTrainingBtn = overlay.querySelector("#setupBattleTrainingBtn");
    const battleVsAiBtn = overlay.querySelector("#setupBattleVsAiBtn");
    const battlePvpBtn = overlay.querySelector("#setupBattlePvpBtn");
    const battleHint = overlay.querySelector("#setupBattleHint");
    const modeClassicBtn = overlay.querySelector("#setupModeClassicBtn");
    const modeSlammerBtn = overlay.querySelector("#setupModeSlammerBtn");
    const modeHint = overlay.querySelector("#setupModeHint");
    const rulesGif = overlay.querySelector("#setupRulesGif");
    const closeBtn = overlay.querySelector("#setupCloseBtn");
    const backBtn = overlay.querySelector("#setupBackBtn");
    const launchBtn = overlay.querySelector("#setupLaunchBtn");
    const backdrop = overlay.querySelector(".play-setup-backdrop");
    let selectedBattleMode = "vs-ai";
    let selectedMode = "classic";
    let setupStep = "mode";

    const updateModeUI = () => {
      if (!modeHint) {
        return;
      }
      modeClassicBtn?.classList.toggle("active", selectedMode === "classic");
      modeSlammerBtn?.classList.toggle("active", selectedMode === "slammer");
      if (rulesGif) {
        rulesGif.src =
          selectedMode === "slammer"
            ? "/gameImgs/rulesSlammer.gif"
            : "/gameImgs/rulesClassic.gif";
        rulesGif.alt =
          selectedMode === "slammer"
            ? "Slammer mode rules preview"
            : "Classic mode rules preview";
      }
      modeHint.textContent =
        selectedMode === "slammer"
          ? "Slammer: Throw a heavy slammer-cap into 6 stacked caps on the floor. Turn more caps face up than your opponent to win. Borders keep the chaos in play, so unleash the full throw."
          : "Classic: 2 caps duel. Throw the caps to make both caps turn faces up. Player with the highest score wins. No borders, so aim carefully.";
    };
    updateModeUI();

    const updateBattleModeUI = () => {
      if (!battleHint) {
        return;
      }
      battleTrainingBtn?.classList.toggle("active", selectedBattleMode === "training");
      battleVsAiBtn?.classList.toggle("active", selectedBattleMode === "vs-ai");
      battlePvpBtn?.classList.toggle("active", selectedBattleMode === "pvp");
      battleHint.textContent =
        selectedBattleMode === "pvp"
          ? "PvP: logged-in room battle. Create a room or join by invite code."
          : selectedBattleMode === "vs-ai"
            ? "Vs AI: 4 rounds against computer. Best score wins the match."
            : "Training: infinite throws, no match score.";
    };
    updateBattleModeUI();

    const updateStepUI = () => {
      const isBattleStep = setupStep === "battle";
      modeStep?.classList.toggle("hidden", isBattleStep);
      battleStep?.classList.toggle("hidden", !isBattleStep);
      backBtn?.classList.toggle("hidden", !isBattleStep);
      if (title) {
        title.textContent = isBattleStep ? "Choose Battle Mode" : "Choose Game Mode";
      }
      if (intro) {
        intro.textContent = isBattleStep
          ? "Select how you want to play this battle."
          : "Pick the rules first. Battle type comes next.";
      }
      if (launchBtn) {
        launchBtn.textContent = "Next";
      }
    };
    updateStepUI();

    const onModeClassic = () => {
      selectedMode = "classic";
      updateModeUI();
    };
    const onModeSlammer = () => {
      selectedMode = "slammer";
      updateModeUI();
    };
    const onBattleTraining = () => {
      selectedBattleMode = "training";
      updateBattleModeUI();
    };
    const onBattleVsAi = () => {
      selectedBattleMode = "vs-ai";
      updateBattleModeUI();
    };
    const onBattlePvp = () => {
      if (!PVP_ENABLED) {
        return;
      }
      selectedBattleMode = "pvp";
      updateBattleModeUI();
    };
    const onBack = () => {
      setupStep = "mode";
      updateStepUI();
    };
    battleTrainingBtn?.addEventListener("click", onBattleTraining);
    battleVsAiBtn?.addEventListener("click", onBattleVsAi);
    battlePvpBtn?.addEventListener("click", onBattlePvp);
    modeClassicBtn?.addEventListener("click", onModeClassic);
    modeSlammerBtn?.addEventListener("click", onModeSlammer);
    backBtn?.addEventListener("click", onBack);

    const cleanup = () => {
      battleTrainingBtn?.removeEventListener("click", onBattleTraining);
      battleVsAiBtn?.removeEventListener("click", onBattleVsAi);
      battlePvpBtn?.removeEventListener("click", onBattlePvp);
      modeClassicBtn?.removeEventListener("click", onModeClassic);
      modeSlammerBtn?.removeEventListener("click", onModeSlammer);
      backBtn?.removeEventListener("click", onBack);
      closeBtn?.removeEventListener("click", onCancel);
      launchBtn?.removeEventListener("click", onLaunch);
      backdrop?.removeEventListener("click", onCancel);
      overlay.remove();
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onLaunch = () => {
      if (setupStep === "mode") {
        setupStep = "battle";
        updateStepUI();
        return;
      }
      const value = {
        arenaKey: DEFAULT_ARENA_KEY,
        battleMode: selectedBattleMode,
        gameMode: selectedMode,
      };
      cleanup();
      resolve(value);
    };

    closeBtn?.addEventListener("click", onCancel);
    launchBtn?.addEventListener("click", onLaunch);
    backdrop?.addEventListener("click", onCancel);
  });
}

const CAP_OPTIONS = [
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `classic-${i + 1}`,
    name: `Cap ${i + 1}`,
    imagePath: `/caps/${i + 1}.webp`,
    collection: "ink's collection",
    filterGroup: "classics",
    series: "beta",
  })),
  ...[
    "/caps/jb/jbcap1.webp",
    "/caps/jbcap2.webp",
    "/caps/jb/jbcap3.webp",
    "/caps/jb/jbcap4.webp",
    "/caps/jb/jbcap5.webp",
    "/caps/jb/jbcap6.webp",
  ].map((path, i) => ({
    id: `jungle-${i + 1}`,
    name: `Jungle cap ${i + 1}`,
    imagePath: path,
    collection: "loground's collection",
    filterGroup: "jungle-bay",
    series: "beta",
  })),
  ...[1, 2, 3].map((i) => ({
    id: `bankr-${i}`,
    name: `Bankr cap ${i}`,
    imagePath: `/caps/bankr/${i}.webp`,
    collection: "bankr collection",
    filterGroup: "bankr",
    series: "beta",
  })),
  ...[1, 2, 3].map((i) => ({
    id: `slammer-${i}`,
    name: `Slammer ${i}`,
    imagePath: `/caps/slammer${i}.png`,
    collection: "eazystyler's collection",
    series: "beta",
  })),
];

function resolveSpritePlayback(image, hints) {
  const maxFrames = 64;
  const naturalW = Math.max(1, image.naturalWidth || image.width || 1);
  const naturalH = Math.max(1, image.naturalHeight || image.height || 1);
  const inferredCols = Math.max(1, Math.min(maxFrames, Math.round(naturalW / naturalH)));
  const columns = Math.max(1, Math.min(maxFrames, hints?.columns || inferredCols || 1));
  const rows = Math.max(1, Math.min(8, hints?.rows || 1));
  const maxGridFrames = Math.max(1, columns * rows);
  const frameCount = Math.max(1, Math.min(maxGridFrames, hints?.frameCount || inferredCols || columns));
  return {
    columns,
    rows,
    frameCount,
    fps: Math.max(1, Math.min(24, Number(hints?.fps || 8))),
    zoom: Math.max(1, Number(hints?.zoom || 1)),
  };
}

function drawSpriteFrameToCanvas({ canvas, ctx, image, config, frame }) {
  const cols = Math.max(1, config.columns);
  const rows = Math.max(1, config.rows);
  const frameW = image.naturalWidth / cols;
  const frameH = image.naturalHeight / rows;
  const frameIndex = Math.max(0, frame % Math.max(1, config.frameCount));
  const col = frameIndex % cols;
  const row = Math.floor(frameIndex / cols);
  const sx = col * frameW;
  const sy = row * frameH;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = Math.max(1, canvas.clientWidth || 96);
  const cssH = Math.max(1, canvas.clientHeight || 96);
  const targetW = Math.floor(cssW * dpr);
  const targetH = Math.floor(cssH * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const scale =
    Math.min(canvas.width / frameW, canvas.height / frameH) *
    Math.max(1, Number(config.zoom || 1));
  const dw = frameW * scale;
  const dh = frameH * scale;
  const dx = (canvas.width - dw) * 0.5;
  const dy = (canvas.height - dh) * 0.5;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, sx, sy, frameW, frameH, dx, dy, dw, dh);
}

async function showCapSelectModal({ theme, battleMode = "vs-ai", gameMode = "classic" }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "play-setup-modal";
    const isTraining = battleMode === "training";
    const isPvp = battleMode === "pvp";
    const showsCpuPick = battleMode === "vs-ai";
    overlay.innerHTML = `
      <div class="play-setup-backdrop"></div>
      <div class="play-setup-panel caps-select-panel">
        <button id="capsCloseBtn" class="play-setup-close" type="button" aria-label="Close cap selection">×</button>
        <h2>Select Caps</h2>
        <p>${
          showsCpuPick
            ? "Pick your cap from the grid. CPU gets its own battle cap."
            : isPvp
              ? "Pick your cap for the PvP room."
              : "Pick your cap from the grid."
        }</p>
        <div id="capFilterButtons" class="cap-pick-filters">
          <button class="mode-btn active" type="button" data-cap-filter="all">All</button>
          ${
            gameMode === "slammer"
              ? ""
              : `
                <button class="mode-btn" type="button" data-cap-filter="classics">Classics</button>
                <button class="mode-btn" type="button" data-cap-filter="jungle-bay">Jungle Bay</button>
                <button class="mode-btn" type="button" data-cap-filter="bankr">Bankr</button>
                <button class="mode-btn" type="button" data-cap-filter="vibe-market">Vibe Market</button>
              `
          }
        </div>
        <div id="capsGrid" class="cap-pick-grid" role="listbox" aria-label="Cap choices"></div>
        <div class="cap-pick-summary">
          <p id="playerCapHint" class="setup-hint"></p>
          ${
            !showsCpuPick
              ? ""
              : `<p id="cpuCapHint" class="setup-hint"></p>`
          }
        </div>
        ${
          isTraining
            ? ""
            : ``
        }
        <div class="play-setup-actions">
          <button id="capsLaunchBtn" type="button">Launch</button>
        </div>
      </div>
    `;
    app.appendChild(overlay);

    const capsGrid = overlay.querySelector("#capsGrid");
    const capFilterButtons = overlay.querySelector("#capFilterButtons");
    const playerHint = overlay.querySelector("#playerCapHint");
    const cpuHint = overlay.querySelector("#cpuCapHint");
    const closeBtn = overlay.querySelector("#capsCloseBtn");
    const launchBtn = overlay.querySelector("#capsLaunchBtn");
    const backdrop = overlay.querySelector(".play-setup-backdrop");

    const baseCaps = [...CAP_OPTIONS, ...getVibeMarketState().items].filter((cap) =>
      gameMode === "slammer"
        ? cap.id.startsWith("slammer-")
        : !cap.id.startsWith("slammer-")
    );
    let activeCapFilter = "all";
    let selectableCaps = [...baseCaps];
    let capsLoading = false;
    let isClosed = false;
    let renderGridRequestId = 0;
    let spritePreviewNodes = [];
    let spritePreviewRafId = null;
    const getVisibleCaps = () =>
      activeCapFilter === "all"
        ? selectableCaps
        : baseCaps.filter((cap) => cap.filterGroup === activeCapFilter);
    const byId = (id) =>
      selectableCaps.find((cap) => cap.id === id) ||
      selectableCaps[0];
    const playerDefaultCandidate = gameMode === "slammer" ? "slammer-1" : "classic-1";
    const cpuDefaultCandidate =
      gameMode === "slammer" ? "slammer-3" : "classic-8";
    const playerDefault = byId(playerDefaultCandidate)?.id;
    const cpuDefault = byId(cpuDefaultCandidate)?.id;
    let selectedPlayerCapId = playerDefault;
    let selectedCpuCapId = cpuDefault;

    const capWeightText = (cap) =>
      `${(cap.weightMultiplier ?? getCapWeightMultiplier(cap.imagePath)).toFixed(2)}x`;
    const renderHint = (label, cap) =>
      `${label}: ${cap.name} • ${capWeightText(cap)} • ${cap.collection} • Series ${cap.series}${
        cap.rarity ? ` • Rarity ${cap.rarity}` : ""
      }`;

    const stopSpritePreviewAnimation = () => {
      if (spritePreviewRafId !== null) {
        cancelAnimationFrame(spritePreviewRafId);
        spritePreviewRafId = null;
      }
    };

    const startSpritePreviewAnimation = () => {
      if (spritePreviewRafId !== null || spritePreviewNodes.length === 0) {
        return;
      }
      const tick = () => {
        spritePreviewRafId = requestAnimationFrame(tick);
        const nowSec = performance.now() * 0.001;
        for (const node of spritePreviewNodes) {
          const canvas = node?.canvas;
          if (!canvas || !canvas.isConnected || !node.image || !node.config) {
            continue;
          }
          const frame = Math.floor(nowSec * node.config.fps) % node.config.frameCount;
          if (frame === node.lastFrame) {
            continue;
          }
          node.lastFrame = frame;
          drawSpriteFrameToCanvas({
            canvas,
            ctx: node.ctx,
            image: node.image,
            config: node.config,
            frame,
          });
        }
      };
      spritePreviewRafId = requestAnimationFrame(tick);
    };

    const renderGrid = async () => {
      if (!capsGrid) {
        return;
      }
      const requestId = ++renderGridRequestId;
      stopSpritePreviewAnimation();
      spritePreviewNodes = [];
      const selectedId = selectedPlayerCapId;
      const visibleCaps = getVisibleCaps();
      if (launchBtn) {
        launchBtn.disabled = true;
      }
      if (capsLoading || visibleCaps.length > 0) {
        capsGrid.innerHTML = `
          <div class="cap-pick-loading">
            <span class="cap-loading-spinner" aria-hidden="true"></span>
            <span class="cap-loading-text">${capsLoading ? "loading caps" : "preparing caps"}</span>
          </div>
        `;
      }
      if (isClosed || requestId !== renderGridRequestId) {
        return;
      }
      if (launchBtn) {
        launchBtn.disabled = false;
      }
      if (visibleCaps.length === 0) {
        capsGrid.innerHTML = `
          <div class="cap-pick-loading loaded">
            <span class="cap-loading-text">No caps in this filter yet</span>
          </div>
        `;
        return;
      }
      capsGrid.innerHTML = visibleCaps
        .map((cap) => {
        const isSelected = cap.id === selectedId;
        return `
          <button
            type="button"
            class="cap-pick-card is-loading${isSelected ? " active" : ""}"
            data-cap-id="${cap.id}"
            role="option"
            aria-selected="${isSelected ? "true" : "false"}"
          >
            <span class="cap-pick-card-loader" aria-hidden="true">
              <span class="cap-loading-spinner"></span>
            </span>
            <img class="${cap.centerCrop ? "center-crop" : ""}" src="${cap.imagePath}" alt="${cap.name}" loading="lazy" decoding="async" />
            <span class="cap-pick-name">${cap.name}</span>
            <span class="cap-pick-weight">Weight ${capWeightText(cap)}</span>
            ${cap.rarity ? `<span class="cap-pick-weight">Rarity ${cap.rarity}</span>` : ""}
          </button>
        `;
      })
        .join("");

      capsGrid.querySelectorAll(".cap-pick-card").forEach((button) => {
        button.addEventListener("click", () => {
          const capId = button.getAttribute("data-cap-id");
          if (!capId) {
            return;
          }
          selectedPlayerCapId = capId;
          updateHints();
          capsGrid.querySelectorAll(".cap-pick-card").forEach((card) => {
            const isSelectedCard = card.getAttribute("data-cap-id") === capId;
            card.classList.toggle("active", isSelectedCard);
            card.setAttribute("aria-selected", isSelectedCard ? "true" : "false");
          });
        });
      });

      capsGrid.querySelectorAll(".cap-pick-card").forEach((button) => {
        const capId = button.getAttribute("data-cap-id");
        if (!capId) return;
        const cap = byId(capId);
        if (!cap?.isSpriteCap) {
          const img = button.querySelector("img");
          const markLoaded = () => button.classList.remove("is-loading");
          if (img?.complete) {
            markLoaded();
          } else {
            img?.addEventListener("load", markLoaded, { once: true });
            img?.addEventListener("error", markLoaded, { once: true });
          }
          return;
        }
        const img = button.querySelector("img");
        if (!img) {
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.className = "sprite-preview-canvas";
        button.insertBefore(canvas, img);
        img.style.display = "none";
        const spriteImage = new Image();
        spriteImage.crossOrigin = "anonymous";
        spriteImage.decoding = "async";
        spriteImage.onload = () => {
          const config = resolveSpritePlayback(spriteImage, cap.spriteHints);
          spritePreviewNodes.push({
            canvas,
            ctx: canvas.getContext("2d"),
            image: spriteImage,
            config,
            lastFrame: -1,
          });
          button.classList.remove("is-loading");
          startSpritePreviewAnimation();
        };
        spriteImage.onerror = () => {
          img.style.display = "";
          button.classList.remove("is-loading");
        };
        spriteImage.src = cap.imagePath;
      });
    };

    const updateFilterButtons = () => {
      capFilterButtons?.querySelectorAll("[data-cap-filter]").forEach((button) => {
        button.classList.toggle(
          "active",
          button.getAttribute("data-cap-filter") === activeCapFilter
        );
      });
    };

    const updateHints = () => {
      if (playerHint) {
        playerHint.textContent = renderHint("You", byId(selectedPlayerCapId));
      }
      if (cpuHint && showsCpuPick) {
        cpuHint.textContent = renderHint("CPU", byId(selectedCpuCapId));
      }
    };
    updateHints();
    updateFilterButtons();
    renderGrid();

    const cleanup = () => {
      isClosed = true;
      stopSpritePreviewAnimation();
      capFilterButtons?.removeEventListener("click", onFilterClick);
      closeBtn?.removeEventListener("click", onCancel);
      launchBtn?.removeEventListener("click", onLaunch);
      backdrop?.removeEventListener("click", onCancel);
      overlay.remove();
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    const onLaunch = () => {
      const playerCap = byId(selectedPlayerCapId || playerDefault);
      const cpuCap = byId(selectedCpuCapId || cpuDefault);
      cleanup();
      resolve({
        playerCapPath: playerCap.imagePath,
        cpuCapPath: showsCpuPick ? cpuCap.imagePath : null,
        playerCapMeta: {
          id: playerCap.id,
          name: playerCap.name,
          imagePath: playerCap.imagePath,
          weightMultiplier: playerCap.weightMultiplier ?? null,
          rarity: playerCap.rarity || "",
          isSpriteCap: Boolean(playerCap.isSpriteCap),
          spriteHints: playerCap.spriteHints || null,
          centerCrop: Boolean(playerCap.centerCrop),
        },
        cpuCapMeta: showsCpuPick
          ? {
              id: cpuCap.id,
              name: cpuCap.name,
              imagePath: cpuCap.imagePath,
              weightMultiplier: cpuCap.weightMultiplier ?? null,
              rarity: cpuCap.rarity || "",
              isSpriteCap: Boolean(cpuCap.isSpriteCap),
              spriteHints: cpuCap.spriteHints || null,
              centerCrop: Boolean(cpuCap.centerCrop),
            }
          : null,
      });
    };
    const onFilterClick = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const button = target.closest("[data-cap-filter]");
      if (!button) {
        return;
      }
      activeCapFilter = button.getAttribute("data-cap-filter") || "all";
      updateFilterButtons();
      renderGrid();
    };
    capFilterButtons?.addEventListener("click", onFilterClick);
    closeBtn?.addEventListener("click", onCancel);
    launchBtn?.addEventListener("click", onLaunch);
    backdrop?.addEventListener("click", onCancel);

  });
}

async function showPvpRoomModal({ setup, capSelection, playerIdentity }) {
  const {
    createPvpRoom,
    getPvpRoom,
    joinPvpRoom,
    listPvpRooms,
    getPvpConfigStatus,
    isPvpConfigured,
  } = await loadPvpModule();

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "play-setup-modal";
    const modeLabel = setup.gameMode === "slammer" ? "Slammer" : "Classic";
    overlay.innerHTML = `
      <div class="play-setup-backdrop"></div>
      <div class="play-setup-panel pvp-room-panel">
        <button id="pvpCloseBtn" class="play-setup-close" type="button" aria-label="Close PvP rooms">×</button>
        <h2>PvP Room</h2>
        <p class="setup-hint">${modeLabel} room.</p>
        <div class="pvp-room-actions">
          <button id="pvpCreateBtn" class="mode-btn active" type="button">Create Room</button>
          <button id="pvpJoinBtn" class="mode-btn" type="button">Join Room</button>
        </div>
        <label id="pvpPrivateLabel" class="pvp-private-label">
          <span class="pvp-private-title">
            <input id="pvpPrivateInput" type="checkbox" />
            Private match
          </span>
          <span class="pvp-private-copy">
            <small>Hidden from public room list. Players join by code/link.</small>
          </span>
        </label>
        <label id="pvpJoinLabel" class="pvp-join-label hidden">
          Room code
          <input id="pvpRoomCodeInput" type="text" maxlength="24" autocomplete="off" placeholder="ABC123" />
        </label>
        <div id="pvpPublicRooms" class="pvp-public-rooms"></div>
        <div id="pvpRoomResult" class="pvp-room-result">
          ${isPvpConfigured() ? "Create a room or enter a code from another player." : getPvpConfigStatus()}
        </div>
        <div class="play-setup-actions">
          <button id="pvpSubmitBtn" type="button">${isPvpConfigured() ? "create" : "setup needed"}</button>
        </div>
      </div>
    `;
    app.appendChild(overlay);

    const closeBtn = overlay.querySelector("#pvpCloseBtn");
    const backdrop = overlay.querySelector(".play-setup-backdrop");
    const createBtn = overlay.querySelector("#pvpCreateBtn");
    const joinBtn = overlay.querySelector("#pvpJoinBtn");
    const submitBtn = overlay.querySelector("#pvpSubmitBtn");
    const resultEl = overlay.querySelector("#pvpRoomResult");
    const joinLabel = overlay.querySelector("#pvpJoinLabel");
    const privateLabel = overlay.querySelector("#pvpPrivateLabel");
    const privateInput = overlay.querySelector("#pvpPrivateInput");
    const publicRoomsEl = overlay.querySelector("#pvpPublicRooms");
    const codeInput = overlay.querySelector("#pvpRoomCodeInput");
    let mode = "create";
    let closed = false;
    let pollTimeoutId = null;
    let hasResolvedRoom = false;
    let hasActiveRoom = false;

    const lockRoomControls = () => {
      hasActiveRoom = true;
      createBtn?.classList.add("hidden");
      joinBtn?.classList.add("hidden");
      joinLabel?.classList.add("hidden");
      privateLabel?.classList.add("hidden");
      publicRoomsEl?.classList.add("hidden");
      if (submitBtn) {
        submitBtn.classList.add("hidden");
        submitBtn.disabled = true;
      }
    };

    const setMode = (nextMode) => {
      if (hasActiveRoom) {
        return;
      }
      mode = nextMode;
      createBtn?.classList.toggle("active", mode === "create");
      joinBtn?.classList.toggle("active", mode === "join");
      joinLabel?.classList.toggle("hidden", mode !== "join");
      privateLabel?.classList.toggle("hidden", mode !== "create");
      publicRoomsEl?.classList.toggle("hidden", mode !== "join");
      if (submitBtn) {
        submitBtn.textContent = mode === "join" ? "join" : "create";
      }
      if (mode === "join") {
        renderPublicRooms();
      }
    };

    const renderPublicRooms = async () => {
      if (!publicRoomsEl || !isPvpConfigured()) {
        return;
      }
      publicRoomsEl.innerHTML = `<p>loading public rooms...</p>`;
      try {
        const payload = await listPvpRooms({ playerIdentity });
        const rooms = Array.isArray(payload?.rooms) ? payload.rooms : [];
        if (rooms.length === 0) {
          publicRoomsEl.innerHTML = `<p>No public rooms yet. Create one and invite another player.</p>`;
          return;
        }
        publicRoomsEl.innerHTML = rooms
          .map((room) => {
            const players = Array.isArray(room.players) ? room.players.length : 0;
            return `
              <button class="pvp-public-room" type="button" data-room-code="${room.code}">
                <strong>${room.code}</strong>
                <span>${room.mode} • ${ARENA_CONFIGS[room.map_id]?.label || room.map_id || "map"} • ${players}/2</span>
              </button>
            `;
          })
          .join("");
      } catch (error) {
        publicRoomsEl.innerHTML = `<p>${error?.message || "Could not load public rooms."}</p>`;
      }
    };

    const showRoomResult = (roomPayload) => {
      const room = roomPayload?.room || roomPayload;
      saveActivePvpRoom(room);
      const roomCode = room?.room_code || room?.code || room?.id || "";
      const roomId = room?.id || "";
      const inviteUrl = roomCode
        ? `${window.location.origin}${ROUTES.battles}?pvp=${encodeURIComponent(roomCode)}`
        : "";
      resultEl.innerHTML = `
        <strong>${mode === "join" ? "Joined room" : "Room created"}</strong>
        <span>code: ${roomCode || "unknown"}</span>
        ${
          roomCode
            ? `<div class="pvp-copy-actions">
                <button id="pvpCopyCodeBtn" type="button">copy code</button>
                ${inviteUrl ? `<button id="pvpCopyLinkBtn" type="button">copy link</button>` : ""}
              </div>`
            : ""
        }
        <em id="pvpCopyNotice" class="pvp-copy-notice" aria-live="polite"></em>
        <small>Waiting for another player. Room id: ${roomId || "pending"}</small>
      `;
      const copyCodeBtn = resultEl.querySelector("#pvpCopyCodeBtn");
      const copyLinkBtn = resultEl.querySelector("#pvpCopyLinkBtn");
      const copyNotice = resultEl.querySelector("#pvpCopyNotice");
      let copyNoticeTimeoutId = null;
      const copyText = async (text, button, label) => {
        const originalText = button?.textContent || label;
        try {
          await navigator.clipboard?.writeText(text);
          if (button) {
            button.textContent = "copied";
            button.classList.add("copied");
          }
          if (copyNotice) {
            copyNotice.textContent = `${label} copied`;
          }
          if (copyNoticeTimeoutId !== null) {
            clearTimeout(copyNoticeTimeoutId);
          }
          copyNoticeTimeoutId = setTimeout(() => {
            if (button?.isConnected) {
              button.textContent = originalText;
              button.classList.remove("copied");
            }
            if (copyNotice?.isConnected) {
              copyNotice.textContent = "";
            }
          }, 1400);
        } catch {
          if (copyNotice) {
            copyNotice.textContent = "copy failed";
          }
        }
      };
      copyCodeBtn?.addEventListener("click", () => {
        copyText(roomCode, copyCodeBtn, "code");
      });
      copyLinkBtn?.addEventListener("click", () => {
        copyText(inviteUrl, copyLinkBtn, "link");
      });
    };

    const waitForReadyRoom = async (roomPayload) => {
      const room = roomPayload?.room || roomPayload;
      const roomId = room?.id || "";
      const roomCode = room?.code || room?.room_code || "";
      if (!roomId && !roomCode) {
        return;
      }

      const poll = async () => {
        if (closed || hasResolvedRoom) {
          return;
        }
        try {
          const state = await getPvpRoom({ playerIdentity, roomId, roomCode });
          const players = Array.isArray(state?.players) ? state.players : [];
          if (players.length >= 2) {
            hasResolvedRoom = true;
            resultEl.innerHTML = `
              <strong>Opponent connected</strong>
              <span>Launching PvP match...</span>
            `;
            setTimeout(() => {
              if (closed) {
                return;
              }
              cleanup();
              resolve(state);
            }, 650);
            return;
          }
          resultEl.querySelector("small")?.replaceChildren(
            document.createTextNode("Waiting for opponent to join...")
          );
        } catch (error) {
          if (!closed) {
            resultEl.innerHTML = `
              <strong>Room ready</strong>
              <span>${error?.message || "Could not refresh PvP room."}</span>
            `;
          }
        }
        if (!closed && !hasResolvedRoom) {
          pollTimeoutId = setTimeout(poll, 1500);
        }
      };

      pollTimeoutId = setTimeout(poll, 900);
    };

    const cleanup = () => {
      closed = true;
      if (pollTimeoutId !== null) {
        clearTimeout(pollTimeoutId);
        pollTimeoutId = null;
      }
      closeBtn?.removeEventListener("click", onCancel);
      backdrop?.removeEventListener("click", onCancel);
      createBtn?.removeEventListener("click", onCreateMode);
      joinBtn?.removeEventListener("click", onJoinMode);
      submitBtn?.removeEventListener("click", onSubmit);
      publicRoomsEl?.removeEventListener("click", onPublicRoomClick);
      overlay.remove();
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    const onCreateMode = () => setMode("create");
    const onJoinMode = () => setMode("join");
    const onPublicRoomClick = (event) => {
      const button = event.target instanceof Element
        ? event.target.closest("[data-room-code]")
        : null;
      const roomCode = button?.getAttribute("data-room-code") || "";
      if (roomCode && codeInput) {
        codeInput.value = roomCode;
        setMode("join");
      }
    };
    const onSubmit = async () => {
      if (hasActiveRoom) {
        return;
      }
      if (!isPvpConfigured()) {
        resultEl.textContent = getPvpConfigStatus();
        return;
      }
      submitBtn.disabled = true;
      resultEl.textContent = mode === "join" ? "joining room..." : "creating room...";
      try {
        const payload =
          mode === "join"
            ? await joinPvpRoom({
                playerIdentity,
                roomCode: codeInput?.value || "",
                capSelection,
              })
            : await createPvpRoom({
                playerIdentity,
                setup: {
                  ...setup,
                  theme: currentTheme,
                  isPrivate: Boolean(privateInput?.checked),
                },
                capSelection,
              });
        if (closed) {
          return;
        }
        showRoomResult(payload);
        lockRoomControls();
        await waitForReadyRoom(payload);
      } catch (error) {
        resultEl.textContent = error?.message || "PvP room request failed.";
      } finally {
        if (!closed && !hasActiveRoom) {
          submitBtn.disabled = false;
        }
      }
    };

    closeBtn?.addEventListener("click", onCancel);
    backdrop?.addEventListener("click", onCancel);
    createBtn?.addEventListener("click", onCreateMode);
    joinBtn?.addEventListener("click", onJoinMode);
    submitBtn?.addEventListener("click", onSubmit);
    publicRoomsEl?.addEventListener("click", onPublicRoomClick);

    const urlRoomCode = setup.pvpRoomCode || new URLSearchParams(window.location.search).get("pvp");
    if (urlRoomCode) {
      setMode("join");
      if (codeInput) {
        codeInput.value = urlRoomCode;
      }
    } else {
      setMode("create");
    }
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

function loadPvpModule() {
  pvpModulePromise ??= import("./pvp/client.js");
  return pvpModulePromise;
}

function normalizePvpIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function getPvpIdentityKeys(identity = {}) {
  return new Set(
    [identity.playerId]
      .map(normalizePvpIdentity)
      .filter(Boolean)
  );
}

function pvpRoomPlayerMatchesIdentity(player, identityKeys) {
  if (!player || !identityKeys?.size) {
    return false;
  }
  return [player.player_id, player.wallet]
    .map(normalizePvpIdentity)
    .some((value) => value && identityKeys.has(value));
}

function splitPvpRoomPlayers(players = [], localPlayer = {}) {
  const identityKeys = getPvpIdentityKeys(localPlayer);
  const ownPlayer =
    players.find((player) => pvpRoomPlayerMatchesIdentity(player, identityKeys)) ||
    null;
  const ownKey = normalizePvpIdentity(ownPlayer?.player_id);
  const opponentPlayer =
    players.find((player) => {
      if (!player) return false;
      if (ownPlayer && player === ownPlayer) return false;
      const playerKey = normalizePvpIdentity(player.player_id);
      return !ownKey || playerKey !== ownKey;
    }) || null;
  return { ownPlayer, opponentPlayer, identityKeys };
}

function startPvpMatchController({
  gameInstance,
  playerIdentity,
  roomState,
  localPlayer,
  opponentPlayer,
  getPvpRoom,
  subscribePvpRoom,
  sendPvpAim,
  sendPvpTurnSubmitted,
}) {
  let stopped = false;
  let pollTimeoutId = null;
  let refreshInFlight = false;
  const replayedTurnIds = new Set();
  const announcedRounds = new Set();
  const locallySubmittedRounds = new Set();
  const locallyResolvedRounds = new Set();
  const submittedScoreNotices = new Set();
  const localIdentityIds = getPvpIdentityKeys(localPlayer);
  let localId = localPlayer.playerId;
  let opponentId = opponentPlayer?.player_id || "";
  let opponentName = opponentPlayer?.player_name || "opponent";
  const localName = localPlayer.username || "you";
  const roomId = roomState?.room?.id;

  const syncRoomPlayers = (players = []) => {
    const ownPlayer =
      players.find((player) =>
        pvpRoomPlayerMatchesIdentity(player, localIdentityIds)
      ) ||
      players.find(
        (player) =>
          normalizePvpIdentity(player.player_id) === normalizePvpIdentity(localId)
      );
    if (ownPlayer?.player_id) {
      localId = ownPlayer.player_id;
      gameInstance.setPvpLocalCap?.(ownPlayer.selected_cap);
    }
    const otherPlayer = players.find(
      (player) =>
        normalizePvpIdentity(player.player_id) !== normalizePvpIdentity(localId)
    );
    if (otherPlayer?.player_id) {
      opponentId = otherPlayer.player_id;
      opponentName = otherPlayer.player_name || "opponent";
      gameInstance.setPvpOpponentCap?.(otherPlayer.selected_cap);
    }
  };

  const scoreFor = (turn) => Number(turn?.result?.score || 0);
  const turnsForRound = (turns, round) =>
    turns.filter((turn) => Number(turn.round) === Number(round));
  const isLocalPlayerId = (playerId) =>
    Boolean(
      playerId &&
        (normalizePvpIdentity(playerId) === normalizePvpIdentity(localId) ||
          localIdentityIds.has(normalizePvpIdentity(playerId)))
    );
  const isLocalTurn = (turn) => isLocalPlayerId(turn?.player_id);
  const isOpponentTurn = (turn) =>
    Boolean(
      turn?.player_id &&
        !isLocalPlayerId(turn.player_id) &&
        (!opponentId || turn.player_id === opponentId)
    );

  const matchScore = (turns) => {
    let player = 0;
    let opponent = 0;
    for (let round = 1; round <= 4; round += 1) {
      const roundTurns = turnsForRound(turns, round);
      const own = roundTurns.find(isLocalTurn);
      const other = roundTurns.find(isOpponentTurn);
      if (!own || !other) continue;
      if (scoreFor(own) > scoreFor(other)) player += 1;
      else if (scoreFor(other) > scoreFor(own)) opponent += 1;
    }
    return { player, opponent };
  };

  const applyState = (state) => {
    if (stopped || !state?.room) return;
    saveActivePvpRoom(state.room);
    syncRoomPlayers(Array.isArray(state.players) ? state.players : []);
    const turns = Array.isArray(state.turns) ? state.turns : [];
    const round = Number(state.room.current_round || 1);
    const scores = matchScore(turns);
    const currentRoundTurns = turnsForRound(turns, round);
    const ownTurn = currentRoundTurns.find(isLocalTurn);
    const opponentTurn = currentRoundTurns.find(isOpponentTurn);
    const unseenOpponentTurn = turns
      .filter((turn) => isOpponentTurn(turn) && !replayedTurnIds.has(turn.id))
      .sort((a, b) => {
        const roundDelta = Number(a.round || 0) - Number(b.round || 0);
        if (roundDelta !== 0) return roundDelta;
        return String(a.created_at || "").localeCompare(String(b.created_at || ""));
      })[0];
    const isMyTurn =
      state.room.status === "playing" &&
      isLocalPlayerId(state.room.current_turn) &&
      !ownTurn &&
      !locallySubmittedRounds.has(round);
    const isBusyInSameRound = Number(gameInstance.currentRound || 1) === round;
    const isLocallyBusy =
      isMyTurn &&
      !ownTurn &&
      isBusyInSameRound &&
      (gameInstance.hasLaunched ||
        gameInstance.isChargingPower ||
        gameInstance.isDraggingPosition);

    gameInstance.setPvpPlayers({
      playerName: localName,
      opponentName,
    });

    if (isLocallyBusy) {
      gameInstance.setStatus(
        gameInstance.hasLaunched ? "your throw in motion" : "your turn, make a turn",
        "live"
      );
      return;
    }

    for (let completedRound = 1; completedRound <= 4; completedRound += 1) {
      if (announcedRounds.has(completedRound)) continue;
      const roundTurns = turnsForRound(turns, completedRound);
      const own = roundTurns.find(isLocalTurn);
      const other = roundTurns.find(isOpponentTurn);
      if (!own || !other) continue;
      announcedRounds.add(completedRound);
      const ownScore = scoreFor(own);
      const otherScore = scoreFor(other);
      const result =
        ownScore > otherScore ? "ROUND WON" : otherScore > ownScore ? "ROUND LOST" : "ROUND TIE";
      gameInstance.showCenterNotice(
        `${result}\nYOU ${ownScore} - ${opponentName.toUpperCase()} ${otherScore}`,
        2300
      );
    }

    if (state.room.status === "finished") {
      clearActivePvpRoom();
      const final =
        scores.player > scores.opponent
          ? "MATCH WON"
          : scores.opponent > scores.player
            ? "MATCH LOST"
            : "MATCH TIE";
      gameInstance.playerWins = scores.player;
      gameInstance.cpuWins = scores.opponent;
      gameInstance.setStatus(final.toLowerCase(), "finished");
      gameInstance.showCenterNotice(
        `${final}\nYOU ${scores.player} - ${opponentName.toUpperCase()} ${scores.opponent}`,
        5000
      );
      gameInstance.lockPlayerInput = true;
      gameInstance.ui.launchBtn.disabled = true;
      gameInstance.ui.resetBtn.textContent = "Exit";
      gameInstance.ui.resetBtn.disabled = false;
      gameInstance.ui.actionButtonsEl.classList.add("show-reset");
      gameInstance.ui.resetBtn.onclick = leavePvpToMenu;
      return;
    }

    if (gameInstance.isReplayingPvpTurn || gameInstance.pvpReplay) {
      return;
    }

    if (unseenOpponentTurn) {
      replayedTurnIds.add(unseenOpponentTurn.id);
      gameInstance.playPvpOpponentTurn(unseenOpponentTurn, opponentName);
      return;
    }

    gameInstance.setPvpTurnState({
      isMyTurn,
      round,
      playerScore: scores.player,
      opponentScore: scores.opponent,
      forceReady:
        isMyTurn &&
        !ownTurn &&
        !locallySubmittedRounds.has(round) &&
        !locallyResolvedRounds.has(round),
    });

    if (ownTurn && !opponentTurn) {
      locallySubmittedRounds.add(round);
      gameInstance.lockPlayerInput = true;
      gameInstance.ui.launchBtn.disabled = true;
      gameInstance.setStatus(
        `${opponentName}'s turn, wait for yours`,
        "enemy is making turn"
      );
      if (!submittedScoreNotices.has(round)) {
        submittedScoreNotices.add(round);
        gameInstance.showCenterNotice(`YOUR SCORE\n${scoreFor(ownTurn)}`, 1600);
      }
    } else if (!isMyTurn) {
      gameInstance.setStatus(`${opponentName}'s turn, wait for yours`, "aiming");
    }
  };

  const poll = async () => {
    if (stopped || !roomId) return;
    if (pollTimeoutId !== null) {
      clearTimeout(pollTimeoutId);
      pollTimeoutId = null;
    }
    if (refreshInFlight) {
      pollTimeoutId = setTimeout(poll, 500);
      return;
    }
    refreshInFlight = true;
    try {
      const state = await getPvpRoom({ playerIdentity, roomId });
      applyState(state);
    } catch (error) {
      console.warn("[PvP] room poll failed", error);
    } finally {
      refreshInFlight = false;
    }
    if (!stopped) {
      pollTimeoutId = setTimeout(poll, 900);
    }
  };

  const unsubscribeRealtime = subscribePvpRoom?.({
    roomId,
    onChange: () => {
      if (pollTimeoutId !== null) {
        clearTimeout(pollTimeoutId);
        pollTimeoutId = null;
      }
      poll();
    },
    onAim: (aim) => {
      if (!aim || aim.playerId === localId) {
        return;
      }
      gameInstance.showPvpOpponentAim(aim, opponentName);
    },
    onTurnSubmitted: (turn) => {
      if (!turn || turn.playerId === localId) {
        return;
      }
      gameInstance.setStatus(`${opponentName}'s throw submitted`, "syncing replay");
      if (pollTimeoutId !== null) {
        clearTimeout(pollTimeoutId);
        pollTimeoutId = null;
      }
      poll();
    },
  });

  gameInstance.onPvpAimChange = (aim) => {
    sendPvpAim?.({
      roomId,
      aim: {
        ...aim,
        playerId: localId,
        playerName: localName,
        round: gameInstance.currentRound,
      },
    });
  };

  gameInstance.onPvpReplayComplete = () => {
    poll();
  };

  const originalTurnResult = gameInstance.onPvpTurnResult;
  gameInstance.onPvpTurnResult = async (turn) => {
    const turnRound = Number(turn?.round || gameInstance.currentRound || 1);
    locallySubmittedRounds.add(turnRound);
    locallyResolvedRounds.add(turnRound);
    gameInstance.lockPlayerInput = true;
    gameInstance.ui.launchBtn.disabled = true;
    const result = await originalTurnResult?.(turn);
    sendPvpTurnSubmitted?.({
      roomId,
      turn: {
        playerId: localId,
        playerName: localName,
        round: turnRound,
        turnId: result?.turn?.id || "",
      },
    });
    poll();
    return result;
  };

  applyState(roomState);
  pollTimeoutId = setTimeout(poll, 800);

  return () => {
    stopped = true;
    unsubscribeRealtime?.();
    gameInstance.onPvpReplayComplete = null;
    if (pollTimeoutId !== null) {
      clearTimeout(pollTimeoutId);
    }
  };
}

function clearCurrentScreen() {
  if (cleanupPvpController) {
    cleanupPvpController();
    cleanupPvpController = null;
  }
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

function leavePvpToMenu() {
  clearPvpResumeTarget();
  navigateToMenu();
}

function setViewMode(mode) {
  app.className = `mode-${mode} theme-${currentTheme}`;
}

function normalizeTheme(theme) {
  return THEME_OPTIONS.includes(theme) ? theme : DEFAULT_THEME;
}

function setTheme(nextTheme) {
  currentTheme = normalizeTheme(nextTheme);
  setWalletAccessTheme(currentTheme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, currentTheme);
  } catch {
    // Ignore storage failures.
  }
}

function maybeStartPendingPvpInvite() {
  if (!PVP_ENABLED || !pendingPvpInviteCode || pendingPvpInviteStarted) {
    return;
  }
  pendingPvpInviteStarted = true;
  setTimeout(() => {
    navigateToBattles({ pvpRoomCode: pendingPvpInviteCode });
  }, 100);
}

async function showMenu({ startPendingPvpInvite = true } = {}) {
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
    onSoundToggle: () => {
      soundEnabled = !soundEnabled;
      syncSoundButtonsUI();
      return soundEnabled;
    },
    onThemeChange: (nextTheme) => {
      if (nextTheme !== currentTheme) {
        setTheme(nextTheme);
        showMenu();
      }
    },
    onPlay: navigateToBattles,
    onCollection: navigateToCollection,
  });
  if (startPendingPvpInvite) {
    maybeStartPendingPvpInvite();
  }
}

async function showPlay({ pvpRoomCode = "" } = {}) {
  if (!PVP_ENABLED && pvpRoomCode) {
    clearPvpResumeTarget();
    navigateToMenu({ replace: true });
    return;
  }
  const localVersion = ++viewVersion;
  let setup = null;
  let resumePvpRoomState = null;
  if (pvpRoomCode) {
    const { getPlayerIdentity, getPvpRoom } = await loadPvpModule();
    try {
      const preview = await getPvpRoom({ playerIdentity, roomCode: pvpRoomCode });
      const localPlayer = getPlayerIdentity(playerIdentity);
      const players = Array.isArray(preview?.players) ? preview.players : [];
      const isAlreadyInRoom = players.some(
        (player) => player.player_id === localPlayer.playerId
      );
      setup = {
        arenaKey: preview?.room?.map_id || DEFAULT_ARENA_KEY,
        battleMode: "pvp",
        gameMode: preview?.room?.mode || "classic",
        theme: preview?.room?.setup?.theme || currentTheme,
        pvpRoomCode,
      };
      if (isAlreadyInRoom && preview?.room?.status !== "waiting") {
        resumePvpRoomState = preview;
      }
      if (setup.theme && setup.theme !== currentTheme) {
        setTheme(setup.theme);
      }
    } catch {
      setup = {
        arenaKey: DEFAULT_ARENA_KEY,
        battleMode: "pvp",
        gameMode: "classic",
        pvpRoomCode,
      };
    }
  } else {
    setup = await showPlaySetupModal({ theme: currentTheme });
  }
  if (localVersion !== viewVersion) {
    return;
  }
  if (!setup) {
    returnToMenuFromCancelledBattle();
    return;
  }
  let capSelection = null;
  if (!resumePvpRoomState) {
    capSelection = await showCapSelectModal({
      theme: currentTheme,
      battleMode: setup.battleMode,
      gameMode: setup.gameMode,
    });
    if (localVersion !== viewVersion) {
      return;
    }
    if (!capSelection) {
      returnToMenuFromCancelledBattle();
      return;
    }
  }

  if (setup.battleMode === "pvp") {
    const roomState =
      resumePvpRoomState ||
      (await showPvpRoomModal({ setup, capSelection, playerIdentity }));
    if (localVersion !== viewVersion || !roomState?.room) {
      if (localVersion === viewVersion) {
        returnToMenuFromCancelledBattle();
      }
      return;
    }
    const {
      getPlayerIdentity,
      getPvpRoom,
      sendPvpAim,
      sendPvpTurnSubmitted,
      subscribePvpRoom,
      submitPvpTurnResult,
    } = await loadPvpModule();
    const localPlayer = getPlayerIdentity(playerIdentity);
    const players = Array.isArray(roomState.players) ? roomState.players : [];
    const { ownPlayer, opponentPlayer } = splitPvpRoomPlayers(
      players,
      localPlayer
    );
    const pvpSetup = {
      ...setup,
      ...(roomState.room.setup || {}),
      battleMode: "pvp",
    };
    const pvpTheme = normalizeTheme(pvpSetup.theme || currentTheme);
    if (pvpTheme !== currentTheme) {
      setTheme(pvpTheme);
    }

    clearCurrentScreen();
    setViewMode("play");
    const { DiscDropGame } = await loadGameModule();
    if (localVersion !== viewVersion) {
      return;
    }
    game = new DiscDropGame(app, {
      theme: pvpTheme,
      soundEnabled,
      isSoundEnabled: () => soundEnabled,
      initialArenaKey: pvpSetup.arenaKey || roomState.room.map_id || setup.arenaKey,
      battleMode: "pvp",
      gameMode: pvpSetup.gameMode || roomState.room.mode || setup.gameMode,
      playerCapPath:
        ownPlayer?.selected_cap?.imagePath || capSelection?.playerCapPath,
      cpuCapPath: opponentPlayer?.selected_cap?.imagePath || null,
      playerCapMeta: ownPlayer?.selected_cap || capSelection?.playerCapMeta || null,
      cpuCapMeta: opponentPlayer?.selected_cap || null,
      onPvpTurnResult: (turn) =>
        submitPvpTurnResult({
          playerIdentity,
          roomId: roomState.room.id,
          turn,
        }),
    });
    await game.init();
    cleanupPvpController = startPvpMatchController({
      gameInstance: game,
      playerIdentity,
      roomState,
      localPlayer,
      opponentPlayer,
      getPvpRoom,
      subscribePvpRoom,
      sendPvpAim,
      sendPvpTurnSubmitted,
    });
    cleanupScreen = composeCleanups(addBackButton(leavePvpToMenu), addGlobalMuteButton());
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
    battleMode: setup.battleMode,
    gameMode: setup.gameMode,
    playerCapPath: capSelection.playerCapPath,
    cpuCapPath: capSelection.cpuCapPath,
    playerCapMeta: capSelection.playerCapMeta || null,
    cpuCapMeta: capSelection.cpuCapMeta || null,
  });
  await game.init();
  if (localVersion !== viewVersion) {
    return;
  }
  cleanupScreen = composeCleanups(addBackButton(navigateToMenu), addGlobalMuteButton());
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
    mountCollectionScreen({ app, onBack: navigateToMenu }),
    addGlobalMuteButton()
  );
}

window.addEventListener("popstate", renderCurrentRoute);

if (!PVP_ENABLED) {
  clearPvpResumeTarget();
}

if (PVP_ENABLED && pendingPvpInviteCode && getCurrentRoute() === ROUTES.menu) {
  setRoute(ROUTES.battles, { replace: true });
} else if (getCurrentRoute() !== window.location.pathname) {
  setRoute(getCurrentRoute(), { replace: true });
}

window.addEventListener("caps:wallet-session", (event) => {
  const session = event.detail;
  if (session?.mode === "wallet" && session.address) {
    loadVibeMarketCollectionForWallet(session.address);
  } else {
    loadVibeMarketCollectionForWallet("");
  }
});

setWalletAccessTheme(currentTheme);
showInitialAccessModal().then((session) => {
  mountWalletConnectButton();
  if (session?.mode === "wallet" && session.address) {
    loadVibeMarketCollectionForWallet(session.address);
  }
  renderCurrentRoute();
});
