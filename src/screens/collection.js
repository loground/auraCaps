import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DISC_HEIGHT, DISC_RADIUS } from "../game/constants.js";
import { createDiscMesh, loadDiscTexture } from "../game/discs.js";
import { getCapWeightMultiplier } from "../game/cap-physics.js";

export function mountCollectionScreen({ app, onBack, auraSession = null }) {
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
  let rafId = null;
  let resizeObserver = null;
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
    frontTexture.rotation = Math.PI * 0.5;
    backTexture.rotation = Math.PI * 0.5;
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
    unmounted = true;
    closeInspector();
    backBtn.removeEventListener("click", onBack);
    modalClose.removeEventListener("click", closeInspector);
    modalBackdrop.removeEventListener("click", closeInspector);
  };
}
