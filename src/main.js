import "./style.css";
import { ARENA_CONFIGS, DEFAULT_ARENA_KEY } from "./game/arena-configs.js";
import { getCapWeightMultiplier } from "./game/cap-physics.js";
import { playSound, preloadSounds, unlockSounds } from "./sound.js";

const app = document.querySelector("#app");
const THEME_STORAGE_KEY = "aura_caps_last_theme_v1";
const THEME_OPTIONS = ["hell", "heaven", "jungle-bay", "brainrot"];
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
const AURA_SESSION_KEY = "aura_session_v1";
const LOGIN_GATE_KEY = "aura_login_gate_v1";
const AURA_SPRITE_NAMES = new Set([
  "FILTHY",
  "GOLDIE",
  "ALI",
  "YODIE",
  "WILLY",
  "EAZY",
  "ANGRYTALIK",
]);
const AURA_SPRITE_OVERRIDES_BY_NAME = {
  ANGRYTALIK: {
    columns: 4,
    rows: 1,
    frameCount: 4,
    zoom: 1.25,
  },
};
let auraSession = loadAuraSession();
let pendingPvpInviteCode = new URLSearchParams(window.location.search).get("pvp") || "";
let pendingPvpInviteStarted = false;

window.addEventListener("pointerdown", unlockSounds, { once: true, passive: true });
window.addEventListener("touchstart", unlockSounds, { once: true, passive: true });

