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
let game = null;
let viewVersion = 0;
let currentTheme = pickRefreshTheme();
let menuModulePromise = null;
let collectionModulePromise = null;
let profileModulePromise = null;
let gameModulePromise = null;

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
        <label>
          Map
          <select id="setupArenaSelect">${arenaOptions}</select>
        </label>
        <p id="setupMapHint" class="setup-hint"></p>
        <div class="mode-picker">
          <span class="mode-label">Battle Mode</span>
          <div class="mode-buttons">
            <button id="setupBattleTrainingBtn" class="mode-btn" type="button">Training</button>
            <button id="setupBattleVsAiBtn" class="mode-btn active" type="button">Vs AI</button>
          </div>
        </div>
        <p id="setupBattleHint" class="setup-hint">
          Vs AI: 4 rounds against computer. Best score wins the match.
        </p>
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
          <button id="setupLaunchBtn" type="button">next</button>
        </div>
      </div>
    `;

    app.appendChild(overlay);

    const arenaSelect = overlay.querySelector("#setupArenaSelect");
    const mapHint = overlay.querySelector("#setupMapHint");
    const battleTrainingBtn = overlay.querySelector("#setupBattleTrainingBtn");
    const battleVsAiBtn = overlay.querySelector("#setupBattleVsAiBtn");
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
          ? "Slammer: 6 caps stack on floor. Throw heavier slammer and flip 4+ caps face up to win."
          : "Classic: 2 caps duel. Land and spin to end with more green faces up.";
    };
    updateModeUI();

    const updateBattleModeUI = () => {
      if (!battleHint) {
        return;
      }
      battleTrainingBtn?.classList.toggle("active", selectedBattleMode === "training");
      battleVsAiBtn?.classList.toggle("active", selectedBattleMode === "vs-ai");
      battleHint.textContent =
        selectedBattleMode === "vs-ai"
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
    battleTrainingBtn?.addEventListener("click", onBattleTraining);
    battleVsAiBtn?.addEventListener("click", onBattleVsAi);
    modeClassicBtn?.addEventListener("click", onModeClassic);
    modeSlammerBtn?.addEventListener("click", onModeSlammer);
    arenaSelect?.addEventListener("change", updateMapHint);

    const cleanup = () => {
      battleTrainingBtn?.removeEventListener("click", onBattleTraining);
      battleVsAiBtn?.removeEventListener("click", onBattleVsAi);
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
    overlay.innerHTML = `
      <div class="play-setup-backdrop"></div>
      <div class="play-setup-panel caps-select-panel">
        <button id="capsCloseBtn" class="play-setup-close" type="button" aria-label="Close cap selection">×</button>
        <h2>Select Caps</h2>
        <p>${isTraining ? "Pick your cap from the grid." : "Pick caps from the grid for you and CPU."}</p>
        <div class="cap-pick-targets">
          <button id="pickPlayerBtn" class="mode-btn active" type="button">Selecting: You</button>
          ${
            isTraining
              ? ""
              : `<button id="pickCpuBtn" class="mode-btn" type="button">Selecting: CPU</button>`
          }
        </div>
        <div id="capsGrid" class="cap-pick-grid" role="listbox" aria-label="Cap choices"></div>
        <div class="cap-pick-summary">
          <p id="playerCapHint" class="setup-hint"></p>
          ${
            isTraining
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
    const pickPlayerBtn = overlay.querySelector("#pickPlayerBtn");
    const pickCpuBtn = overlay.querySelector("#pickCpuBtn");
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
    let selectableCaps = [...baseCaps];
    let capsLoading = gameMode !== "slammer";
    let isClosed = false;
    let spritePreviewNodes = [];
    let spritePreviewRafId = null;
    const byId = (id) => selectableCaps.find((cap) => cap.id === id) || selectableCaps[0];
    const playerDefaultCandidate = gameMode === "slammer" ? "slammer-1" : "classic-1";
    const cpuDefaultCandidate =
      gameMode === "slammer" ? "slammer-3" : isBrainrot ? "classic-9" : "classic-8";
    const playerDefault = byId(playerDefaultCandidate)?.id;
    const cpuDefault = byId(cpuDefaultCandidate)?.id;
    let selectedTarget = "player";
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

    const renderGrid = () => {
      if (!capsGrid) {
        return;
      }
      stopSpritePreviewAnimation();
      spritePreviewNodes = [];
      const selectedId =
        selectedTarget === "cpu" && !isTraining ? selectedCpuCapId : selectedPlayerCapId;
      if (capsLoading && selectableCaps.length === 0) {
        capsGrid.innerHTML = `
          <div class="cap-pick-loading">
            <span class="cap-loading-spinner" aria-hidden="true"></span>
            <span class="cap-loading-text">loading aura caps</span>
          </div>
        `;
        return;
      }
      capsGrid.innerHTML = selectableCaps
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
          if (selectedTarget === "cpu" && !isTraining) {
            selectedCpuCapId = capId;
          } else {
            selectedPlayerCapId = capId;
          }
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

    const updateTargetButtons = () => {
      pickPlayerBtn?.classList.toggle("active", selectedTarget === "player");
      pickCpuBtn?.classList.toggle("active", selectedTarget === "cpu");
    };

    const updateHints = () => {
      if (playerHint) {
        playerHint.textContent = renderHint("You", byId(selectedPlayerCapId));
      }
      if (cpuHint && !isTraining) {
        cpuHint.textContent = renderHint("CPU", byId(selectedCpuCapId));
      }
    };
    updateHints();
    updateTargetButtons();
    renderGrid();

    const cleanup = () => {
      isClosed = true;
      stopSpritePreviewAnimation();
      pickPlayerBtn?.removeEventListener("click", onPickPlayer);
      pickCpuBtn?.removeEventListener("click", onPickCpu);
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
        cpuCapPath: isTraining ? null : cpuCap.imagePath,
        playerCapMeta: {
          id: playerCap.id,
          name: playerCap.name,
          imagePath: playerCap.imagePath,
          weightMultiplier: playerCap.weightMultiplier ?? null,
          rarity: playerCap.rarity || "",
          isAuraSprite: Boolean(playerCap.isAuraSprite),
          spriteHints: playerCap.spriteHints || null,
        },
        cpuCapMeta: isTraining
          ? null
          : {
              id: cpuCap.id,
              name: cpuCap.name,
              imagePath: cpuCap.imagePath,
              weightMultiplier: cpuCap.weightMultiplier ?? null,
              rarity: cpuCap.rarity || "",
              isAuraSprite: Boolean(cpuCap.isAuraSprite),
              spriteHints: cpuCap.spriteHints || null,
            },
      });
    };
    const onPickPlayer = () => {
      selectedTarget = "player";
      updateTargetButtons();
      renderGrid();
    };
    const onPickCpu = () => {
      if (isTraining) {
        return;
      }
      selectedTarget = "cpu";
      updateTargetButtons();
      renderGrid();
    };
    pickPlayerBtn?.addEventListener("click", onPickPlayer);
    pickCpuBtn?.addEventListener("click", onPickCpu);
    closeBtn?.addEventListener("click", onCancel);
    launchBtn?.addEventListener("click", onLaunch);
    backdrop?.addEventListener("click", onCancel);

    if (gameMode !== "slammer") {
      fetchAuraCapOptions(auraSession || loadAuraSession())
        .then((auraCaps) => {
          if (isClosed) {
            return;
          }
          if (Array.isArray(auraCaps) && auraCaps.length > 0) {
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
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch {
    // Ignore storage failures.
  }
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
      saveAuraSession(auraSession);
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
