import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DISC_HEIGHT, DISC_RADIUS } from "../game/constants.js";
import { createDiscMesh, loadDiscTexture } from "../game/discs.js";

export function mountCollectionScreen({ app, onBack }) {
  app.innerHTML = `
    <div class="collection-screen">
      <button id="backBtn" class="back-btn" type="button">back</button>
      <h2>Collection</h2>
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

  const openInspector = (capNumber) => {
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

    frontTexture = loadDiscTexture(inspectorRenderer, `/caps/${capNumber}.webp`);
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

  for (let i = 0; i < 9; i += 1) {
    const capNumber = i + 1;
    const card = document.createElement("div");
    card.className = "collection-card";
    const randomSeries = 100 + capNumber * 17;
    const randomTier = ["Relic", "Myth", "Echo", "Prime", "Burn"][i % 5];
    card.innerHTML = `
      <div class="cap-slot">
        <button class="disc-card" type="button" aria-label="Inspect Aura cap ${capNumber}">
          <img src="/caps/${capNumber}.webp" alt="Aura cap ${capNumber}" />
        </button>
      </div>
      <div class="cap-info">
        <h3>Powerful cap N${capNumber}</h3>
        <p>collection INK&apos;s old (f)arts</p>
        <p>Series ${randomSeries} • Tier ${randomTier} • Core Flux ${(1.2 + i * 0.3).toFixed(1)}</p>
        <button class="inspect-btn" type="button">inspect</button>
      </div>
    `;
    card.querySelector(".disc-card").addEventListener("click", () => {
      openInspector(capNumber);
    });
    card.querySelector(".inspect-btn").addEventListener("click", () => {
      openInspector(capNumber);
    });
    grid.appendChild(card);
  }

  const backBtn = app.querySelector("#backBtn");
  backBtn.addEventListener("click", onBack);
  modalClose.addEventListener("click", closeInspector);
  modalBackdrop.addEventListener("click", closeInspector);

  return () => {
    closeInspector();
    backBtn.removeEventListener("click", onBack);
    modalClose.removeEventListener("click", closeInspector);
    modalBackdrop.removeEventListener("click", closeInspector);
  };
}
