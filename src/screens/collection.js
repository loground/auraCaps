import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DISC_HEIGHT, DISC_RADIUS } from "../game/constants.js";
import {
  createDiscMesh,
  loadDiscTexture,
} from "../game/discs.js";
import { getCapWeightMultiplier } from "../game/cap-physics.js";
import {
  buyVibeMarketPack,
  getVibeMarketState,
  openVibeMarketPack,
  sellVibeMarketCap,
  subscribeVibeMarketState,
} from "../vibe-market.js";

export function mountCollectionScreen({ app, onBack }) {
  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  const renderAttributes = (attributes, limit = Infinity) =>
    (attributes || [])
      .slice(0, limit)
      .map(
        (attribute) => `
          <span class="cap-attribute">
            <strong>${escapeHtml(attribute.traitType)}</strong>
            ${escapeHtml(attribute.value)}
          </span>`
      )
      .join("");
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
    vibe: {
      id: "vibe",
      label: "vibe.market",
      loading: getVibeMarketState().status === "loading",
      status: getVibeMarketState().status,
      error: getVibeMarketState().error,
      subcollections: {
        caps: {
          id: "caps",
          label: "caps",
          items: getVibeMarketState().items,
        },
        packs: {
          id: "packs",
          label: "unopened packs",
          items: getVibeMarketState().unopenedPacks,
        },
      },
    },
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

  let activeCollectionKey = "vibe";
  let activeSubKey = "caps";

  app.innerHTML = `
    <div class="collection-screen">
      <button id="backBtn" class="back-btn" type="button">back</button>
      <h2>Collection</h2>
      <div class="collection-switcher" id="collectionSwitcher" role="tablist" aria-label="Collection tabs"></div>
      <div class="collection-switcher collection-sub-switcher" id="collectionSubSwitcher" role="tablist" aria-label="Collection sub tabs"></div>
      <div class="collection-market-action" id="collectionMarketAction"></div>
      <div class="collection-grid" id="collectionGrid"></div>
      <div id="inspectorModal" class="inspector-modal hidden" aria-hidden="true">
        <div class="inspector-backdrop" id="inspectorBackdrop"></div>
        <div class="inspector-panel">
          <button id="inspectorClose" class="inspector-close" type="button">close</button>
          <div class="inspector-canvas-wrap" id="inspectorCanvasWrap"></div>
          <aside class="inspector-metadata" id="inspectorMetadata"></aside>
        </div>
      </div>
      <div id="packRevealModal" class="pack-reveal-modal hidden" aria-hidden="true">
        <div class="pack-reveal-backdrop"></div>
        <div class="pack-reveal-stage">
          <p class="pack-reveal-kicker">pack opened</p>
          <div class="pack-reveal-card">
            <div class="pack-reveal-glow"></div>
            <img id="packRevealImage" alt="" />
          </div>
          <h3 id="packRevealTitle">Your cap is revealed</h3>
          <p id="packRevealRarity"></p>
          <button id="packRevealClose" type="button">continue</button>
        </div>
      </div>
    </div>
  `;

  const grid = app.querySelector("#collectionGrid");
  const marketAction = app.querySelector("#collectionMarketAction");
  const modal = app.querySelector("#inspectorModal");
  const modalBackdrop = app.querySelector("#inspectorBackdrop");
  const modalClose = app.querySelector("#inspectorClose");
  const canvasWrap = app.querySelector("#inspectorCanvasWrap");
  const inspectorMetadata = app.querySelector("#inspectorMetadata");
  const revealModal = app.querySelector("#packRevealModal");
  const revealClose = app.querySelector("#packRevealClose");
  const revealImage = app.querySelector("#packRevealImage");
  const revealTitle = app.querySelector("#packRevealTitle");
  const revealRarity = app.querySelector("#packRevealRarity");

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
  let pendingSellTokenId = "";
  let openingPackTokenId = "";

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
    pendingSellTokenId = "";
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    disposeInspector();
  };

  const closeReveal = () => {
    revealModal.classList.add("hidden");
    revealModal.setAttribute("aria-hidden", "true");
  };

  const showReveal = ({ item, rarity, tokenId }) => {
    revealImage.src = item?.imagePath || getVibeMarketState().packInfo?.imagePath || "";
    revealImage.alt = item?.name || `Revealed cap #${tokenId}`;
    revealTitle.textContent = item?.name || `Cap #${tokenId}`;
    revealRarity.textContent = `${rarity} rarity`;
    revealModal.classList.remove("hidden");
    revealModal.setAttribute("aria-hidden", "false");
  };

  const openInspector = (item) => {
    pendingSellTokenId = "";
    disposeInspector();

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    inspectorMetadata.innerHTML = `
      <span class="inspector-kicker">${escapeHtml(item.subtitle)}</span>
      <h3>${escapeHtml(item.name)}</h3>
      ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
      ${
        item.attributes?.length
          ? `<div class="inspector-attributes">${renderAttributes(item.attributes)}</div>`
          : `<p>${escapeHtml(item.details)}</p>`
      }
      ${
        item.filterGroup === "vibe-market"
          ? `
            <div class="sell-cap-panel">
              <p class="sell-cap-offer">
                vibe.market offer:
                <strong>${escapeHtml(
                  item.offer?.formatted
                    ? `${item.offer.formatted} NR`
                    : "Check in wallet"
                )}</strong>
              </p>
              <button class="sell-cap-btn" type="button">sell this cap</button>
              <p class="sell-cap-status" aria-live="polite">
                Selling is irreversible and exchanges this cap for the displayed token offer.
              </p>
            </div>
          `
          : ""
      }
    `;
    const sellButton = inspectorMetadata.querySelector(".sell-cap-btn");
    const sellStatus = inspectorMetadata.querySelector(".sell-cap-status");
    sellButton?.addEventListener("click", async () => {
      if (pendingSellTokenId !== item.tokenId) {
        pendingSellTokenId = item.tokenId;
        sellButton.textContent = "confirm sell";
        sellButton.classList.add("confirming");
        sellStatus.textContent =
          "Click confirm sell to submit the irreversible transaction in your wallet.";
        return;
      }

      pendingSellTokenId = "";
      sellButton.disabled = true;
      sellButton.textContent = "selling...";
      sellStatus.classList.remove("error", "success");
      sellStatus.textContent = "Approve the transaction in your wallet.";
      try {
        await sellVibeMarketCap(item);
        sellStatus.classList.add("success");
        sellStatus.textContent = "Cap sold successfully. Your collection is refreshing.";
        window.setTimeout(closeInspector, 1200);
      } catch (error) {
        sellButton.disabled = false;
        sellButton.textContent = "sell this cap";
        sellButton.classList.remove("confirming");
        sellStatus.classList.add("error");
        sellStatus.textContent =
          error?.shortMessage || error?.message || "Could not sell this cap.";
      }
    });

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
    if (item.isSpriteCap) {
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
      frontTexture = loadDiscTexture(inspectorRenderer, item.imagePath, {
        centerCrop: Boolean(item.centerCrop),
      });
    }
    backTexture = loadDiscTexture(inspectorRenderer, "/caps/back1.png");
    backTexture.rotation = Math.PI * 0.5;
    spriteAnimState = item.isSpriteCap
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
        renderMarketAction();
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
        renderMarketAction();
        renderCards();
      });
      subSwitcher.appendChild(btn);
    });
  };

  const renderMarketAction = () => {
    marketAction.innerHTML = "";
    if (activeCollectionKey !== "vibe" || activeSubKey !== "packs") {
      return;
    }
    const vibeState = getVibeMarketState();
    const action = document.createElement("div");
    action.className = "buy-pack-panel";
    action.innerHTML = `
      <div>
        <span class="buy-pack-kicker">naughty robots booster</span>
        <strong>Buy a pack</strong>
        <p>Mint an unopened pack, then reveal it here.</p>
      </div>
      <div class="buy-pack-cta">
        <span>${escapeHtml(
          vibeState.packInfo?.mintPriceEth
            ? `${vibeState.packInfo.mintPriceEth} ETH`
            : "Price loads from contract"
        )}</span>
        <button class="buy-pack-btn" type="button">buy pack</button>
      </div>
      <p class="buy-pack-status" aria-live="polite"></p>
    `;
    const button = action.querySelector(".buy-pack-btn");
    const status = action.querySelector(".buy-pack-status");
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "buying...";
      status.textContent = "Approve the pack purchase in your wallet.";
      status.classList.remove("error", "success");
      try {
        await buyVibeMarketPack();
        status.classList.add("success");
        status.textContent = "Pack purchased. It is now ready to open.";
      } catch (error) {
        button.disabled = false;
        button.textContent = "buy pack";
        status.classList.add("error");
        status.textContent = error?.shortMessage || error?.message || "Could not buy this pack.";
      }
    });
    marketAction.appendChild(action);
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

    if (!active || !Array.isArray(active.items) || active.items.length === 0) {
      const isVibeCollection = topCollection.id === "vibe";
      const emptyTitle =
        isVibeCollection && topCollection.loading
          ? "Loading vibe.market collection"
          : isVibeCollection && topCollection.status === "error"
            ? "Could not load vibe.market collection"
            : isVibeCollection && activeSubKey === "packs"
              ? "no unopened packs"
              : isVibeCollection
              ? "no caps from vibe market found"
              : "No items";
      const emptyDetails =
        isVibeCollection && topCollection.status === "error"
          ? topCollection.error
          : isVibeCollection
            ? activeSubKey === "packs"
              ? "Buy a pack above to add it here."
              : "Connect a wallet on Base or try another wallet."
            : "this section is empty for now.";
      const card = document.createElement("div");
      card.className = "collection-card";
      card.innerHTML = `
      <div class="cap-slot">
        <div class="disc-card" aria-label="No items">
          <div class="cap-loading loaded">
            <span class="cap-loading-text">empty</span>
          </div>
        </div>
      </div>
      <div class="cap-info">
        <h3>${emptyTitle}</h3>
        <p>${topCollection.label}</p>
        <p>${emptyDetails}</p>
      </div>
    `;
      grid.appendChild(card);
      return;
    }

    active.items.forEach((item) => {
      const isPack = item.itemType === "unopened-pack";
      const card = document.createElement("div");
      card.className = `collection-card${isPack ? " unopened-pack-card" : ""}`;
      const cardAttributes = renderAttributes(item.attributes, 3);
      card.innerHTML = `
      <div class="cap-slot">
        <button class="disc-card" type="button" aria-label="Inspect ${escapeHtml(item.name)}">
          <div class="cap-loading">
            <span class="cap-loading-spinner" aria-hidden="true"></span>
            <span class="cap-loading-text">loading</span>
          </div>
          <img class="${item.centerCrop ? "center-crop" : ""}" src="${escapeHtml(item.imagePath)}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async" />
        </button>
      </div>
      <div class="cap-info">
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(item.subtitle)}</p>
        ${
          item.description
            ? `<p class="cap-description">${escapeHtml(item.description)}</p>`
            : `<p>${escapeHtml(item.details)}</p>`
        }
        ${cardAttributes ? `<div class="cap-attributes">${cardAttributes}</div>` : ""}
        <button class="inspect-btn" type="button">${isPack ? "open pack" : "inspect"}</button>
      </div>
    `;
      const onCardAction = async () => {
        if (!isPack) {
          openInspector(item);
          return;
        }
        if (openingPackTokenId) {
          return;
        }
        openingPackTokenId = item.tokenId;
        const openButton = card.querySelector(".inspect-btn");
        openButton.disabled = true;
        openButton.textContent = "revealing...";
        try {
          const revealed = await openVibeMarketPack(item);
          showReveal(revealed);
        } catch (error) {
          openButton.disabled = false;
          openButton.textContent = "open pack";
          window.alert(error?.shortMessage || error?.message || "Could not open this pack.");
        } finally {
          openingPackTokenId = "";
        }
      };
      card.querySelector(".disc-card").addEventListener("click", onCardAction);
      card.querySelector(".inspect-btn").addEventListener("click", onCardAction);

      const img = card.querySelector("img");
      const discBtn = card.querySelector(".disc-card");
      const loadingEl = card.querySelector(".cap-loading");
      if (item.isSpriteCap && img && discBtn) {
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
      if (img && !item.isSpriteCap) {
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

  renderSwitcher();
  renderSubSwitcher();
  renderMarketAction();
  renderCards();

  const unsubscribeVibeMarket = subscribeVibeMarketState((vibeState) => {
    const vibeCollection = COLLECTIONS.vibe;
    vibeCollection.loading = vibeState.status === "loading";
    vibeCollection.status = vibeState.status;
    vibeCollection.error = vibeState.error;
    vibeCollection.label = vibeState.collectionName || "vibe.market";
    vibeCollection.subcollections.caps.items = vibeState.items;
    vibeCollection.subcollections.packs.items = vibeState.unopenedPacks;
    if (!unmounted) {
      renderSwitcher();
      renderSubSwitcher();
      renderMarketAction();
      renderCards();
    }
  });

  const backBtn = app.querySelector("#backBtn");
  backBtn.addEventListener("click", onBack);
  modalClose.addEventListener("click", closeInspector);
  modalBackdrop.addEventListener("click", closeInspector);
  revealClose.addEventListener("click", closeReveal);

  return () => {
    stopPreviewSpriteAnimation();
    unsubscribeVibeMarket();
    previewSpriteNodes = [];
    unmounted = true;
    closeInspector();
    backBtn.removeEventListener("click", onBack);
    modalClose.removeEventListener("click", closeInspector);
    modalBackdrop.removeEventListener("click", closeInspector);
    revealClose.removeEventListener("click", closeReveal);
  };
}