function loadAuraSession() {
  try {
    const raw = window.localStorage.getItem(AURA_SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    const walletAddress =
      parsed?.walletAddress ||
      parsed?.user?.walletAddress ||
      parsed?.user?.address ||
      "";
    const hasUserIdentity = Boolean(
      parsed?.connected || parsed?.authenticated || walletAddress || parsed?.user
    );
    if (!parsed || !hasUserIdentity) {
      return null;
    }
    return {
      connected: true,
      walletAddress,
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

function hasAuraSession(sessionLike) {
  return Boolean(
    sessionLike?.connected ||
      sessionLike?.walletAddress ||
      sessionLike?.user
  );
}

function hasChosenGuestMode() {
  try {
    return window.localStorage.getItem(LOGIN_GATE_KEY) === "guest";
  } catch {
    return false;
  }
}

function setGuestMode() {
  try {
    window.localStorage.setItem(LOGIN_GATE_KEY, "guest");
  } catch {
    // Ignore storage failures.
  }
}

function clearGuestMode() {
  try {
    window.localStorage.removeItem(LOGIN_GATE_KEY);
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

function closeLoginGate() {
  if (loginGateCleanup) {
    loginGateCleanup();
    loginGateCleanup = null;
  }
}

function triggerAuraLoginFromGate() {
  const auraSlot = app.querySelector("#aura-login");
  const clickable = auraSlot?.querySelector(
    "button, [role='button'], a, iframe"
  );
  if (clickable instanceof HTMLElement) {
    clickable.click();
    return;
  }
  window.dispatchEvent(new CustomEvent("aura-caps-open-login"));
}

function showLoginGateIfNeeded() {
  closeLoginGate();
  if (hasAuraSession(auraSession) || hasChosenGuestMode()) {
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "entry-login-gate";
  overlay.innerHTML = `
    <div class="entry-login-card">
      <p class="entry-login-kicker">welcome to</p>
      <h2>AURA CAPS</h2>
      <p class="entry-login-copy">
        Connect Aura to unlock your owned collection, or jump in as a guest with free caps.
      </p>
      <div class="entry-login-actions">
        <button id="entryAuraLoginBtn" class="entry-login-primary" type="button">log in with aura</button>
        <button id="entryGuestBtn" class="entry-login-secondary" type="button">play as guest</button>
      </div>
    </div>
  `;
  app.appendChild(overlay);

  const loginBtn = overlay.querySelector("#entryAuraLoginBtn");
  const guestBtn = overlay.querySelector("#entryGuestBtn");
  const onLogin = () => {
    triggerAuraLoginFromGate();
    closeLoginGate();
  };
  const onGuest = () => {
    setGuestMode();
    closeLoginGate();
  };
  loginBtn?.addEventListener("click", onLogin);
  guestBtn?.addEventListener("click", onGuest);

  loginGateCleanup = () => {
    loginBtn?.removeEventListener("click", onLogin);
    guestBtn?.removeEventListener("click", onGuest);
    overlay.remove();
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
let loginGateCleanup = null;
let game = null;
let viewVersion = 0;
let currentTheme = pickRefreshTheme();
let menuModulePromise = null;
let collectionModulePromise = null;
let profileModulePromise = null;
let gameModulePromise = null;
let pvpModulePromise = null;

function pickRefreshTheme() {
  try {
    const lastTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const pool = THEME_OPTIONS.filter((theme) => theme !== lastTheme);
    const selectedPool = pool.length > 0 ? pool : THEME_OPTIONS;
    const selected =
      selectedPool[Math.floor(Math.random() * selectedPool.length)] || "hell";
    window.localStorage.setItem(THEME_STORAGE_KEY, selected);
    return selected;
  } catch {
    return THEME_OPTIONS[Math.floor(Math.random() * THEME_OPTIONS.length)] || "hell";
  }
}

function showPlaySetupModal({ theme }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "play-setup-modal";

    const arenaKeys = Object.keys(ARENA_CONFIGS);
    const arenaOptions = arenaKeys
      .map(
        (key) =>
          `<option value="${key}">${ARENA_CONFIGS[key]?.label ?? key}</option>`
      )
      .join("");

    overlay.innerHTML = `
      <div class="play-setup-backdrop"></div>
      <div class="play-setup-panel">
        <button id="setupCloseBtn" class="play-setup-close" type="button" aria-label="Close setup">×</button>
        <h2>Choose Battle Setup</h2>
        <p>Select map and mode before launching the round.</p>
        <div class="mode-picker">
          <span class="mode-label">Mode</span>
          <div class="mode-buttons">
            <button id="setupModeClassicBtn" class="mode-btn active" type="button">Classic</button>
            <button id="setupModeSlammerBtn" class="mode-btn" type="button">Slammer</button>
          </div>
        </div>
        <p id="setupModeHint" class="setup-hint">
          Classic: 2 caps duel. Throw the caps to make both caps turn faces up. Player with biggest score wins. Don't let the caps fly away, the map has no borders, be smart, mfer.
        </p>
        <div class="mode-picker">
          <span class="mode-label">Battle Mode</span>
          <div class="mode-buttons">
            <button id="setupBattleTrainingBtn" class="mode-btn" type="button">Training</button>
            <button id="setupBattleVsAiBtn" class="mode-btn active" type="button">Vs AI</button>
            <button id="setupBattlePvpBtn" class="mode-btn" type="button">PvP</button>
          </div>
        </div>
        <p id="setupBattleHint" class="setup-hint">
          Vs AI: 4 rounds against computer. Best score wins the match.
        </p>
        <label>
          Map
          <select id="setupArenaSelect">${arenaOptions}</select>
        </label>
        <p id="setupMapHint" class="setup-hint"></p>
        <div class="play-setup-actions">
          <button id="setupLaunchBtn" type="button">next</button>
        </div>
      </div>
    `;

    app.appendChild(overlay);

    const arenaSelect = overlay.querySelector("#setupArenaSelect");
    const mapHint = overlay.querySelector("#setupMapHint");
    const battleTrainingBtn = overlay.querySelector("#setupBattleTrainingBtn");
    const battleVsAiBtn = overlay.querySelector("#setupBattleVsAiBtn");
    const battlePvpBtn = overlay.querySelector("#setupBattlePvpBtn");
    const battleHint = overlay.querySelector("#setupBattleHint");
    const modeClassicBtn = overlay.querySelector("#setupModeClassicBtn");
    const modeSlammerBtn = overlay.querySelector("#setupModeSlammerBtn");
    const modeHint = overlay.querySelector("#setupModeHint");
    const closeBtn = overlay.querySelector("#setupCloseBtn");
    const launchBtn = overlay.querySelector("#setupLaunchBtn");
    const backdrop = overlay.querySelector(".play-setup-backdrop");
    let selectedBattleMode = "vs-ai";
    let selectedMode = "classic";

    if (arenaSelect) {
      arenaSelect.value = arenaKeys.includes(DEFAULT_ARENA_KEY)
        ? DEFAULT_ARENA_KEY
        : arenaKeys[0];
    }

    const updateMapHint = () => {
      if (!mapHint) {
        return;
      }
      const arenaKey = arenaSelect?.value || DEFAULT_ARENA_KEY;
      mapHint.textContent = ARENA_CONFIGS[arenaKey]?.hint || "";
    };
    updateMapHint();

    const updateModeUI = () => {
      if (!modeHint) {
        return;
      }
      modeClassicBtn?.classList.toggle("active", selectedMode === "classic");
      modeSlammerBtn?.classList.toggle("active", selectedMode === "slammer");
      modeHint.textContent =
        selectedMode === "slammer"
          ? "Slammer: Throw a heavy slammer-cap into 6 stacked caps on the floor. Turn more caps faces up than your opponent to win. Map has borders, unleash your full power of throw."
          : "Classic: 2 caps duel. Throw the caps to make both caps turn faces up. Player with biggest score wins. Don't let the caps fly away, the map has no borders, be smart, mfer.";
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
      selectedBattleMode = "pvp";
      updateBattleModeUI();
    };
    battleTrainingBtn?.addEventListener("click", onBattleTraining);
    battleVsAiBtn?.addEventListener("click", onBattleVsAi);
    battlePvpBtn?.addEventListener("click", onBattlePvp);
    modeClassicBtn?.addEventListener("click", onModeClassic);
    modeSlammerBtn?.addEventListener("click", onModeSlammer);
    arenaSelect?.addEventListener("change", updateMapHint);

    const cleanup = () => {
      battleTrainingBtn?.removeEventListener("click", onBattleTraining);
      battleVsAiBtn?.removeEventListener("click", onBattleVsAi);
      battlePvpBtn?.removeEventListener("click", onBattlePvp);
      modeClassicBtn?.removeEventListener("click", onModeClassic);
      modeSlammerBtn?.removeEventListener("click", onModeSlammer);
      arenaSelect?.removeEventListener("change", updateMapHint);
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
      const value = {
        arenaKey: arenaSelect?.value || DEFAULT_ARENA_KEY,
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

function parseSpriteHints(configLike = {}) {
  const columns = Number.parseInt(String(configLike.columns ?? configLike.cols ?? ""), 10);
  const rows = Number.parseInt(String(configLike.rows ?? ""), 10);
  const frameCount = Number.parseInt(String(configLike.frameCount ?? configLike.frames ?? ""), 10);
  const fps = Number(configLike.fps);
  const zoom = Number(configLike.zoom);
  return {
    columns: Number.isFinite(columns) && columns > 0 ? columns : undefined,
    rows: Number.isFinite(rows) && rows > 0 ? rows : undefined,
    frameCount: Number.isFinite(frameCount) && frameCount > 0 ? frameCount : undefined,
    fps: Number.isFinite(fps) && fps > 0 ? fps : 8,
    zoom: Number.isFinite(zoom) && zoom > 1 ? zoom : undefined,
  };
}

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

function pickAuraLookupValue(sessionLike) {
  const user = sessionLike?.user || {};
  const candidates = [
    sessionLike?.walletAddress,
    user?.walletAddress,
    user?.address,
    user?.username,
    user?.handle,
    user?.displayName,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function toAbsImage(imageLike) {
  const value = String(imageLike || "").trim();
  if (!value) return "";
  if (value.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${value.slice("ipfs://".length)}`;
  }
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/")) {
    return value;
  }
  return `https://ipfs.io/ipfs/${value}`;
}

const RARITY_LABELS = {
  1: "common",
  2: "rare",
  3: "epic",
  4: "legendary",
  5: "mythic",
};

function normalizeRarity(value) {
  const rarityNumber = Number.parseInt(String(value ?? ""), 10);
  if (Number.isFinite(rarityNumber) && RARITY_LABELS[rarityNumber]) {
    return RARITY_LABELS[rarityNumber];
  }
  return String(value || "").trim();
}

function readTraitValue(traitList, keys) {
  const normalizedKeys = keys.map((key) => String(key).toLowerCase());
  if (!traitList) {
    return "";
  }
  if (!Array.isArray(traitList) && typeof traitList === "object") {
    for (const [traitKey, directValue] of Object.entries(traitList)) {
      if (
        normalizedKeys.includes(String(traitKey).toLowerCase()) &&
        directValue !== undefined &&
        directValue !== null &&
        directValue !== ""
      ) {
        return directValue;
      }
    }
  }
  const rows = Array.isArray(traitList) ? traitList : Object.values(traitList);
  const found = rows.find((trait) => {
    const traitName = String(
      trait?.trait_type ||
        trait?.traitType ||
        trait?.key ||
        trait?.name ||
        trait?.type ||
        ""
    ).toLowerCase();
    return normalizedKeys.includes(traitName);
  });
  return found?.value ?? found?.display_value ?? found?.displayValue ?? "";
}

function parseWeightMultiplier(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/x$/i, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractAuraCapOptions(payload) {
  console.groupCollapsed("[AURA][CAP SELECT] extractAuraCapOptions()");
  console.log("raw normalized inventory payload", payload);
  const candidates = [payload?.data, payload?.items, payload?.cards, payload?.results, payload?.packCards, payload];
  console.log("candidate containers", {
    data: payload?.data,
    items: payload?.items,
    cards: payload?.cards,
    results: payload?.results,
    packCards: payload?.packCards,
    payload,
  });
  let rows = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      rows = candidate;
      break;
    }
  }
  console.log("selected inventory rows", { count: rows.length, rows });
  const seen = new Set();
  const mapped = [];
  for (const [index, row] of rows.entries()) {
    const metadata = row?.metadata || row?.card?.metadata || row?.packCard?.metadata || {};
    const attrs = Array.isArray(metadata?.attributes) ? metadata.attributes : [];
    const traitList =
      row?.traitList ||
      row?.traits ||
      metadata?.traitList ||
      metadata?.traits ||
      row?.card?.traitList ||
      row?.packCard?.traitList ||
      [];
    const name = String(
      row?.name || row?.title || metadata?.name || row?.card?.name || row?.packCard?.name || ""
    ).trim();
    const imagePath = toAbsImage(
      row?.image ||
        row?.imageUrl ||
        row?.image_url ||
        row?.imageURI ||
        row?.image_uri ||
        metadata?.image ||
        metadata?.image_url ||
        row?.card?.image ||
        row?.card?.imageUrl ||
        row?.packCard?.image
    );
    const uniqueKey = String(
      row?.id || row?._id || row?.tokenId || row?.tokenID || row?.mint || row?.packCardId || `${name}-${imagePath}`
    );
    console.groupCollapsed(`[AURA][CAP SELECT] inventory row ${index}: ${name || "(no name)"}`);
    console.log("raw row", row);
    console.log("metadata", metadata);
    console.log("attributes", attrs);
    console.log("parsed basics", { uniqueKey, name, imagePath });
    if (!name || !imagePath || seen.has(uniqueKey)) {
      console.log("skipped row", {
        reason: !name ? "missing name" : !imagePath ? "missing imagePath" : "duplicate uniqueKey",
      });
      console.groupEnd();
      continue;
    }
    seen.add(uniqueKey);
    const upperName = name.toUpperCase();
    const isAuraSprite = AURA_SPRITE_NAMES.has(upperName);
    const attrLookup = (keys) => {
      const normalized = keys.map((k) => String(k).toLowerCase());
      const found = attrs.find((attr) =>
        normalized.includes(String(attr?.trait_type || attr?.traitType || attr?.key || "").toLowerCase())
      );
      return found?.value ?? found?.display_value ?? "";
    };
    const collection = String(
      metadata?.collection ||
        metadata?.collectionName ||
        row?.collectionName ||
        row?.collection ||
        "aura collection"
    ).trim();
    const series = String(metadata?.series || row?.series || "beta").trim();
    const rarity = normalizeRarity(
      metadata?.rarity ??
        row?.rarity ??
        readTraitValue(traitList, ["rarity"])
    );
    const traitWeight = parseWeightMultiplier(
      readTraitValue(traitList, ["weight", "weightMultiplier", "weight multiplier"])
    );
    const weightMultiplier =
      traitWeight ?? parseWeightMultiplier(metadata?.weight ?? row?.weight) ?? getCapWeightMultiplier(imagePath);
    const explicitFrameCount =
      metadata?.frameCount ??
      metadata?.frames ??
      metadata?.spriteFrames ??
      row?.frameCount ??
      attrLookup(["frameCount", "frames", "sprite frames", "spriteFrames"]);
    const explicitCols =
      metadata?.columns ??
      metadata?.cols ??
      metadata?.spriteColumns ??
      row?.columns ??
      attrLookup(["columns", "cols", "spriteColumns", "sprite columns"]);
    const explicitRows =
      metadata?.rows ??
      metadata?.spriteRows ??
      row?.rows ??
      attrLookup(["rows", "spriteRows", "sprite rows"]);
    const explicitFps =
      metadata?.fps ??
      metadata?.spriteFps ??
      row?.fps ??
      attrLookup(["fps", "spriteFps", "sprite fps"]);
    const spriteOverride = AURA_SPRITE_OVERRIDES_BY_NAME[upperName] || {};
    const spriteHints = isAuraSprite
      ? parseSpriteHints({
          columns: spriteOverride.columns ?? explicitCols,
          rows: spriteOverride.rows ?? explicitRows,
          frameCount: spriteOverride.frameCount ?? explicitFrameCount,
          fps: spriteOverride.fps ?? explicitFps,
          zoom: spriteOverride.zoom ?? 1,
        })
      : null;
    const mappedItem = {
      id: `aura-${uniqueKey}`,
      name,
      imagePath,
      collection,
      series,
      rarity,
      weightMultiplier,
      isAuraSprite,
      spriteHints,
    };
    console.log("trait parsing", {
      traitList,
      rarity,
      traitWeight,
      weightMultiplier,
      collection,
      series,
    });
    console.log("sprite parsing", {
      upperName,
      isAuraSprite,
      explicitFrameCount,
      explicitCols,
      explicitRows,
      explicitFps,
      spriteHints,
    });
    console.log("mapped cap option", mappedItem);
    console.groupEnd();
    mapped.push(mappedItem);
  }
  const sliced = mapped.slice(0, 48);
  console.log("final mapped aura cap options", { count: sliced.length, items: sliced });
  console.groupEnd();
  return sliced;
}

async function fetchAuraCapOptions(sessionLike) {
  const lookupValue = pickAuraLookupValue(sessionLike);
  console.groupCollapsed("[AURA][CAP SELECT] fetchAuraCapOptions()");
  console.log("sessionLike", sessionLike);
  console.log("lookupValue", lookupValue);
  if (!lookupValue) {
    console.log("no lookup value, returning empty aura cap list");
    console.groupEnd();
    return [];
  }
  const profileUrl = `/api/aura-profile?username=${encodeURIComponent(lookupValue)}`;
  console.log("profile request", { profileUrl });
  const profileResponse = await fetch(profileUrl);
  const profileJson = await profileResponse.json().catch(() => null);
  console.log("profile response", {
    ok: profileResponse.ok,
    status: profileResponse.status,
    body: profileJson,
  });
  const profilePayload = profileJson?.data || profileJson;
  const profile = profilePayload?.user || profilePayload?.data || profilePayload || {};
  const userId = String(profile?.id || profile?._id || profile?.userId || "").trim();
  if (!profileResponse.ok || !userId) {
    console.log("profile lookup failed or missing userId", { profile, userId });
    console.groupEnd();
    return [];
  }
  const inventoryUrl = `/api/aura-inventory?userId=${encodeURIComponent(userId)}&condensed=true&ownedOnly=true&packType=all&limit=200&page=1`;
  console.log("inventory request", { inventoryUrl, userId });
  const inventoryResponse = await fetch(inventoryUrl);
  const inventoryJson = await inventoryResponse.json().catch(() => null);
  console.log("inventory response raw json", {
    ok: inventoryResponse.ok,
    status: inventoryResponse.status,
    body: inventoryJson,
  });
  const inventoryPayload = inventoryJson?.data || inventoryJson;
  console.log("inventory normalized payload", inventoryPayload);
  const options = extractAuraCapOptions(inventoryPayload);
  console.log("returning aura cap options", options);
  console.groupEnd();
  return options;
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
          <button id="capsLaunchBtn" type="button">launch</button>
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

    const isBrainrot = theme === "brainrot";
    const baseCaps = CAP_OPTIONS.filter((cap) =>
      gameMode === "slammer"
        ? cap.id.startsWith("slammer-")
        : !cap.id.startsWith("slammer-")
    );
    const capSelectSession = auraSession || loadAuraSession();
    const canUseAuraFilter = gameMode !== "slammer" && hasAuraSession(capSelectSession);
    let auraCaps = [];
    let activeCapFilter = "all";
    let selectableCaps = [...baseCaps];
    let capsLoading = canUseAuraFilter;
    let isClosed = false;
    let spritePreviewNodes = [];
    let spritePreviewRafId = null;
    const getVisibleCaps = () =>
      activeCapFilter === "aura" ? auraCaps : selectableCaps;
    const byId = (id) =>
      selectableCaps.find((cap) => cap.id === id) ||
      auraCaps.find((cap) => cap.id === id) ||
      selectableCaps[0] ||
      auraCaps[0];
    const playerDefaultCandidate = gameMode === "slammer" ? "slammer-1" : "classic-1";
    const cpuDefaultCandidate =
      gameMode === "slammer" ? "slammer-3" : isBrainrot ? "classic-9" : "classic-8";
    const playerDefault = byId(playerDefaultCandidate)?.id;
    const cpuDefault = byId(cpuDefaultCandidate)?.id;
    let selectedPlayerCapId = playerDefault;
    let selectedCpuCapId = cpuDefault;

    if (canUseAuraFilter && capFilterButtons) {
      capFilterButtons.insertAdjacentHTML(
        "beforeend",
        '<button class="mode-btn" type="button" data-cap-filter="aura">Aura</button>'
      );
    }

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

    const renderGrid = () => {
      if (!capsGrid) {
        return;
      }
      stopSpritePreviewAnimation();
      spritePreviewNodes = [];
      const selectedId = selectedPlayerCapId;
      const visibleCaps = getVisibleCaps();
      if (capsLoading && selectableCaps.length === 0) {
        capsGrid.innerHTML = `
          <div class="cap-pick-loading">
            <span class="cap-loading-spinner" aria-hidden="true"></span>
            <span class="cap-loading-text">loading aura caps</span>
          </div>
        `;
        return;
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
            class="cap-pick-card${isSelected ? " active" : ""}"
            data-cap-id="${cap.id}"
            role="option"
            aria-selected="${isSelected ? "true" : "false"}"
          >
            <img src="${cap.imagePath}" alt="${cap.name}" loading="lazy" decoding="async" />
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
          renderGrid();
        });
      });

      capsGrid.querySelectorAll(".cap-pick-card").forEach((button) => {
        const capId = button.getAttribute("data-cap-id");
        if (!capId) return;
        const cap = byId(capId);
        if (!cap?.isAuraSprite) {
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
          startSpritePreviewAnimation();
        };
        spriteImage.onerror = () => {
          img.style.display = "";
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
          isAuraSprite: Boolean(playerCap.isAuraSprite),
          spriteHints: playerCap.spriteHints || null,
        },
        cpuCapMeta: showsCpuPick
          ? {
              id: cpuCap.id,
              name: cpuCap.name,
              imagePath: cpuCap.imagePath,
              weightMultiplier: cpuCap.weightMultiplier ?? null,
              rarity: cpuCap.rarity || "",
              isAuraSprite: Boolean(cpuCap.isAuraSprite),
              spriteHints: cpuCap.spriteHints || null,
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

    if (canUseAuraFilter) {
      fetchAuraCapOptions(capSelectSession)
        .then((loadedAuraCaps) => {
          if (isClosed) {
            return;
          }
          if (Array.isArray(loadedAuraCaps) && loadedAuraCaps.length > 0) {
            auraCaps = loadedAuraCaps;
            selectableCaps = [...baseCaps, ...auraCaps];
          }
        })
        .catch(() => {})
        .finally(() => {
          if (isClosed) {
            return;
          }
          capsLoading = false;
          updateHints();
          renderGrid();
        });
    }
  });
}

async function showPvpRoomModal({ setup, capSelection, auraSession }) {
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
        <p class="setup-hint">Logged-in only. ${modeLabel} room on ${ARENA_CONFIGS[setup.arenaKey]?.label || "selected map"}.</p>
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

    const setMode = (nextMode) => {
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
        const payload = await listPvpRooms({ auraSession });
        const rooms = Array.isArray(payload?.rooms) ? payload.rooms : [];
        if (rooms.length === 0) {
          publicRoomsEl.innerHTML = `<p>No public rooms yet. Create one and let another mfer join.</p>`;
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
      const roomCode = room?.room_code || room?.code || room?.id || "";
      const roomId = room?.id || "";
      const inviteUrl = roomCode
        ? `${window.location.origin}${window.location.pathname}?pvp=${encodeURIComponent(roomCode)}`
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
        <small>Next step: realtime waiting room + remote turn sync. Room id: ${roomId || "pending"}</small>
      `;
      const copyCodeBtn = resultEl.querySelector("#pvpCopyCodeBtn");
      const copyLinkBtn = resultEl.querySelector("#pvpCopyLinkBtn");
      copyCodeBtn?.addEventListener("click", () => {
        navigator.clipboard?.writeText(roomCode).catch(() => {});
      });
      copyLinkBtn?.addEventListener("click", () => {
        navigator.clipboard?.writeText(inviteUrl).catch(() => {});
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
          const state = await getPvpRoom({ auraSession, roomId, roomCode });
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
                auraSession,
                roomCode: codeInput?.value || "",
                capSelection,
              })
            : await createPvpRoom({
                auraSession,
                setup: {
                  ...setup,
                  isPrivate: Boolean(privateInput?.checked),
                },
                capSelection,
              });
        if (closed) {
          return;
        }
        showRoomResult(payload);
        await waitForReadyRoom(payload);
      } catch (error) {
        resultEl.textContent = error?.message || "PvP room request failed.";
      } finally {
        if (!closed) {
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

function loadProfileModule() {
  profileModulePromise ??= import("./screens/profile.js");
  return profileModulePromise;
}

function loadGameModule() {
  gameModulePromise ??= import("./game/DiscDropGame.js");
  return gameModulePromise;
}

function loadPvpModule() {
  pvpModulePromise ??= import("./pvp/client.js");
  return pvpModulePromise;
}

function startPvpMatchController({
  gameInstance,
  auraSession,
  roomState,
  localPlayer,
  opponentPlayer,
  getPvpRoom,
  subscribePvpRoom,
  sendPvpAim,
}) {
  let stopped = false;
  let pollTimeoutId = null;
  let refreshInFlight = false;
  const replayedTurnIds = new Set();
  const announcedRounds = new Set();
  const localId = localPlayer.auraUserId || localPlayer.walletAddress;
  const opponentId = opponentPlayer?.player_id || "";
  const opponentName = opponentPlayer?.player_name || "opponent";
  const localName = localPlayer.username || "you";
  const roomId = roomState?.room?.id;

  const scoreFor = (turn) => Number(turn?.result?.score || 0);
  const turnsForRound = (turns, round) =>
    turns.filter((turn) => Number(turn.round) === Number(round));

  const matchScore = (turns) => {
    let player = 0;
    let opponent = 0;
    for (let round = 1; round <= 4; round += 1) {
      const roundTurns = turnsForRound(turns, round);
      const own = roundTurns.find((turn) => turn.player_id === localId);
      const other = roundTurns.find((turn) => turn.player_id === opponentId);
      if (!own || !other) continue;
      if (scoreFor(own) > scoreFor(other)) player += 1;
      else if (scoreFor(other) > scoreFor(own)) opponent += 1;
    }
    return { player, opponent };
  };

  const applyState = (state) => {
    if (stopped || !state?.room) return;
    const turns = Array.isArray(state.turns) ? state.turns : [];
    const round = Number(state.room.current_round || 1);
    const scores = matchScore(turns);
    const currentRoundTurns = turnsForRound(turns, round);
    const ownTurn = currentRoundTurns.find((turn) => turn.player_id === localId);
    const opponentTurn = currentRoundTurns.find((turn) => turn.player_id === opponentId);
    const isMyTurn =
      state.room.status === "playing" &&
      state.room.current_turn === localId &&
      !ownTurn;

    gameInstance.setPvpPlayers({
      playerName: localName,
      opponentName,
    });

    for (let completedRound = 1; completedRound <= 4; completedRound += 1) {
      if (announcedRounds.has(completedRound)) continue;
      const roundTurns = turnsForRound(turns, completedRound);
      const own = roundTurns.find((turn) => turn.player_id === localId);
      const other = roundTurns.find((turn) => turn.player_id === opponentId);
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
      return;
    }

    const shouldReplayOpponent =
      opponentTurn &&
      !replayedTurnIds.has(opponentTurn.id) &&
      (!ownTurn || state.room.current_turn === localId);
    if (shouldReplayOpponent) {
      replayedTurnIds.add(opponentTurn.id);
      gameInstance.playPvpOpponentTurn(opponentTurn, opponentName);
      return;
    }

    gameInstance.setPvpTurnState({
      isMyTurn,
      round,
      playerScore: scores.player,
      opponentScore: scores.opponent,
      forceReady: isMyTurn && !ownTurn,
    });

    if (ownTurn && !opponentTurn) {
      gameInstance.setStatus("turn submitted", `${opponentName}'s turn`);
      gameInstance.showCenterNotice(`YOUR SCORE\n${scoreFor(ownTurn)}`, 1600);
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
      pollTimeoutId = setTimeout(poll, 1200);
      return;
    }
    refreshInFlight = true;
    try {
      const state = await getPvpRoom({ auraSession, roomId });
      applyState(state);
    } catch (error) {
      console.warn("[AURA PvP] room poll failed", error);
    } finally {
      refreshInFlight = false;
    }
    if (!stopped) {
      pollTimeoutId = setTimeout(poll, 2500);
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

  applyState(roomState);
  pollTimeoutId = setTimeout(poll, 800);

  return () => {
    stopped = true;
    unsubscribeRealtime?.();
    if (pollTimeoutId !== null) {
      clearTimeout(pollTimeoutId);
    }
  };
}

function clearCurrentScreen() {
  closeLoginGate();
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

function setViewMode(mode) {
  app.className = `mode-${mode} theme-${currentTheme}`;
}

function setTheme(nextTheme) {
  currentTheme = nextTheme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch {
    // Ignore storage failures.
  }
}

function maybeStartPendingPvpInvite() {
  if (!pendingPvpInviteCode || pendingPvpInviteStarted || !hasAuraSession(auraSession)) {
    return;
  }
  pendingPvpInviteStarted = true;
  setTimeout(() => {
    showPlay({ pvpRoomCode: pendingPvpInviteCode });
  }, 100);
}

async function showMenu() {
  const localVersion = ++viewVersion;
  auraSession = loadAuraSession();
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
      clearGuestMode();
      saveAuraSession(auraSession);
      closeLoginGate();
      maybeStartPendingPvpInvite();
    },
    onAuraDisconnect: () => {
      auraSession = null;
      saveAuraSession(null);
    },
    onThemeChange: (nextTheme) => {
      if (nextTheme !== currentTheme) {
        setTheme(nextTheme);
        showMenu();
      }
    },
    onPlay: showPlay,
    onCollection: showCollection,
    onProfile: showProfile,
  });
  showLoginGateIfNeeded();
  maybeStartPendingPvpInvite();
}

async function showPlay({ pvpRoomCode = "" } = {}) {
  const localVersion = ++viewVersion;
  let setup = null;
  if (pvpRoomCode) {
    if (!hasAuraSession(auraSession)) {
      showLoginGateIfNeeded();
      return;
    }
    const { getPvpRoom } = await loadPvpModule();
    try {
      const preview = await getPvpRoom({ auraSession, roomCode: pvpRoomCode });
      setup = {
        arenaKey: preview?.room?.map_id || DEFAULT_ARENA_KEY,
        battleMode: "pvp",
        gameMode: preview?.room?.mode || "classic",
        pvpRoomCode,
      };
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
    return;
  }
  auraSession = loadAuraSession();
  if (setup.battleMode === "pvp" && !hasAuraSession(auraSession)) {
    showLoginGateIfNeeded();
    return;
  }
  const capSelection = await showCapSelectModal({
    theme: currentTheme,
    battleMode: setup.battleMode,
    gameMode: setup.gameMode,
  });
  if (localVersion !== viewVersion) {
    return;
  }
  if (!capSelection) {
    return;
  }

  if (setup.battleMode === "pvp") {
    const roomState = await showPvpRoomModal({ setup, capSelection, auraSession });
    if (localVersion !== viewVersion || !roomState?.room) {
      return;
    }
    const {
      getAuraPlayerIdentity,
      getPvpRoom,
      sendPvpAim,
      subscribePvpRoom,
      submitPvpTurnResult,
    } = await loadPvpModule();
    const localPlayer = getAuraPlayerIdentity(auraSession);
    const players = Array.isArray(roomState.players) ? roomState.players : [];
    const ownPlayer =
      players.find((player) => player.player_id === localPlayer.auraUserId) ||
      players.find((player) => player.player_id === localPlayer.walletAddress) ||
      players[0];
    const opponentPlayer =
      players.find((player) => player.player_id !== ownPlayer?.player_id) || null;
    const pvpSetup = {
      ...setup,
      ...(roomState.room.setup || {}),
      battleMode: "pvp",
    };

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
      initialArenaKey: pvpSetup.arenaKey || roomState.room.map_id || setup.arenaKey,
      battleMode: "pvp",
      gameMode: pvpSetup.gameMode || roomState.room.mode || setup.gameMode,
      playerCapPath:
        ownPlayer?.selected_cap?.imagePath || capSelection.playerCapPath,
      cpuCapPath: opponentPlayer?.selected_cap?.imagePath || null,
      playerCapMeta: ownPlayer?.selected_cap || capSelection.playerCapMeta || null,
      cpuCapMeta: opponentPlayer?.selected_cap || null,
      onPvpTurnResult: (turn) =>
        submitPvpTurnResult({
          auraSession,
          roomId: roomState.room.id,
          turn,
        }),
    });
    await game.init();
    cleanupPvpController = startPvpMatchController({
      gameInstance: game,
      auraSession,
      roomState,
      localPlayer,
      opponentPlayer,
      getPvpRoom,
      subscribePvpRoom,
      sendPvpAim,
    });
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
  cleanupScreen = composeCleanups(addBackButton(showMenu), addGlobalMuteButton());
}

async function showCollection() {
  const localVersion = ++viewVersion;
  auraSession = loadAuraSession();
  clearCurrentScreen();
  setViewMode("collection");
  const { mountCollectionScreen } = await loadCollectionModule();
  if (localVersion !== viewVersion) {
    return;
  }
  cleanupScreen = composeCleanups(
    mountCollectionScreen({ app, onBack: showMenu, auraSession }),
    addGlobalMuteButton()
  );
}

async function showProfile() {
  const localVersion = ++viewVersion;
  auraSession = loadAuraSession();
  clearCurrentScreen();
  setViewMode("profile");
  const { mountProfileScreen } = await loadProfileModule();
  if (localVersion !== viewVersion) {
    return;
  }
  cleanupScreen = composeCleanups(
    mountProfileScreen({ app, onBack: showMenu, auraSession }),
    addGlobalMuteButton()
  );
}

showMenu();
