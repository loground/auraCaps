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
  sellVibeMarketPack,
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
  const formatEth = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount.toFixed(6) : "";
  };
  const formatNr = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount)
      ? amount.toLocaleString(undefined, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })
      : "";
  };
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
          label: "packs",
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
      <button id="backBtn" class="back-btn" type="button">Back</button>
      <h2>Collection</h2>
      <div class="collection-switcher" id="collectionSwitcher" role="tablist" aria-label="Collection tabs"></div>
      <div class="collection-switcher collection-sub-switcher" id="collectionSubSwitcher" role="tablist" aria-label="Collection sub tabs"></div>
      <div class="collection-token-balance" id="collectionTokenBalance"></div>
      <div class="collection-market-action" id="collectionMarketAction"></div>
      <div class="collection-grid" id="collectionGrid"></div>
      <div id="inspectorModal" class="inspector-modal hidden" aria-hidden="true">
        <div class="inspector-backdrop" id="inspectorBackdrop"></div>
        <div class="inspector-panel">
          <button id="inspectorClose" class="inspector-close" type="button">Close</button>
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
          <button id="packRevealClose" type="button">Continue</button>
        </div>
      </div>
    </div>
  `;

  const grid = app.querySelector("#collectionGrid");
  const marketAction = app.querySelector("#collectionMarketAction");
  const tokenBalance = app.querySelector("#collectionTokenBalance");
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
    revealModal.classList.remove("is-revealing", "has-error");
    revealClose.disabled = false;
    revealClose.textContent = "Continue";
    revealImage.src = item?.imagePath || "";
    revealImage.alt = item?.name || `Revealed cap #${tokenId}`;
    revealTitle.textContent = item?.name || `Cap #${tokenId}`;
    revealRarity.textContent = `${rarity} rarity`;
    revealModal.classList.remove("hidden");
    revealModal.setAttribute("aria-hidden", "false");
  };

  const showRevealProgress = (item) => {
    revealModal.classList.add("is-revealing");
    revealModal.classList.remove("has-error");
    revealImage.src = item.imagePath;
    revealImage.alt = item.name;
    revealTitle.textContent = "Revealing your cap";
    revealRarity.textContent = "Waiting for onchain randomness and artwork";
    revealClose.disabled = true;
    revealClose.textContent = "Revealing...";
    revealModal.classList.remove("hidden");
    revealModal.setAttribute("aria-hidden", "false");
  };

  const openPack = async (item, button, status = null) => {
    if (openingPackTokenId) {
      return;
    }
    openingPackTokenId = item.tokenId;
    button.disabled = true;
    button.textContent = "Revealing...";
    closeInspector();
    showRevealProgress(item);
    if (status) {
      status.textContent = "Approve the opening transaction, then wait for the reveal.";
      status.classList.remove("error");
    }
    try {
      const revealed = await openVibeMarketPack(item);
      showReveal(revealed);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Open Pack";
      revealModal.classList.remove("is-revealing");
      revealModal.classList.add("has-error");
      revealTitle.textContent = "Reveal is still processing";
      revealRarity.textContent =
        error?.shortMessage || error?.message || "Could not open this pack.";
      revealClose.disabled = false;
      revealClose.textContent = "Continue";
      if (status) {
        status.classList.add("error");
        status.textContent =
          error?.shortMessage || error?.message || "Could not open this pack.";
      } else {
        window.alert(error?.shortMessage || error?.message || "Could not open this pack.");
      }
    } finally {
      openingPackTokenId = "";
    }
  };

  const sellPack = async (item, currency, button, status = null) => {
    const sellKey = `${item.tokenId}:${currency}`;
    if (pendingSellTokenId !== sellKey) {
      pendingSellTokenId = sellKey;
      button.textContent = "Confirm Sell Pack";
      button.classList.add("confirming");
      if (status) {
        status.textContent = `Selling for ${currency.toUpperCase()} is irreversible. Click again to confirm.`;
      }
      return;
    }
    pendingSellTokenId = "";
    button.disabled = true;
    button.textContent = "Selling...";
    try {
      await sellVibeMarketPack(item, currency);
      closeInspector();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Sell Pack";
      button.classList.remove("confirming");
      if (status) {
        status.classList.add("error");
        status.textContent = error?.shortMessage || error?.message || "Could not sell this pack.";
      } else {
        window.alert(error?.shortMessage || error?.message || "Could not sell this pack.");
      }
    }
  };

  const openInspector = (item) => {
    const isPack = item.itemType === "unopened-pack";
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
        isPack
          ? `
            <div class="open-pack-panel">
              <p>
                Token ID: <strong>#${escapeHtml(item.tokenId)}</strong><br />
                Opening fee:
                <strong>${escapeHtml(
                  getVibeMarketState().packInfo?.entropyFeeEth
                    ? `${getVibeMarketState().packInfo.entropyFeeEth} ETH`
                    : "Loaded from contract"
                )}</strong>
              </p>
              <label class="pack-currency-field">
                Receive
                <select class="sell-pack-currency">
                  <option value="nr">${escapeHtml(
                    getVibeMarketState().packInfo?.tokensPerMintFormatted
                      ? `${formatNr(getVibeMarketState().packInfo.tokensPerMintFormatted)} NR`
                      : "NR"
                  )}</option>
                  <option value="eth">${escapeHtml(
                    getVibeMarketState().packInfo?.sellPriceEthFormatted
                      ? `${formatEth(getVibeMarketState().packInfo.sellPriceEthFormatted)} ETH`
                      : "ETH"
                  )}</option>
                </select>
              </label>
              <button class="open-pack-btn" type="button">Open Pack</button>
              <button class="sell-pack-btn" type="button">Sell Pack</button>
              <p class="open-pack-status" aria-live="polite">
                Open to reveal a cap, or sell the unopened pack back to vibe.market.
              </p>
            </div>
          `
          : item.filterGroup === "vibe-market"
          ? `
            <div class="sell-cap-panel">
              <p class="sell-cap-offer">
                vibe.market offer:
                <strong>${escapeHtml(
                  item.offer?.formatted
                    ? `${formatNr(item.offer.formatted)} NR`
                    : "Check in wallet"
                )}</strong>
              </p>
              <label class="pack-currency-field">
                Receive
                <select class="sell-cap-currency">
                  <option value="nr">${escapeHtml(
                    item.offer?.formatted ? `${formatNr(item.offer.formatted)} NR` : "NR"
                  )}</option>
                  <option value="eth">${escapeHtml(
                    item.offer?.ethFormatted
                      ? `${formatEth(item.offer.ethFormatted)} ETH`
                      : "ETH"
                  )}</option>
                </select>
              </label>
              <button class="sell-cap-btn" type="button">Sell This Cap</button>
              <p class="sell-cap-status" aria-live="polite">
                Selling is irreversible and exchanges this cap for the displayed token offer.
              </p>
            </div>
          `
          : ""
      }
    `;
    const openButton = inspectorMetadata.querySelector(".open-pack-btn");
    const sellPackButton = inspectorMetadata.querySelector(".sell-pack-btn");
    const sellPackCurrency = inspectorMetadata.querySelector(".sell-pack-currency");
    const openStatus = inspectorMetadata.querySelector(".open-pack-status");
    openButton?.addEventListener("click", () => openPack(item, openButton, openStatus));
    sellPackButton?.addEventListener("click", () =>
      sellPack(item, sellPackCurrency?.value || "nr", sellPackButton, openStatus)
    );
    const sellButton = inspectorMetadata.querySelector(".sell-cap-btn");
    const sellCurrency = inspectorMetadata.querySelector(".sell-cap-currency");
    const sellStatus = inspectorMetadata.querySelector(".sell-cap-status");
    sellButton?.addEventListener("click", async () => {
      const currency = sellCurrency?.value || "nr";
      const sellKey = `${item.tokenId}:${currency}`;
      if (pendingSellTokenId !== sellKey) {
        pendingSellTokenId = sellKey;
        sellButton.textContent = "Confirm Sell";
        sellButton.classList.add("confirming");
        sellStatus.textContent =
          `Click Confirm Sell to exchange this cap for ${currency.toUpperCase()}.`;
        return;
      }

      pendingSellTokenId = "";
      sellButton.disabled = true;
      sellButton.textContent = "Selling...";
      sellStatus.classList.remove("error", "success");
      sellStatus.textContent = "Approve the transaction in your wallet.";
      try {
        const minEthPayout =
          currency === "eth" && item.offer?.ethQuote
            ? (item.offer.ethQuote * 95n) / 100n
            : 0n;
        await sellVibeMarketCap(item, currency, minEthPayout);
        sellStatus.classList.add("success");
        sellStatus.textContent = "Cap sold successfully. Your collection is refreshing.";
        window.setTimeout(closeInspector, 1200);
      } catch (error) {
        sellButton.disabled = false;
        sellButton.textContent = "Sell This Cap";
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
    if (isPack) {
      inspectorControls.minAzimuthAngle = -Math.PI / 4;
      inspectorControls.maxAzimuthAngle = Math.PI / 4;
      inspectorControls.minPolarAngle = Math.PI / 4;
      inspectorControls.maxPolarAngle = (Math.PI * 3) / 4;
    }

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
    if (isPack) {
      frontTexture = loadDiscTexture(inspectorRenderer, item.imagePath, {
        centerCrop: false,
      });
    } else if (item.isSpriteCap) {
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
    if (!isPack) {
      backTexture = loadDiscTexture(inspectorRenderer, "/caps/back1.png");
      backTexture.rotation = Math.PI * 0.5;
    }
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
    if (isPack) {
      const packMaterial = new THREE.MeshBasicMaterial({
        map: frontTexture,
        transparent: true,
        alphaTest: 0.02,
        side: THREE.DoubleSide,
      });
      inspectorDisc = new THREE.Mesh(
        new THREE.PlaneGeometry(2.45, 3.25),
        packMaterial
      );
    } else {
      frontTexture.rotation = Math.PI * 0.5;
      inspectorDisc = createDiscMesh({
        radius: DISC_RADIUS * 1.06,
        height: DISC_HEIGHT * 0.65,
        sideColor: "#b8bfd4",
        topFaceMap: frontTexture,
        bottomFaceMap: backTexture,
      });
      inspectorDisc.rotation.x = Math.PI * 0.5;
    }
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
      if (!isPack) {
        inspectorDisc.rotation.z += 0.0025;
      }
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
        renderTokenBalance();
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
      btn.textContent = "Loading";
      btn.disabled = true;
      subSwitcher.appendChild(btn);
      return;
    }

    if (subcollectionEntries.length === 0) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "collection-tab active";
      btn.textContent = "Empty";
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
        renderTokenBalance();
        renderCards();
      });
      subSwitcher.appendChild(btn);
    });
  };

  const renderMarketAction = () => {
    marketAction.innerHTML = "";
  };

  const renderTokenBalance = () => {
    const vibeState = getVibeMarketState();
    tokenBalance.textContent =
      activeCollectionKey === "vibe" && vibeState.walletAddress
        ? vibeState.tokenBalance === null
          ? "NR balance: Loading..."
          : `NR balance: ${formatNr(vibeState.tokenBalanceFormatted)} NR`
        : "";
  };

  const renderPackShopCard = () => {
    const vibeState = getVibeMarketState();
    const card = document.createElement("div");
    card.className = "collection-card pack-shop-card";
    card.innerHTML = `
      <div class="pack-shop-visual">
        ${
          vibeState.packInfo?.imagePath
            ? `<img src="${escapeHtml(vibeState.packInfo.imagePath)}" alt="Naughty Robots booster pack" />`
            : '<div class="cap-loading"><span class="cap-loading-spinner"></span></div>'
        }
      </div>
      <div class="cap-info">
        <span class="pack-shop-name">Naughty Robots</span>
        <p>Mint an unopened pack, then reveal it here.</p>
        <label class="pack-currency-field">
          Pay with
          <select class="buy-pack-currency">
            <option value="eth">${escapeHtml(
              vibeState.packInfo?.mintPriceEth
                ? `${formatEth(vibeState.packInfo.mintPriceEth)} ETH`
                : "ETH"
            )}</option>
            <option value="nr">${escapeHtml(
              vibeState.packInfo?.tokensPerMintFormatted
                ? `${formatNr(vibeState.packInfo.tokensPerMintFormatted)} NR`
                : "NR"
            )}</option>
          </select>
        </label>
        <button class="buy-pack-btn" type="button">Buy Pack</button>
        <p class="buy-pack-status" aria-live="polite"></p>
      </div>
    `;
    const button = card.querySelector(".buy-pack-btn");
    const currency = card.querySelector(".buy-pack-currency");
    const status = card.querySelector(".buy-pack-status");
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Buying...";
      status.textContent = `Confirm the ${currency.value.toUpperCase()} pack purchase in your wallet.`;
      status.classList.remove("error", "success");
      try {
        await buyVibeMarketPack(currency.value);
        status.classList.add("success");
        status.textContent = "Pack purchased. It is now ready to open.";
      } catch (error) {
        button.disabled = false;
        button.textContent = "Buy Pack";
        status.classList.add("error");
        status.textContent = error?.shortMessage || error?.message || "Could not buy this pack.";
      }
    });
    const image = card.querySelector("img");
    if (image) {
      image.addEventListener("load", () => image.classList.add("loaded"), { once: true });
      if (image.complete) {
        image.classList.add("loaded");
      }
    }
    grid.appendChild(card);
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
    const isPackCollection = topCollection.id === "vibe" && activeSubKey === "packs";
    if (isPackCollection) {
      renderPackShopCard();
    }

    if (!active || !Array.isArray(active.items) || active.items.length === 0) {
      const isVibeCollection = topCollection.id === "vibe";
      if (isVibeCollection && topCollection.loading) {
        const card = document.createElement("div");
        card.className = "collection-card collection-loading-card";
        card.innerHTML = `
          <div class="cap-slot">
            <div class="disc-card" aria-label="Loading vibe.market collection">
              <div class="cap-loading">
                <span class="cap-loading-spinner" aria-hidden="true"></span>
                <span class="cap-loading-text">loading</span>
              </div>
            </div>
          </div>
          <div class="cap-info">
            <h3>Loading vibe.market collection</h3>
            <p>Fetching your caps and packs from Base.</p>
          </div>
        `;
        grid.appendChild(card);
        return;
      }
      if (isPackCollection) {
        return;
      }
      const emptyTitle =
        isVibeCollection && topCollection.status === "error"
            ? "Could not load vibe.market collection"
            : isVibeCollection
              ? "no caps from vibe market found"
              : "No items";
      const emptyDetails =
        isVibeCollection && topCollection.status === "error"
          ? topCollection.error
          : isVibeCollection
            ? "Connect a wallet on Base or try another wallet."
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
        <div class="collection-card-actions">
          <button class="inspect-btn" type="button">${isPack ? "Open Pack" : "Inspect"}</button>
          ${isPack ? '<button class="sell-pack-card-btn" type="button">Sell Pack</button>' : ""}
        </div>
        ${
          isPack
            ? `<label class="pack-currency-field compact">
                Receive
                <select class="sell-pack-card-currency">
                  <option value="nr">${escapeHtml(
                    getVibeMarketState().packInfo?.tokensPerMintFormatted
                      ? `${formatNr(getVibeMarketState().packInfo.tokensPerMintFormatted)} NR`
                      : "NR"
                  )}</option>
                  <option value="eth">${escapeHtml(
                    getVibeMarketState().packInfo?.sellPriceEthFormatted
                      ? `${formatEth(getVibeMarketState().packInfo.sellPriceEthFormatted)} ETH`
                      : "ETH"
                  )}</option>
                </select>
              </label>`
            : ""
        }
      </div>
    `;
      card.querySelector(".disc-card").addEventListener("click", () => openInspector(item));
      const actionButton = card.querySelector(".inspect-btn");
      actionButton.addEventListener("click", () => {
        if (isPack) {
          openPack(item, actionButton);
        } else {
          openInspector(item);
        }
      });
      const sellPackCardButton = card.querySelector(".sell-pack-card-btn");
      const sellPackCardCurrency = card.querySelector(".sell-pack-card-currency");
      sellPackCardButton?.addEventListener("click", () =>
        sellPack(item, sellPackCardCurrency?.value || "nr", sellPackCardButton)
      );

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
  renderTokenBalance();
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
      renderTokenBalance();
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
