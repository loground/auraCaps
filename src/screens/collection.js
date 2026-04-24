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
  let spriteSourceTexture = null;
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
    if (spriteSourceTexture) {
      spriteSourceTexture.dispose();
      spriteSourceTexture = null;
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
      const t = performance.now() * 0.001;
      for (const node of previewSpriteNodes) {
        const img = node?.img;
        if (!img || !img.isConnected) {
          continue;
        }
        const frame = Math.floor(t * node.fps) % node.frameCount;
        const col = frame % node.cols;
        const row = Math.floor(frame / node.cols);
        const tx = -(col * (100 / node.cols));
        const ty = -(row * (100 / node.rows));
        img.style.transform = `translate(${tx}%, ${ty}%)`;
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

    frontTexture = loadDiscTexture(inspectorRenderer, item.imagePath);
    backTexture = loadDiscTexture(inspectorRenderer, "/caps/back1.png");
    backTexture.rotation = Math.PI * 0.5;

    const toInt = (value, fallback) => {
      const parsed = Number.parseInt(String(value ?? ""), 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    const toNum = (value, fallback) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    const configureSpriteAnimation = (texture, config) => {
      if (!texture || !config) {
        return null;
      }
      const cols = toInt(config.columns, 1);
      const rows = toInt(config.rows, 1);
      const frameCount = Math.max(1, toInt(config.frameCount, cols * rows));
      const fps = toNum(config.fps, 8);
      if (cols * rows <= 1 || frameCount <= 1) {
        return null;
      }
      const sourceImage = texture.image || null;
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return null;
      }
      const spriteTexture = new THREE.CanvasTexture(canvas);
      spriteTexture.colorSpace = THREE.SRGBColorSpace;
      spriteTexture.center.set(0.5, 0.5);
      spriteTexture.rotation = Math.PI * 0.5;
      spriteTexture.anisotropy = inspectorRenderer.capabilities.getMaxAnisotropy();
      spriteTexture.needsUpdate = true;
      spriteSourceTexture = texture;
      frontTexture = spriteTexture;
      return {
        texture: spriteTexture,
        canvas,
        ctx,
        sourceImage,
        cols,
        rows,
        frameCount,
        fps,
        initialized: false,
      };
    };

    spriteAnimState = configureSpriteAnimation(frontTexture, item.spriteConfig || null);
    if (!spriteAnimState) {
      frontTexture.rotation = Math.PI * 0.5;
    }

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
        const frame = Math.floor(performance.now() * 0.001 * spriteAnimState.fps) % spriteAnimState.frameCount;
        const col = frame % spriteAnimState.cols;
        const row = Math.floor(frame / spriteAnimState.cols);
        const img = spriteAnimState.sourceImage;
        if (img && img.width > 0 && img.height > 0) {
          const frameWidth = Math.floor(img.width / spriteAnimState.cols);
          const frameHeight = Math.floor(img.height / spriteAnimState.rows);
          if (frameWidth > 0 && frameHeight > 0) {
            if (
              !spriteAnimState.initialized ||
              spriteAnimState.canvas.width !== frameWidth ||
              spriteAnimState.canvas.height !== frameHeight
            ) {
              spriteAnimState.canvas.width = frameWidth;
              spriteAnimState.canvas.height = frameHeight;
              spriteAnimState.initialized = true;
            }
            const sx = col * frameWidth;
            const sy = row * frameHeight;
            spriteAnimState.ctx.clearRect(
              0,
              0,
              spriteAnimState.canvas.width,
              spriteAnimState.canvas.height
            );
            spriteAnimState.ctx.drawImage(
              img,
              sx,
              sy,
              frameWidth,
              frameHeight,
              0,
              0,
              spriteAnimState.canvas.width,
              spriteAnimState.canvas.height
            );
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
      const loadingEl = card.querySelector(".cap-loading");
      if (img && item.spriteConfig) {
        const cols = Math.max(1, Number.parseInt(String(item.spriteConfig.columns || 1), 10));
        const rows = Math.max(1, Number.parseInt(String(item.spriteConfig.rows || 1), 10));
        const frameCount = Math.max(
          1,
          Number.parseInt(String(item.spriteConfig.frameCount || cols * rows), 10)
        );
        const fps = Math.max(1, Number(item.spriteConfig.fps || 8));
        img.classList.add("sprite-sheet");
        img.style.width = `${cols * 100}%`;
        img.style.height = `${rows * 100}%`;
        img.style.transform = "translate(0%, 0%)";
        previewSpriteNodes.push({ img, cols, rows, frameCount, fps });
      }
      const markLoaded = () => {
        loadingEl?.classList.add("loaded");
        img?.classList.add("loaded");
      };
      if (img) {
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
      const spriteFlag =
        AURA_SPRITE_NAMES.has(upperName) ||
        Boolean(metadata?.sprite || metadata?.isSprite || row?.isSprite);
      const attrLookup = (keys) => {
        const normalized = keys.map((k) => String(k).toLowerCase());
        const found = attrs.find((attr) =>
          normalized.includes(
            String(attr?.trait_type || attr?.traitType || attr?.key || "").toLowerCase()
          )
        );
        return found?.value ?? found?.display_value ?? "";
      };
      let spriteConfig = null;
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

        const fallbackColumns = 4;
        const fallbackRows = 1;
        const fallbackFrames = 4;

        spriteConfig = {
          columns: Number.isFinite(columns) && columns > 0 ? columns : fallbackColumns,
          rows: Number.isFinite(rows) && rows > 0 ? rows : fallbackRows,
          frameCount:
            Number.isFinite(frameCount) && frameCount > 1
              ? frameCount
              : fallbackFrames,
          fps: Number.isFinite(fps) && fps > 0 ? fps : 8,
        };
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
        spriteConfig,
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
