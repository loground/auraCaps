import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DISC_HEIGHT, DISC_RADIUS } from "../game/constants.js";
import { createDiscMesh, loadDiscTexture } from "../game/discs.js";
import { getCapWeightMultiplier } from "../game/cap-physics.js";

export function mountCollectionScreen({ app, onBack, auraSession = null }) {
  const AURA_SPRITE_NAMES = new Set([
    "FILTHY",
    "GOLDIE",
    "ALI",
    "YODIE",
    "WILLY",
    "EAZY",
  ]);
  const parseSpriteHints = (configLike = {}) => {
    const columns = Number.parseInt(String(configLike.columns ?? configLike.cols ?? ""), 10);
    const rows = Number.parseInt(String(configLike.rows ?? ""), 10);
    const frameCount = Number.parseInt(String(configLike.frameCount ?? configLike.frames ?? ""), 10);
    const fps = Number(configLike.fps);
    return {
      columns: Number.isFinite(columns) && columns > 0 ? columns : undefined,
      rows: Number.isFinite(rows) && rows > 0 ? rows : undefined,
      frameCount: Number.isFinite(frameCount) && frameCount > 0 ? frameCount : undefined,
      fps: Number.isFinite(fps) && fps > 0 ? fps : 8,
    };
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
    const scale = Math.min(canvas.width / srcW, canvas.height / srcH);
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

  const COLLECTIONS = {
    classic: {
      id: "classic",
      label: "classic",
      items: Array.from({ length: 9 }, (_, i) => ({
        number: i + 1,
        name: `Cap number ${i + 1}`,
        imagePath: `/caps/${i + 1}.webp`,
        subtitle: "ink's collection",
        details: `Series beta • Weight ${getCapWeightMultiplier(
          `/caps/${i + 1}.webp`
        ).toFixed(2)}x`,
      })),
    },
    jungleBay: {
      id: "jungleBay",
      label: "jungle bay",
      items: JUNGLE_BAY_CAP_PATHS.map((path, i) => ({
        number: i + 1,
        name: `Cap number ${i + 1}`,
        imagePath: path,
        subtitle: "loground's collection",
        details: `Series beta • Weight ${getCapWeightMultiplier(path).toFixed(2)}x`,
      })),
    },
    slammers: {
      id: "slammers",
      label: "slammers",
      items: [1, 2, 3].map((idx) => ({
        number: idx,
        name: `Cap number ${idx}`,
        imagePath: `/caps/slammer${idx}.png`,
        subtitle: "eazystyler's collection",
        details: `Series beta • Weight ${getCapWeightMultiplier(`/caps/slammer${idx}.png`).toFixed(
          2
        )}x`,
      })),
    },
    aura: {
      id: "aura",
      label: "aura",
      items: [],
      loading: true,
    },
  };
  let activeCollectionKey = app.classList.contains("theme-jungle-bay")
    ? "jungleBay"
    : "classic";

  app.innerHTML = `
    <div class="collection-screen">
      <button id="backBtn" class="back-btn" type="button">back</button>
      <h2>Collection</h2>
      <div class="collection-switcher" id="collectionSwitcher" role="tablist" aria-label="Collection tabs"></div>
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
        renderSwitcher();
        renderCards();
      });
      switcher.appendChild(btn);
    });
  };

  const renderCards = () => {
    const active = COLLECTIONS[activeCollectionKey];
    stopPreviewSpriteAnimation();
    previewSpriteNodes = [];
    grid.innerHTML = "";
    if (!active) {
      return;
    }

    if (active.loading) {
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

    if (!Array.isArray(active.items) || active.items.length === 0) {
      const card = document.createElement("div");
      card.className = "collection-card";
      card.innerHTML = `
      <div class="cap-slot">
        <div class="disc-card" aria-label="No Aura items">
          <div class="cap-loading loaded">
            <span class="cap-loading-text">empty</span>
          </div>
        </div>
      </div>
      <div class="cap-info">
        <h3>No AURA items</h3>
        <p>owned inventory</p>
        <p>connect Aura to load owned collectibles.</p>
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
      if (!walletAddress && !parsed?.user) {
        return null;
      }
      return { connected: true, walletAddress, user: parsed?.user || null };
    } catch {
      return null;
    }
  };

  const pickAuraLookupValue = (sessionLike) => {
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
  };

  const toAbsImage = (imageLike) => {
    const value = String(imageLike || "").trim();
    if (!value) return "";
    if (value.startsWith("ipfs://")) {
      return `https://ipfs.io/ipfs/${value.slice("ipfs://".length)}`;
    }
    if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/")) {
      return value;
    }
    return `https://ipfs.io/ipfs/${value}`;
  };

  const extractInventoryItems = (payload) => {
    const candidates = [
      payload?.data,
      payload?.items,
      payload?.cards,
      payload?.results,
      payload?.packCards,
      payload,
    ];
    let rows = [];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        rows = candidate;
        break;
      }
    }
    const seen = new Set();
    const mapped = [];
    for (const row of rows) {
      const metadata = row?.metadata || row?.card?.metadata || row?.packCard?.metadata || {};
      const attrs = Array.isArray(metadata?.attributes) ? metadata.attributes : [];
      const name = String(
        row?.name ||
          row?.title ||
          metadata?.name ||
          row?.card?.name ||
          row?.packCard?.name ||
          ""
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
        row?.id ||
          row?._id ||
          row?.tokenId ||
          row?.tokenID ||
          row?.mint ||
          row?.packCardId ||
          `${name}-${imagePath}`
      );
      if (!imagePath || !name || seen.has(uniqueKey)) {
        continue;
      }
      seen.add(uniqueKey);
      const subtitle = String(
        metadata?.collection ||
          metadata?.collectionName ||
          row?.collectionName ||
          row?.collection ||
          "aura collection"
      ).trim();
      const rarity = String(metadata?.rarity || row?.rarity || "").trim();
      const series = String(metadata?.series || row?.series || "beta").trim();
      const upperName = name.toUpperCase();
      const spriteFlag = AURA_SPRITE_NAMES.has(upperName);
      const attrLookup = (keys) => {
        const normalized = keys.map((k) => String(k).toLowerCase());
        const found = attrs.find((attr) =>
          normalized.includes(
            String(attr?.trait_type || attr?.traitType || attr?.key || "").toLowerCase()
          )
        );
        return found?.value ?? found?.display_value ?? "";
      };
      let spriteHints = null;
      if (spriteFlag) {
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

        const columns = Number.parseInt(String(explicitCols || ""), 10);
        const rows = Number.parseInt(String(explicitRows || ""), 10);
        const frameCount = Number.parseInt(String(explicitFrameCount || ""), 10);
        const fps = Number(explicitFps);

        spriteHints = parseSpriteHints({ columns, rows, frameCount, fps });
      }
      const detailsBits = [`Series ${series || "beta"}`];
      if (rarity) {
        detailsBits.push(`Rarity ${rarity}`);
      }
      detailsBits.push(`Weight ${getCapWeightMultiplier(imagePath).toFixed(2)}x`);
      mapped.push({
        number: mapped.length + 1,
        name: name,
        imagePath,
        subtitle: subtitle,
        details: detailsBits.join(" • "),
        spriteHints,
        isAuraSprite: spriteFlag,
      });
    }
    return mapped;
  };

  const loadAuraCollection = async () => {
    const session = auraSession || readStoredAuraSession();
    const lookupValue = pickAuraLookupValue(session);
    if (!lookupValue) {
      COLLECTIONS.aura.loading = false;
      COLLECTIONS.aura.items = [];
      if (!unmounted) {
        renderSwitcher();
        renderCards();
      }
      return;
    }
    try {
      const profileResponse = await fetch(
        `/api/aura-profile?username=${encodeURIComponent(lookupValue)}`
      );
      const profileJson = await profileResponse.json().catch(() => null);
      console.log("[AURA][COLLECTION] profile lookup response", {
        lookupValue,
        ok: profileResponse.ok,
        status: profileResponse.status,
        body: profileJson,
      });
      const profilePayload = profileJson?.data || profileJson;
      const profile =
        profilePayload?.user || profilePayload?.data || profilePayload || {};
      const userId = String(
        profile?.id || profile?._id || profile?.userId || ""
      ).trim();
      if (!profileResponse.ok || !userId) {
        COLLECTIONS.aura.loading = false;
        COLLECTIONS.aura.items = [];
        if (!unmounted) {
          renderSwitcher();
          renderCards();
        }
        return;
      }

      const inventoryResponse = await fetch(
        `/api/aura-inventory?userId=${encodeURIComponent(
          userId
        )}&condensed=true&ownedOnly=true&packType=all&limit=200&page=1`
      );
      const inventoryJson = await inventoryResponse.json().catch(() => null);
      console.log("[AURA][COLLECTION] GET USER INVENTORY raw", {
        ok: inventoryResponse.ok,
        status: inventoryResponse.status,
        userId,
        body: inventoryJson,
      });
      const inventoryPayload = inventoryJson?.data || inventoryJson;
      const items = extractInventoryItems(inventoryPayload).slice(0, 24);
      console.log(
        "[AURA][COLLECTION] mapped inventory items",
        items.map((item) => ({
          name: item.name,
          imagePath: item.imagePath,
          details: item.details,
          parsedWeight: Number(
            String(item.details || "").match(/Weight\\s+([0-9.]+)x/i)?.[1] || 0
          ),
        }))
      );
      COLLECTIONS.aura.loading = false;
      COLLECTIONS.aura.items = items;
      if (!unmounted) {
        renderSwitcher();
        renderCards();
      }
    } catch {
      COLLECTIONS.aura.loading = false;
      COLLECTIONS.aura.items = [];
      if (!unmounted) {
        renderSwitcher();
        renderCards();
      }
    }
  };

  renderSwitcher();
  renderCards();
  loadAuraCollection();

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
