import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DISC_HEIGHT, DISC_RADIUS } from "../game/constants.js";
import { createDiscMesh, loadDiscTexture } from "../game/discs.js";
import { getCapWeightMultiplier } from "../game/cap-physics.js";
import { fetchAuraInventory } from "../aura/inventory.js";

export function mountCollectionScreen({ app, onBack, auraSession = null }) {
  const hasAuraSession = Boolean(
    auraSession?.connected ||
      auraSession?.walletAddress ||
      auraSession?.user
  );
  const AURA_DEBUG_KEY = "aura_debug";
  const auraDebugLog = (...args) => {
    try {
      const debugEnabled = window.localStorage.getItem(AURA_DEBUG_KEY) === "1";
      window.__AURA_LOGS__ = Array.isArray(window.__AURA_LOGS__)
        ? window.__AURA_LOGS__
        : [];
      window.__AURA_LOGS__.push({
        scope: "collection",
        at: new Date().toISOString(),
        args,
      });
      if (debugEnabled) {
        console.log("[AURA][COLLECTION][DEBUG]", ...args);
      }
    } catch {
      // Ignore diagnostic logging failures.
    }
  };
  const resolveSpritePlayback = (image, hints) => {
    const maxFrames = 64;
    const naturalW = Math.max(1, image.naturalWidth || image.width || 1);
    const naturalH = Math.max(1, image.naturalHeight || image.height || 1);
    const inferredCols = Math.max(1, Math.min(maxFrames, Math.round(naturalW / naturalH)));
    const columns = Math.max(1, Math.min(maxFrames, hints?.columns || inferredCols || 1));
    const rows = Math.max(1, Math.min(8, hints?.rows || 1));
    const maxGridFrames = Math.max(1, columns * rows);
    const frameCount = Math.max(
      1,
      Math.min(maxGridFrames, hints?.frameCount || inferredCols || columns)
    );
    return {
      columns,
      rows,
      frameCount,
      fps: Math.max(1, Math.min(24, Number(hints?.fps || 8))),
      zoom: Math.max(1, Number(hints?.zoom || 1)),
    };
  };
  const getSpriteFrameBounds = ({ image, config, frame, cache }) => {
    if (!cache.bounds) {
      cache.bounds = new Map();
    }
    if (cache.bounds.has(frame)) {
      return cache.bounds.get(frame);
    }
    const cols = Math.max(1, config.columns);
    const rows = Math.max(1, config.rows);
    const frameW = Math.max(1, Math.floor(image.naturalWidth / cols));
    const frameH = Math.max(1, Math.floor(image.naturalHeight / rows));
    const col = frame % cols;
    const row = Math.floor(frame / cols);
    const sx = col * frameW;
    const sy = row * frameH;

    if (!cache.canvas) {
      cache.canvas = document.createElement("canvas");
      cache.ctx = cache.canvas.getContext("2d", { willReadFrequently: true });
    }
    if (cache.canvas.width !== frameW || cache.canvas.height !== frameH) {
      cache.canvas.width = frameW;
      cache.canvas.height = frameH;
    }
    cache.ctx.clearRect(0, 0, frameW, frameH);
    cache.ctx.drawImage(image, sx, sy, frameW, frameH, 0, 0, frameW, frameH);
    const { data } = cache.ctx.getImageData(0, 0, frameW, frameH);

    let minX = frameW;
    let minY = frameH;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < frameH; y += 1) {
      for (let x = 0; x < frameW; x += 1) {
        const alpha = data[(y * frameW + x) * 4 + 3];
        if (alpha > 8) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    const bounds =
      maxX >= minX && maxY >= minY
        ? { sx: sx + minX, sy: sy + minY, sw: maxX - minX + 1, sh: maxY - minY + 1 }
        : { sx, sy, sw: frameW, sh: frameH };
    cache.bounds.set(frame, bounds);
    return bounds;
  };

  const drawSpriteFrameToCanvas = ({ canvas, ctx, image, config, frame, sourceRect = null }) => {
    const cols = Math.max(1, config.columns);
    const rows = Math.max(1, config.rows);
    const frameW = image.naturalWidth / cols;
    const frameH = image.naturalHeight / rows;
    const frameIndex = Math.max(0, frame % Math.max(1, config.frameCount));
    const col = frameIndex % cols;
    const row = Math.floor(frameIndex / cols);
    const sx = col * frameW;
    const sy = row * frameH;
    const srcX = sourceRect?.sx ?? sx;
    const srcY = sourceRect?.sy ?? sy;
    const srcW = sourceRect?.sw ?? frameW;
    const srcH = sourceRect?.sh ?? frameH;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || 0;
    const cssH = canvas.clientHeight || 0;
    if (cssW > 0 && cssH > 0) {
      const targetW = Math.floor(cssW * dpr);
      const targetH = Math.floor(cssH * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale =
      Math.min(canvas.width / srcW, canvas.height / srcH) *
      Math.max(1, Number(config.zoom || 1));
    const dw = srcW * scale;
    const dh = srcH * scale;
    const dx = (canvas.width - dw) * 0.5;
    const dy = (canvas.height - dh) * 0.5;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, srcX, srcY, srcW, srcH, dx, dy, dw, dh);
  };
  const JUNGLE_BAY_CAP_PATHS = [
    "/caps/jb/jbcap1.webp",
    "/caps/jbcap2.webp",
    "/caps/jb/jbcap3.webp",
    "/caps/jb/jbcap4.webp",
    "/caps/jb/jbcap5.webp",
    "/caps/jb/jbcap6.webp",
  ];
  const BANKR_CAP_PATHS = [1, 2, 3].map((idx) => `/caps/bankr/${idx}.webp`);

  const F2P_CAP_ITEMS = [
    ...Array.from({ length: 9 }, (_, i) => ({
      number: i + 1,
      name: `Cap number ${i + 1}`,
      imagePath: `/caps/${i + 1}.webp`,
      subtitle: "ink's collection",
      details: `Series beta • Weight ${getCapWeightMultiplier(
        `/caps/${i + 1}.webp`
      ).toFixed(2)}x`,
    })),
    ...JUNGLE_BAY_CAP_PATHS.map((path, i) => ({
      number: i + 10,
      name: `Jungle cap ${i + 1}`,
      imagePath: path,
      subtitle: "loground's collection",
      details: `Series beta • Weight ${getCapWeightMultiplier(path).toFixed(2)}x`,
    })),
    ...BANKR_CAP_PATHS.map((path, i) => ({
      number: i + 16,
      name: `Bankr cap ${i + 1}`,
      imagePath: path,
      subtitle: "bankr collection",
      details: `Series beta • Weight ${getCapWeightMultiplier(path).toFixed(2)}x`,
    })),
  ];

  const F2P_SLAMMER_ITEMS = [1, 2, 3].map((idx) => ({
    number: idx,
    name: `Cap number ${idx}`,
    imagePath: `/caps/slammer${idx}.png`,
    subtitle: "eazystyler's collection",
    details: `Series beta • Weight ${getCapWeightMultiplier(
      `/caps/slammer${idx}.png`
    ).toFixed(2)}x`,
  }));

  const COLLECTIONS = {
    f2p: {
      id: "f2p",
      label: "f2p",
      loading: false,
      subcollections: {
        caps: {
          id: "caps",
          label: "caps",
          items: F2P_CAP_ITEMS,
        },
        slammers: {
          id: "slammers",
          label: "slammers",
          items: F2P_SLAMMER_ITEMS,
        },
      },
    },
  };

  if (hasAuraSession) {
    COLLECTIONS.aura = {
      id: "aura",
      label: "aura",
      loading: true,
      subcollections: {},
    };
  }
  let activeCollectionKey = hasAuraSession ? "aura" : "f2p";
  let activeSubKey = hasAuraSession ? "" : "caps";

  const normalizeCollectionKey = (label, fallback) => {
    const normalized = String(label || "")
      .trim()
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return normalized || fallback;
  };

  const groupAuraItemsByCollection = (items) => {
    const grouped = {};
    const labelByKey = new Map();
    items.forEach((item, index) => {
      const label = String(
        item.collectionName || item.subtitle || "aura collection"
      ).trim();
      const baseKey = normalizeCollectionKey(label, `aura-${index + 1}`);
      let key = baseKey;
      let suffix = 2;
      while (labelByKey.has(key) && labelByKey.get(key) !== label) {
        key = `${baseKey}-${suffix}`;
        suffix += 1;
      }
      labelByKey.set(key, label);
      if (!grouped[key]) {
        grouped[key] = {
          id: key,
          label,
          items: [],
        };
      }
      grouped[key].items.push(item);
    });
    return grouped;
  };

  app.innerHTML = `
    <div class="collection-screen">
      <button id="backBtn" class="back-btn" type="button">back</button>
      <h2>Collection</h2>
      <div class="collection-switcher" id="collectionSwitcher" role="tablist" aria-label="Collection tabs"></div>
      <div class="collection-switcher collection-sub-switcher" id="collectionSubSwitcher" role="tablist" aria-label="Collection sub tabs"></div>
      <div class="collection-grid" id="collectionGrid"></div>
      <div id="inspectorModal" class="inspector-modal hidden" aria-hidden="true">
        <div class="inspector-backdrop" id="inspectorBackdrop"></div>
        <div class="inspector-panel">
          <button id="inspectorClose" class="inspector-close" type="button">close</button>
          <div class="inspector-canvas-wrap" id="inspectorCanvasWrap"></div>
        </div>
      </div>
    </div>
  `;

  const grid = app.querySelector("#collectionGrid");
  const modal = app.querySelector("#inspectorModal");
  const modalBackdrop = app.querySelector("#inspectorBackdrop");
  const modalClose = app.querySelector("#inspectorClose");
  const canvasWrap = app.querySelector("#inspectorCanvasWrap");

  let inspectorRenderer = null;
  let inspectorScene = null;
  let inspectorCamera = null;
  let inspectorControls = null;
  let inspectorDisc = null;
  let frontTexture = null;
  let backTexture = null;
  let spriteAnimState = null;
  let rafId = null;
  let resizeObserver = null;
  let previewSpriteNodes = [];
  let previewSpriteRafId = null;
  let unmounted = false;

  const disposeInspector = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }

    if (inspectorControls) {
      inspectorControls.dispose();
      inspectorControls = null;
    }

    if (inspectorDisc) {
      inspectorDisc.geometry.dispose();
      const mats = Array.isArray(inspectorDisc.material)
        ? inspectorDisc.material
        : [inspectorDisc.material];
      for (const mat of mats) {
        mat.dispose();
      }
      inspectorScene.remove(inspectorDisc);
      inspectorDisc = null;
    }

    if (frontTexture) {
      frontTexture.dispose();
      frontTexture = null;
    }
    if (backTexture) {
      backTexture.dispose();
      backTexture = null;
    }

    if (inspectorRenderer) {
      inspectorRenderer.dispose();
      if (inspectorRenderer.domElement.parentElement) {
        inspectorRenderer.domElement.parentElement.removeChild(
          inspectorRenderer.domElement
        );
      }
      inspectorRenderer = null;
    }

    inspectorScene = null;
    inspectorCamera = null;
    spriteAnimState = null;
  };

  const stopPreviewSpriteAnimation = () => {
    if (previewSpriteRafId !== null) {
      cancelAnimationFrame(previewSpriteRafId);
      previewSpriteRafId = null;
    }
  };

  const startPreviewSpriteAnimation = () => {
    if (previewSpriteRafId !== null || previewSpriteNodes.length === 0) {
      return;
    }
    const tick = () => {
      previewSpriteRafId = requestAnimationFrame(tick);
      const nowSec = performance.now() * 0.001;
      for (const node of previewSpriteNodes) {
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
    previewSpriteRafId = requestAnimationFrame(tick);
  };

  const closeInspector = () => {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    disposeInspector();
  };

  const openInspector = (item) => {
    disposeInspector();

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");

    inspectorRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    inspectorRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    inspectorRenderer.outputColorSpace = THREE.SRGBColorSpace;
    inspectorRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    inspectorRenderer.toneMappingExposure = 1.2;
    inspectorRenderer.setClearColor(0x000000, 0);
    canvasWrap.appendChild(inspectorRenderer.domElement);

    inspectorScene = new THREE.Scene();
    inspectorCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    inspectorCamera.position.set(0, 0.9, 5.1);
    inspectorCamera.lookAt(0, 0, 0);

    inspectorControls = new OrbitControls(
      inspectorCamera,
      inspectorRenderer.domElement
    );
    inspectorControls.enablePan = false;
    inspectorControls.enableDamping = true;
    inspectorControls.minDistance = 3.1;
    inspectorControls.maxDistance = 6;

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.45);
    keyLight.position.set(2.5, 3.6, 2.7);
    inspectorScene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xe8f3ff, 0.9);
    fillLight.position.set(-2.3, 1.6, 2.1);
    inspectorScene.add(fillLight);
    inspectorScene.add(new THREE.AmbientLight(0xf3f7ff, 1.05));

    let spriteCanvas = null;
    let spriteCtx = null;
    let spriteImage = null;
    let spriteConfig = null;
    if (item.isAuraSprite) {
      spriteCanvas = document.createElement("canvas");
      spriteCanvas.width = 1024;
      spriteCanvas.height = 1024;
      spriteCtx = spriteCanvas.getContext("2d");
      frontTexture = new THREE.CanvasTexture(spriteCanvas);
      frontTexture.colorSpace = THREE.SRGBColorSpace;
      frontTexture.center.set(0.5, 0.5);
      frontTexture.repeat.set(1, 1);
      frontTexture.offset.set(0, 0);
      frontTexture.needsUpdate = true;
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.decoding = "async";
      image.onload = () => {
        spriteImage = image;
        spriteConfig =
          item._resolvedSpriteConfig ||
          resolveSpritePlayback(image, item.spriteHints);
        item._resolvedSpriteConfig = spriteConfig;
        const initialBounds = getSpriteFrameBounds({
          image: spriteImage,
          config: spriteConfig,
          frame: 0,
          cache: { bounds: new Map() },
        });
        drawSpriteFrameToCanvas({
          canvas: spriteCanvas,
          ctx: spriteCtx,
          image: spriteImage,
          config: spriteConfig,
          frame: 0,
          sourceRect: initialBounds,
        });
        frontTexture.needsUpdate = true;
      };
      image.src = item.imagePath;
    } else {
      frontTexture = loadDiscTexture(inspectorRenderer, item.imagePath);
    }
    backTexture = loadDiscTexture(inspectorRenderer, "/caps/back1.png");
    backTexture.rotation = Math.PI * 0.5;
    spriteAnimState = item.isAuraSprite
      ? {
          texture: frontTexture,
          canvas: spriteCanvas,
          ctx: spriteCtx,
          image: () => spriteImage,
          config: () => spriteConfig,
          boundsCache: {},
          lastFrame: -1,
        }
      : null;
    frontTexture.rotation = Math.PI * 0.5;

    inspectorDisc = createDiscMesh({
      radius: DISC_RADIUS * 1.06,
      height: DISC_HEIGHT * 0.65,
      sideColor: "#b8bfd4",
      topFaceMap: frontTexture,
      bottomFaceMap: backTexture,
    });
    inspectorDisc.rotation.x = Math.PI * 0.5;
    inspectorScene.add(inspectorDisc);

    const syncSize = () => {
      const width = canvasWrap.clientWidth || 640;
      const height = canvasWrap.clientHeight || 420;
      inspectorRenderer.setSize(width, height, false);
      inspectorCamera.aspect = width / height;
      inspectorCamera.updateProjectionMatrix();
    };

    resizeObserver = new ResizeObserver(syncSize);
    resizeObserver.observe(canvasWrap);
    syncSize();

    const render = () => {
      rafId = requestAnimationFrame(render);
      inspectorDisc.rotation.z += 0.0025;
      if (spriteAnimState) {
        const image = spriteAnimState.image();
        const config = spriteAnimState.config();
        if (image && config) {
          const frame =
            Math.floor(performance.now() * 0.001 * config.fps) % config.frameCount;
          if (frame !== spriteAnimState.lastFrame) {
            spriteAnimState.lastFrame = frame;
            const sourceRect = getSpriteFrameBounds({
              image,
              config,
              frame,
              cache: spriteAnimState.boundsCache,
            });
            drawSpriteFrameToCanvas({
              canvas: spriteAnimState.canvas,
              ctx: spriteAnimState.ctx,
              image,
              config,
              frame,
              sourceRect,
            });
            spriteAnimState.texture.needsUpdate = true;
          }
        }
      }
      inspectorControls.update();
      inspectorRenderer.render(inspectorScene, inspectorCamera);
    };
    render();
  };

  const switcher = app.querySelector("#collectionSwitcher");
  const subSwitcher = app.querySelector("#collectionSubSwitcher");

  const getActiveTopCollection = () => COLLECTIONS[activeCollectionKey] || null;

  const getSubcollections = () =>
    getActiveTopCollection()?.subcollections || {};

  const syncActiveSubKey = () => {
    const subcollections = getSubcollections();
    if (activeSubKey && subcollections[activeSubKey]) {
      return;
    }
    activeSubKey = Object.keys(subcollections)[0] || "";
  };

  const getActiveSubcollection = () => {
    syncActiveSubKey();
    return getSubcollections()[activeSubKey] || null;
  };

  const renderSwitcher = () => {
    switcher.innerHTML = "";
    Object.values(COLLECTIONS).forEach((collection) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `collection-tab ${
        collection.id === activeCollectionKey ? "active" : ""
      }`;
      btn.textContent = collection.label;
      btn.setAttribute("role", "tab");
      btn.setAttribute(
        "aria-selected",
        collection.id === activeCollectionKey ? "true" : "false"
      );
      btn.addEventListener("click", () => {
        if (activeCollectionKey === collection.id) {
          return;
        }
        activeCollectionKey = collection.id;
        activeSubKey = Object.keys(collection.subcollections || {})[0] || "";
        renderSwitcher();
        renderSubSwitcher();
        renderCards();
      });
      switcher.appendChild(btn);
    });
  };

  const renderSubSwitcher = () => {
    subSwitcher.innerHTML = "";
    const topCollection = getActiveTopCollection();
    const subcollections = getSubcollections();
    const subcollectionEntries = Object.values(subcollections);

    if (topCollection?.loading) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "collection-tab active";
      btn.textContent = "loading";
      btn.disabled = true;
      subSwitcher.appendChild(btn);
      return;
    }

    if (subcollectionEntries.length === 0) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "collection-tab active";
      btn.textContent = "empty";
      btn.disabled = true;
      subSwitcher.appendChild(btn);
      return;
    }

    syncActiveSubKey();
    subcollectionEntries.forEach((subcollection) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `collection-tab ${
        subcollection.id === activeSubKey ? "active" : ""
      }`;
      btn.textContent = subcollection.label;
      btn.setAttribute("role", "tab");
      btn.setAttribute(
        "aria-selected",
        subcollection.id === activeSubKey ? "true" : "false"
      );
      btn.addEventListener("click", () => {
        if (activeSubKey === subcollection.id) {
          return;
        }
        activeSubKey = subcollection.id;
        renderSubSwitcher();
        renderCards();
      });
      subSwitcher.appendChild(btn);
    });
  };

  const renderCards = () => {
    const topCollection = getActiveTopCollection();
    const active = getActiveSubcollection();
    stopPreviewSpriteAnimation();
    previewSpriteNodes = [];
    grid.innerHTML = "";
    if (!topCollection) {
      return;
    }

    if (topCollection.loading) {
      const card = document.createElement("div");
      card.className = "collection-card";
      card.innerHTML = `
      <div class="cap-slot">
        <div class="disc-card" aria-label="Loading Aura items">
          <div class="cap-loading">
            <span class="cap-loading-spinner" aria-hidden="true"></span>
            <span class="cap-loading-text">loading aura items</span>
          </div>
        </div>
      </div>
      <div class="cap-info">
        <h3>AURA</h3>
        <p>owned inventory</p>
        <p>syncing metadata...</p>
      </div>
    `;
      grid.appendChild(card);
      return;
    }

    if (!active || !Array.isArray(active.items) || active.items.length === 0) {
      const card = document.createElement("div");
      card.className = "collection-card";
      const title = topCollection.id === "aura" ? "No AURA items" : "No items";
      const description =
        topCollection.id === "aura"
          ? "go rip some packs on auramaxx to get to your collection and rip some asses in this epic battle!!"
          : "this section is empty for now.";
      card.innerHTML = `
      <div class="cap-slot">
        <div class="disc-card" aria-label="No Aura items">
          <div class="cap-loading loaded">
            <span class="cap-loading-text">empty</span>
          </div>
        </div>
      </div>
      <div class="cap-info">
        <h3>${title}</h3>
        <p>${topCollection.label}</p>
        <p>${description}</p>
      </div>
    `;
      grid.appendChild(card);
      return;
    }

    active.items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "collection-card";
      card.innerHTML = `
      <div class="cap-slot">
        <button class="disc-card" type="button" aria-label="Inspect ${item.name}">
          <div class="cap-loading">
            <span class="cap-loading-spinner" aria-hidden="true"></span>
            <span class="cap-loading-text">loading</span>
          </div>
          <img src="${item.imagePath}" alt="${item.name}" loading="lazy" decoding="async" />
        </button>
      </div>
      <div class="cap-info">
        <h3>${item.name}</h3>
        <p>${item.subtitle}</p>
        <p>${item.details}</p>
        <button class="inspect-btn" type="button">inspect</button>
      </div>
    `;
      card.querySelector(".disc-card").addEventListener("click", () => {
        openInspector(item);
      });
      card.querySelector(".inspect-btn").addEventListener("click", () => {
        openInspector(item);
      });

      const img = card.querySelector("img");
      const discBtn = card.querySelector(".disc-card");
      const loadingEl = card.querySelector(".cap-loading");
      if (item.isAuraSprite && img && discBtn) {
        const canvas = document.createElement("canvas");
        canvas.className = "sprite-preview-canvas";
        discBtn.appendChild(canvas);
        img.style.display = "none";
        const spriteImage = new Image();
        spriteImage.crossOrigin = "anonymous";
        spriteImage.decoding = "async";
        spriteImage.onload = () => {
          const config = resolveSpritePlayback(spriteImage, item.spriteHints);
          item._resolvedSpriteConfig = config;
          previewSpriteNodes.push({
            canvas,
            ctx: canvas.getContext("2d"),
            image: spriteImage,
            config,
            lastFrame: -1,
          });
          loadingEl?.classList.add("loaded");
          startPreviewSpriteAnimation();
        };
        spriteImage.onerror = () => {
          loadingEl?.classList.add("loaded");
          img.style.display = "";
          img.classList.add("loaded");
        };
        spriteImage.src = item.imagePath;
      }
      const markLoaded = () => {
        loadingEl?.classList.add("loaded");
        img?.classList.add("loaded");
      };
      if (img && !item.isAuraSprite) {
        if (img.complete) {
          markLoaded();
        } else {
          img.addEventListener("load", markLoaded, { once: true });
          img.addEventListener("error", markLoaded, { once: true });
        }
      }
      grid.appendChild(card);
    });
    startPreviewSpriteAnimation();
  };

  const readStoredAuraSession = () => {
    try {
      const raw = window.localStorage.getItem("aura_session_v1");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const walletAddress =
        parsed?.walletAddress ||
        parsed?.user?.walletAddress ||
        parsed?.user?.address ||
        "";
      if (!walletAddress && !parsed?.user) return null;
      return { connected: true, walletAddress, user: parsed?.user || null };
    } catch {
      return null;
    }
  };

  const mapAuraCollectionItem = (item, index) => {
    const detailsBits = [`Series ${item.series || "beta"}`];
    if (item.rarity) {
      detailsBits.push(`Rarity ${item.rarity}`);
    }
    detailsBits.push(`Weight ${Number(item.weightMultiplier || 1).toFixed(2)}x`);
    return {
      number: index + 1,
      name: item.name,
      imagePath: item.imagePath,
      subtitle: item.collection || "aura collection",
      collectionName: item.collection || "aura collection",
      details: detailsBits.join(" • "),
      rarity: item.rarity || "",
      weightMultiplier: item.weightMultiplier || 1,
      spriteHints: item.spriteHints || null,
      isAuraSprite: Boolean(item.isAuraSprite),
    };
  };

  const loadAuraCollection = async () => {
    if (!COLLECTIONS.aura) return;

    try {
      const inventoryItems = await fetchAuraInventory({
        sessionLike: auraSession || readStoredAuraSession(),
        limit: 24,
      });
      const items = inventoryItems.map(mapAuraCollectionItem);
      auraDebugLog("mapped Aura collection inventory items", items);
      COLLECTIONS.aura.loading = false;
      COLLECTIONS.aura.subcollections = groupAuraItemsByCollection(items);
      if (activeCollectionKey === "aura") {
        activeSubKey = Object.keys(COLLECTIONS.aura.subcollections)[0] || "";
      }
    } catch (error) {
      auraDebugLog("failed to load Aura collection", error);
      COLLECTIONS.aura.loading = false;
      COLLECTIONS.aura.subcollections = {};
    }

    if (!unmounted) {
      renderSwitcher();
      renderSubSwitcher();
      renderCards();
    }
  };

  renderSwitcher();
  renderSubSwitcher();
  renderCards();
  if (COLLECTIONS.aura) {
    loadAuraCollection();
  }

  const backBtn = app.querySelector("#backBtn");
  backBtn.addEventListener("click", onBack);
  modalClose.addEventListener("click", closeInspector);
  modalBackdrop.addEventListener("click", closeInspector);

  return () => {
    stopPreviewSpriteAnimation();
    previewSpriteNodes = [];
    unmounted = true;
    closeInspector();
    backBtn.removeEventListener("click", onBack);
    modalClose.removeEventListener("click", closeInspector);
    modalBackdrop.removeEventListener("click", closeInspector);
  };
}
