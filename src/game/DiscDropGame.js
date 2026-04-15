import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { ARENA_CONFIGS, DEFAULT_ARENA_KEY } from "./arena-configs.js";
import {
  DISC_HEIGHT,
  DISC_RADIUS,
  FIXED_STEP,
  LOWER_DISC_START_Y,
  TABLE_RADIUS,
} from "./constants.js";
import {
  createDiscMesh,
  loadDiscTexture,
  setDiscFaceTextures,
} from "./discs.js";
import { createRenderer, createWorldScene } from "./scene.js";
import { DEFAULT_SETTINGS, renderGameUI } from "./ui.js";

const ROUND_TIMEOUT_SECONDS = 8;
const OUT_OF_ARENA_RADIUS = TABLE_RADIUS + 1.1;
const HEIGHT_MIN = 2;
const HEIGHT_MAX = 8;

export class DiscDropGame {
  constructor(app, { theme = "hell", soundEnabled = true } = {}) {
    this.app = app;
    this.theme = theme;
    this.soundEnabled = soundEnabled;
    this.settings = { ...DEFAULT_SETTINGS };
    this.activeArenaKey = theme === "heaven" ? "classic" : DEFAULT_ARENA_KEY;

    this.hasLaunched = false;
    this.hasResolved = false;
    this.stableFrames = 0;
    this.roundElapsed = 0;
    this.accumulator = 0;

    this.lowerDiscBody = null;
    this.upperDiscBody = null;

    this.arenaObstacleBodies = [];
    this.arenaObstacleMeshes = [];
    this.arenaSurfaceBodies = [];
    this.arenaSurfaceColliders = [];
    this.useArenaMeshFloor = false;
    this.lavaUniforms = [];

    this.minLaunchClearance = LOWER_DISC_START_Y + DISC_HEIGHT * 2.4;

    this.clock = new THREE.Clock();
    this.running = false;
    this.rafId = null;
    this.handleResizeBound = () => this.handleResize();
    this.handleCanvasPointerDownBound = (event) =>
      this.handleCanvasPointerDown(event);
    this.handleWindowPointerMoveBound = (event) =>
      this.handleWindowPointerMove(event);
    this.handleWindowPointerUpBound = () => this.handleWindowPointerUp();
    this._wind = { x: 0, y: 0, z: 0 };
    this._tempQuat = new THREE.Quaternion();
    this._tempUp = new THREE.Vector3(0, 1, 0);
    this._tempForward = new THREE.Vector3();
    this._tempPickPoint = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._pointerNdc = new THREE.Vector2();
    this._pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -LOWER_DISC_START_Y);
    this.positionPickRadius = TABLE_RADIUS - 1.45;
    this.isDraggingPosition = false;
    this.isChargingPower = false;
    this.chargeDirection = 1;
    this.chargeValue = 0;
    this.throwSfxPaths = [
      "/sounds/throw.mp3",
      "/sounds/throw2.mp3",
      "/sounds/throw3.mp3",
      "/sounds/throw4.mp3",
      "/sounds/throw5.mp3",
    ];
    this.winSfxPaths = [
      "/sounds/win1.mp3",
      "/sounds/win2.mp3",
      "/sounds/win3.mp3",
    ];
    this.lastHitSfxAt = 0;
  }

  async init() {
    this.ui = renderGameUI(this.app);

    this.renderer = createRenderer(this.app);
    const worldView = createWorldScene(this.renderer, { theme: this.theme });
    this.scene = worldView.scene;
    this.camera = worldView.camera;
    this.controls = worldView.controls;
    this.floorMesh = worldView.floorMesh;
    this.tableMesh = worldView.tableMesh;
    this.floorMaterial = worldView.floorMaterial;
    this.tableMaterial = worldView.tableMaterial;
    this.skyUniforms = worldView.skyUniforms;
    this.skyBackdrop = worldView.skyBackdrop;

    await RAPIER.init();
    this.setupWorld();
    await this.setupArenaVisualModel();
    this.setupDiscs();
    this.setupArrow();
    this.setupPositionGizmo();
    this.setupUIBindings();
    this.renderer.domElement.addEventListener(
      "pointerdown",
      this.handleCanvasPointerDownBound
    );
    window.addEventListener("pointermove", this.handleWindowPointerMoveBound);
    window.addEventListener("pointerup", this.handleWindowPointerUpBound);

    this.applyArena(this.activeArenaKey);
    this.buildRoundBodies();
    this.applyResponsiveCamera();

    this.running = true;
    this.animate();
    this.hidePlayPreloader();
    window.addEventListener("resize", this.handleResizeBound);
  }

  hidePlayPreloader() {
    const preloader = this.ui?.playPreloaderEl;
    if (!preloader) {
      return;
    }
    requestAnimationFrame(() => {
      preloader.classList.add("hidden");
    });
  }

  setupWorld() {
    this.world = new RAPIER.World({ x: 0, y: -14, z: 0 });
    this.eventQueue = new RAPIER.EventQueue(true);
    this.world.maxCcdSubsteps = 8;
    this.world.integrationParameters.maxCcdSubsteps = 8;

    const floorBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.22, 0)
    );
    this.floorCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.22, TABLE_RADIUS)
        .setFriction(0.38)
        .setRestitution(0.55)
        .setContactSkin(0.008),
      floorBody
    );

    const catchFloorBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1.15, 0)
    );
    this.catchFloorCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(TABLE_RADIUS + 1, 1, TABLE_RADIUS + 1)
        .setFriction(0.55)
        .setRestitution(0.2)
        .setContactSkin(0.008),
      catchFloorBody
    );
  }

  setupArenaVisualModel() {
    if (this.theme === "heaven") {
      this.floorMesh.visible = true;
      this.tableMesh.visible = true;
      this.useArenaMeshFloor = false;
      this.floorCollider.setEnabled(true);
      return Promise.resolve();
    }

    this.floorMesh.visible = false;
    this.tableMesh.visible = false;

    this.arenaVisualRoot = new THREE.Group();
    this.scene.add(this.arenaVisualRoot);

    this.arenaDracoLoader = new DRACOLoader();
    this.arenaDracoLoader.setDecoderPath("/draco/");
    this.arenaKtx2Loader = new KTX2Loader();
    this.arenaKtx2Loader.setTranscoderPath("/basis/");
    this.arenaKtx2Loader.detectSupport(this.renderer);

    const loader = new GLTFLoader();
    loader.setDRACOLoader(this.arenaDracoLoader);
    loader.setKTX2Loader(this.arenaKtx2Loader);

    return new Promise((resolve) => {
      loader.load(
        "/3d/hellArena1.glb",
        (gltf) => {
          this.lavaUniforms.length = 0;
          const model = gltf.scene;
          model.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = false;
              child.receiveShadow = true;
              if (child.name === "Object_8") {
                child.material = this.createLavaMaterial();
              }
            }
          });

          const center = new THREE.Vector3();
          const sourceBox = new THREE.Box3().setFromObject(model);
          sourceBox.getCenter(center);
          model.position.sub(center);

          const scale = 10;

          this.arenaVisualRoot.clear();
          this.arenaVisualRoot.add(model);
          this.arenaVisualRoot.scale.setScalar(scale);
          this.arenaVisualRoot.position.set(0, -0.62, 0);
          this.createHellArenaSurfacePhysics();
          resolve();
        },
        undefined,
        () => {
          // Fallback to procedural visuals if model loading fails.
          this.floorMesh.visible = true;
          this.tableMesh.visible = true;
          this.useArenaMeshFloor = false;
          this.floorCollider.setEnabled(true);
          resolve();
        }
      );
    });
  }

  clearArenaSurfacePhysics() {
    while (this.arenaSurfaceBodies.length > 0) {
      this.world.removeRigidBody(this.arenaSurfaceBodies.pop());
    }
    this.arenaSurfaceColliders.length = 0;
  }

  createHellArenaSurfacePhysics() {
    this.clearArenaSurfacePhysics();
    if (!this.arenaVisualRoot) {
      this.useArenaMeshFloor = false;
      this.floorCollider.setEnabled(true);
      return;
    }

    this.arenaVisualRoot.updateMatrixWorld(true);

    const tempVec = new THREE.Vector3();
    this.arenaVisualRoot.traverse((child) => {
      if (!child.isMesh || !child.geometry?.attributes?.position) {
        return;
      }

      const positionAttr = child.geometry.attributes.position;
      const vertexCount = positionAttr.count;
      if (vertexCount < 3) {
        return;
      }

      const vertices = new Float32Array(vertexCount * 3);
      for (let i = 0; i < vertexCount; i += 1) {
        tempVec.fromBufferAttribute(positionAttr, i).applyMatrix4(child.matrixWorld);
        const offset = i * 3;
        vertices[offset] = tempVec.x;
        vertices[offset + 1] = tempVec.y;
        vertices[offset + 2] = tempVec.z;
      }

      let indices;
      if (child.geometry.index) {
        indices = new Uint32Array(child.geometry.index.array);
      } else {
        indices = new Uint32Array(vertexCount);
        for (let i = 0; i < vertexCount; i += 1) {
          indices[i] = i;
        }
      }

      if (indices.length < 3) {
        return;
      }

      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.trimesh(vertices, indices).setContactSkin(0.004),
        body
      );
      this.arenaSurfaceBodies.push(body);
      this.arenaSurfaceColliders.push(collider);
    });

    this.useArenaMeshFloor = this.arenaSurfaceColliders.length > 0;
    // Keep base floor enabled as a safety net against deep penetration.
    this.floorCollider.setEnabled(true);
  }

  createLavaMaterial() {
    const uniforms = {
      iTime: { value: 0 },
    };
    this.lavaUniforms.push(uniforms);

    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float iTime;
        varying vec2 vUv;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }

        void main() {
          vec2 uv = vUv * 3.2;
          float t = iTime * 0.18;
          float n1 = noise(uv + vec2(t, -t * 0.35));
          float n2 = noise(uv * 1.9 - vec2(t * 0.55, t * 0.15));
          float lava = smoothstep(0.35, 0.95, n1 * 0.65 + n2 * 0.35);

          vec3 deep = vec3(0.14, 0.02, 0.01);
          vec3 hot = vec3(1.0, 0.30, 0.04);
          vec3 bright = vec3(1.0, 0.82, 0.28);
          vec3 color = mix(deep, hot, lava);
          color = mix(color, bright, pow(lava, 3.0) * 0.65);

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
  }

  setupDiscs() {
    this.backFaceTextures = [
      loadDiscTexture(this.renderer, "/caps/back1.png"),
      loadDiscTexture(this.renderer, "/caps/back2.png"),
      loadDiscTexture(this.renderer, "/caps/back3.png"),
    ];
    this.capTextures = Array.from({ length: 9 }, (_, idx) =>
      loadDiscTexture(this.renderer, `/caps/${idx + 1}.png`)
    );

    this.lowerCapTexture = this.randomCapTexture();
    this.upperCapTexture = this.randomCapTexture();
    this.lowerBackTexture = this.randomBackTexture();
    this.upperBackTexture = this.randomBackTexture();

    this.lowerDiscMesh = createDiscMesh({
      radius: DISC_RADIUS,
      height: DISC_HEIGHT,
      sideColor: "#93a1b8",
      topFaceMap: this.lowerBackTexture,
      bottomFaceMap: this.lowerCapTexture,
    });
    this.scene.add(this.lowerDiscMesh);

    this.upperDiscMesh = createDiscMesh({
      radius: DISC_RADIUS,
      height: DISC_HEIGHT,
      sideColor: "#dfe7f5",
      topFaceMap: this.upperBackTexture,
      bottomFaceMap: this.upperCapTexture,
    });
    this.scene.add(this.upperDiscMesh);
  }

  randomCapTexture() {
    return this.capTextures[Math.floor(Math.random() * this.capTextures.length)];
  }

  randomBackTexture() {
    return this.backFaceTextures[
      Math.floor(Math.random() * this.backFaceTextures.length)
    ];
  }

  refreshDiscArt() {
    setDiscFaceTextures({
      mesh: this.lowerDiscMesh,
      topFaceMap: this.lowerBackTexture,
      bottomFaceMap: this.lowerCapTexture,
    });
    setDiscFaceTextures({
      mesh: this.upperDiscMesh,
      topFaceMap: this.upperBackTexture,
      bottomFaceMap: this.upperCapTexture,
    });
  }

  setupArrow() {
    this.launchArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, 0),
      2,
      0x60a5fa,
      0.7,
      0.45
    );
    this.scene.add(this.launchArrow);
  }

  setupPositionGizmo() {
    this.positionGizmo = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({
      color: "#ffe3a8",
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.42, 0.07, 16, 56),
      ringMat
    );
    ring.rotation.x = Math.PI * 0.5;
    ring.renderOrder = 999;
    this.positionGizmo.add(ring);

    const coreMat = new THREE.MeshBasicMaterial({
      color: "#ff9f66",
      depthTest: false,
      depthWrite: false,
    });
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 20, 20),
      coreMat
    );
    core.position.y = 0.04;
    core.renderOrder = 1000;
    this.positionGizmo.add(core);

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.16, 12),
      new THREE.MeshBasicMaterial({
        color: "#ffd9a3",
        depthTest: false,
        depthWrite: false,
      })
    );
    pole.position.y = 0.08;
    pole.renderOrder = 999;
    this.positionGizmo.add(pole);

    this.scene.add(this.positionGizmo);
    this.updatePositionGizmo();
  }

  setupUIBindings() {
    const arenaKeys =
      this.theme === "heaven" ? ["classic"] : Object.keys(ARENA_CONFIGS);
    for (const key of arenaKeys) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = ARENA_CONFIGS[key].label;
      this.ui.arenaSelectEl.appendChild(option);
    }
    this.ui.arenaSelectEl.value = this.activeArenaKey;
    this.ui.arenaSelectEl.disabled = this.theme === "heaven";

    this.ui.arenaSelectEl.addEventListener("change", (event) => {
      const nextArena = event.target.value;
      this.applyArena(nextArena);
      this.buildRoundBodies();
      this.setStatus("choose a position to hit");
    });

    const onHeightPointer = (event) => {
      const rect = this.ui.heightMeterEl.getBoundingClientRect();
      const y = THREE.MathUtils.clamp(event.clientY - rect.top, 0, rect.height);
      const ratioTopToBottom = y / rect.height;
      const ratioBottomToTop = 1 - ratioTopToBottom;
      this.settings.height = HEIGHT_MIN + (HEIGHT_MAX - HEIGHT_MIN) * ratioBottomToTop;
      this.updateHeightMeterUI();
      if (!this.hasLaunched && this.upperDiscBody) {
        this.upperDiscBody.setNextKinematicTranslation({
          x: this.settings.posX,
          y: this.safeLaunchHeight(),
          z: this.settings.posZ,
        });
        this.upperDiscBody.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
        this.updateLaunchArrow();
        this.updatePositionGizmo();
      }
    };
    let isDraggingHeight = false;
    this.ui.heightMeterEl.addEventListener("pointerdown", (event) => {
      isDraggingHeight = true;
      this.ui.heightMeterEl.setPointerCapture(event.pointerId);
      onHeightPointer(event);
    });
    this.ui.heightMeterEl.addEventListener("pointermove", (event) => {
      if (isDraggingHeight) {
        onHeightPointer(event);
      }
    });
    this.ui.heightMeterEl.addEventListener("pointerup", () => {
      isDraggingHeight = false;
    });
    this.ui.heightMeterEl.addEventListener("pointercancel", () => {
      isDraggingHeight = false;
    });
    this.updateHeightMeterUI();

    this.ui.launchBtn.addEventListener("click", () => {
      if (this.hasLaunched) {
        return;
      }
      if (this.isChargingPower) {
        this.commitPowerAndLaunch();
      } else {
        this.startPowerCharge();
      }
    });
    this.ui.resetBtn.addEventListener("click", () => this.buildRoundBodies());
  }

  safeLaunchHeight() {
    return Math.max(this.settings.height, this.minLaunchClearance);
  }

  setStatus(message) {
    this.ui.statusEl.textContent = message;
  }

  updatePowerMeterUI() {
    const value = THREE.MathUtils.clamp(this.chargeValue, 0, 100);
    this.ui.powerFillEl.style.height = `${value}%`;
    this.ui.powerMarkerEl.style.top = `calc(${value}% - 1px)`;
  }

  updateHeightMeterUI() {
    const ratio =
      (THREE.MathUtils.clamp(this.settings.height, HEIGHT_MIN, HEIGHT_MAX) - HEIGHT_MIN) /
      (HEIGHT_MAX - HEIGHT_MIN);
    const pct = ratio * 100;
    this.ui.heightFillEl.style.height = `${pct}%`;
    this.ui.heightMarkerEl.style.bottom = `calc(${pct}% - 1px)`;
    this.ui.heightValueEl.textContent = this.settings.height.toFixed(1);
  }

  startPowerCharge() {
    this.isChargingPower = true;
    this.chargeDirection = 1;
    this.chargeValue = 0;
    this.ui.launchBtn.textContent = "Hit";
    this.updatePowerMeterUI();
    this.setStatus("set power and hit");
  }

  commitPowerAndLaunch() {
    this.isChargingPower = false;
    this.settings.power = THREE.MathUtils.clamp(this.chargeValue, 3, 100);
    this.ui.actionButtonsEl.classList.add("show-reset");
    this.launchRound();
  }

  clearArenaObstacles() {
    while (this.arenaObstacleBodies.length > 0) {
      this.world.removeRigidBody(this.arenaObstacleBodies.pop());
    }
    while (this.arenaObstacleMeshes.length > 0) {
      this.scene.remove(this.arenaObstacleMeshes.pop());
    }
  }

  spawnObstacle(def) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(def.x, def.y, def.z)
    );

    let colliderDesc;
    let mesh;

    if (def.type === "cyl") {
      colliderDesc = RAPIER.ColliderDesc.cylinder(def.hh, def.r);
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(def.r, def.r, def.hh * 2, 32),
        new THREE.MeshStandardMaterial({
          color: def.color,
          roughness: 0.58,
          metalness: 0.18,
        })
      );
    } else {
      colliderDesc = RAPIER.ColliderDesc.cuboid(def.hx, def.hy, def.hz);
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(def.hx * 2, def.hy * 2, def.hz * 2),
        new THREE.MeshStandardMaterial({
          color: def.color,
          roughness: 0.6,
          metalness: 0.14,
        })
      );
    }

    this.world.createCollider(
      colliderDesc.setFriction(def.friction).setRestitution(def.restitution),
      body
    );

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(def.x, def.y, def.z);
    this.scene.add(mesh);

    this.arenaObstacleBodies.push(body);
    this.arenaObstacleMeshes.push(mesh);
  }

  applyArena(key) {
    this.activeArenaKey = this.theme === "heaven" ? "classic" : key;
    const arena = ARENA_CONFIGS[this.activeArenaKey];

    this.world.gravity = { x: 0, y: arena.gravity, z: 0 };
    this.floorCollider.setFriction(arena.floorFriction);
    this.floorCollider.setRestitution(arena.floorRestitution);
    this.catchFloorCollider.setFriction(Math.max(0.25, arena.floorFriction));
    this.catchFloorCollider.setRestitution(0.22);

    if (this.useArenaMeshFloor && this.arenaSurfaceColliders.length > 0) {
      for (const collider of this.arenaSurfaceColliders) {
        collider.setFriction(arena.floorFriction);
        collider.setRestitution(arena.floorRestitution);
      }
    }

    this.ui.arenaHintEl.textContent = arena.hint;
    this.ui.arenaTagEl.textContent = arena.label;

    if (this.theme === "heaven") {
      this.floorMaterial.color.set("#d8ebfb");
      this.tableMaterial.color.set("#bfdcf4");
    } else {
      this.floorMaterial.color.set(
        key === "bumperGarden" ? "#2c2a5d" : "#263049"
      );
      this.tableMaterial.color.set(
        "#111827"
      );
    }

    this.clearArenaObstacles();
    for (const def of arena.obstacles) {
      this.spawnObstacle(def);
    }
  }

  buildRoundBodies() {
    const arena = ARENA_CONFIGS[this.activeArenaKey];

    if (this.lowerDiscBody) {
      this.world.removeRigidBody(this.lowerDiscBody);
    }
    if (this.upperDiscBody) {
      this.world.removeRigidBody(this.upperDiscBody);
    }

    this.lowerDiscBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, LOWER_DISC_START_Y, 0)
    );
    this.lowerDiscBody.setLinearDamping(0.015);
    this.lowerDiscBody.setAngularDamping(0.0016);
    this.lowerDiscBody.setAdditionalSolverIterations(8);
    this.lowerDiscBody.enableCcd(true);
    this.lowerDiscBody.setSoftCcdPrediction(0.3);
    this.lowerDiscCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(DISC_HEIGHT * 0.5, DISC_RADIUS)
        .setFriction(arena.lowerFriction)
        .setRestitution(arena.lowerRestitution)
        .setDensity(arena.lowerDensity)
        .setContactSkin(0.003)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.lowerDiscBody
    );

    this.upperDiscBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        this.settings.posX,
        this.settings.height,
        this.settings.posZ
      )
    );
    this.upperDiscCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(DISC_HEIGHT * 0.5, DISC_RADIUS)
        .setFriction(arena.upperFriction)
        .setRestitution(arena.upperRestitution)
        .setDensity(arena.upperDensity)
        .setContactSkin(0.003)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.upperDiscBody
    );
    this.upperDiscBody.setLinearDamping(0.06);
    this.upperDiscBody.setAngularDamping(0.03);
    this.upperDiscBody.setAdditionalSolverIterations(8);
    this.upperDiscBody.enableCcd(true);
    this.upperDiscBody.setSoftCcdPrediction(0.3);

    this.hasLaunched = false;
    this.hasResolved = false;
    this.stableFrames = 0;
    this.roundElapsed = 0;
    this.isChargingPower = false;
    this.chargeValue = 0;
    this.ui.launchBtn.disabled = false;
    this.ui.launchBtn.textContent = "Power";
    this.ui.actionButtonsEl.classList.remove("show-reset");
    this.updateHeightMeterUI();
    this.updatePowerMeterUI();
    this.setStatus("choose a position to hit");
    this.updateLaunchArrow();
    this.updatePositionGizmo();
    this.updateMiniMap();
  }

  playSfx(path, volume = 0.8) {
    if (!this.soundEnabled) {
      return;
    }
    try {
      const audio = new Audio(path);
      audio.volume = volume;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
    } catch {
      // Ignore playback errors.
    }
  }

  playRandomThrowSfx() {
    const randomPath =
      this.throwSfxPaths[Math.floor(Math.random() * this.throwSfxPaths.length)];
    this.playSfx(randomPath, 0.88);
  }

  playRandomWinSfx() {
    const randomPath =
      this.winSfxPaths[Math.floor(Math.random() * this.winSfxPaths.length)];
    this.playSfx(randomPath, 0.9);
  }

  getLowerTargetPosition() {
    if (!this.lowerDiscBody) {
      return { x: 0, y: LOWER_DISC_START_Y, z: 0 };
    }
    return this.lowerDiscBody.translation();
  }

  updateLaunchArrow() {
    const launchY = this.safeLaunchHeight();
    const lowerPos = this.getLowerTargetPosition();

    const toLower = new THREE.Vector3(
      lowerPos.x - this.settings.posX,
      lowerPos.y - launchY,
      lowerPos.z - this.settings.posZ
    );
    const fullLength = Math.max(0.3, toLower.length());

    if (toLower.lengthSq() < 0.000001) {
      toLower.set(0, -1, 0);
    } else {
      toLower.normalize();
    }

    this.launchArrow.position.set(this.settings.posX, launchY, this.settings.posZ);
    this.launchArrow.setDirection(toLower);
    const headLength = THREE.MathUtils.clamp(fullLength * 0.2, 0.14, 0.55);
    const headWidth = THREE.MathUtils.clamp(fullLength * 0.1, 0.08, 0.35);
    this.launchArrow.setLength(fullLength, headLength, headWidth);
    this.launchArrow.visible = !this.hasLaunched;
  }

  updatePositionGizmo() {
    if (!this.positionGizmo) {
      return;
    }
    this.positionGizmo.position.set(
      this.settings.posX,
      this.safeLaunchHeight() + 0.03,
      this.settings.posZ
    );
    this.positionGizmo.visible = !this.hasLaunched;
  }

  updateMiniMap() {
    if (!this.ui?.miniMapEl || !this.ui.miniLowerDotEl || !this.ui.miniUpperDotEl) {
      return;
    }

    const size = this.ui.miniMapEl.clientWidth || 128;
    const half = size * 0.5;
    const radius = Math.max(TABLE_RADIUS, 0.001);
    const mapScale = half * 0.88;

    const mapToUi = (x, z) => {
      const nx = THREE.MathUtils.clamp(x / radius, -1, 1);
      const nz = THREE.MathUtils.clamp(z / radius, -1, 1);
      return {
        x: half + nx * mapScale,
        y: half + nz * mapScale,
      };
    };

    const lowerPos = this.lowerDiscBody
      ? this.lowerDiscBody.translation()
      : { x: 0, z: 0 };
    const upperPos =
      this.upperDiscBody && this.hasLaunched
        ? this.upperDiscBody.translation()
        : { x: this.settings.posX, z: this.settings.posZ };

    const lowerUi = mapToUi(lowerPos.x, lowerPos.z);
    const upperUi = mapToUi(upperPos.x, upperPos.z);
    this.ui.miniLowerDotEl.style.left = `${lowerUi.x}px`;
    this.ui.miniLowerDotEl.style.top = `${lowerUi.y}px`;
    this.ui.miniUpperDotEl.style.left = `${upperUi.x}px`;
    this.ui.miniUpperDotEl.style.top = `${upperUi.y}px`;
  }

  handleCanvasPointerDown(event) {
    if (
      event.button !== 0 ||
      this.hasLaunched ||
      this.isChargingPower ||
      !this.positionGizmo
    ) {
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._pointerNdc, this.camera);
    const dragTargets = [...this.positionGizmo.children];
    if (this.upperDiscMesh) {
      dragTargets.push(this.upperDiscMesh);
    }
    const hits = this._raycaster.intersectObjects(dragTargets, false);
    if (hits.length === 0) {
      return;
    }

    this.isDraggingPosition = true;
    this.controls.enabled = false;
    this.updateDragPosition(event);
  }

  updateDragPosition(event) {
    this._pickPlane.constant = -this.safeLaunchHeight();
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._pointerNdc, this.camera);
    const picked = this._raycaster.ray.intersectPlane(
      this._pickPlane,
      this._tempPickPoint
    );
    if (!picked) {
      return;
    }

    let x = picked.x;
    let z = picked.z;
    const radius = Math.hypot(x, z);
    if (radius > this.positionPickRadius) {
      const s = this.positionPickRadius / radius;
      x *= s;
      z *= s;
    }

    this.settings.posX = x;
    this.settings.posZ = z;
    if (!this.hasLaunched && this.upperDiscBody) {
      this.upperDiscBody.setNextKinematicTranslation({
        x: this.settings.posX,
        y: this.safeLaunchHeight(),
        z: this.settings.posZ,
      });
      this.upperDiscBody.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
    }
    this.updateLaunchArrow();
    this.updatePositionGizmo();
    this.updateMiniMap();
  }

  handleWindowPointerMove(event) {
    if (!this.isDraggingPosition) {
      return;
    }
    this.updateDragPosition(event);
  }

  handleWindowPointerUp() {
    if (!this.isDraggingPosition) {
      return;
    }
    this.isDraggingPosition = false;
    this.controls.enabled = true;
  }

  launchRound() {
    if (this.hasLaunched || !this.upperDiscBody) {
      return;
    }

    this.hasLaunched = true;
    this.hasResolved = false;
    this.stableFrames = 0;
    this.roundElapsed = 0;
    this.ui.launchBtn.disabled = true;
    this.ui.launchBtn.textContent = "Hit";
    this.updateLaunchArrow();
    this.updatePositionGizmo();
    this.updateMiniMap();

    const launchY = this.safeLaunchHeight();

    this.upperDiscBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.upperDiscBody.enableCcd(true);
    this.upperDiscBody.setTranslation(
      { x: this.settings.posX, y: launchY, z: this.settings.posZ },
      true
    );
    this.upperDiscBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.upperDiscBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.upperDiscBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

    const lowerPos = this.getLowerTargetPosition();
    const toLower = new THREE.Vector3(
      lowerPos.x - this.settings.posX,
      0,
      lowerPos.z - this.settings.posZ
    );

    if (toLower.lengthSq() < 0.0001) {
      toLower.set(0, 0, 1);
    } else {
      toLower.normalize();
    }

    const power01 = this.settings.power / 100;
    const direction = new THREE.Vector3(toLower.x, 0, toLower.z).normalize();

    const horizontalSpeed = 2 + power01 * 13;
    const downwardSpeed = 12 + power01 * 40;
    this.upperDiscBody.setLinvel(
      {
        x: direction.x * horizontalSpeed,
        y: -downwardSpeed,
        z: direction.z * horizontalSpeed,
      },
      true
    );

    const impulseScale = 1.08;
    this.upperDiscBody.applyImpulseAtPoint(
      {
        x: toLower.x * this.settings.power * impulseScale,
        y: -this.settings.power * 1.5,
        z: toLower.z * this.settings.power * impulseScale,
      },
      {
        x: this.settings.posX,
        y: launchY,
        z: this.settings.posZ,
      },
      true
    );

    this.playRandomThrowSfx();
    this.setStatus("in motion");
  }

  topFaceColor(body) {
    const rotation = body.rotation();
    this._tempQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this._tempUp.set(0, 1, 0).applyQuaternion(this._tempQuat);
    return this._tempUp.y >= 0 ? "red" : "green";
  }

  resolveRound() {
    if (!this.upperDiscBody || !this.lowerDiscBody) {
      return;
    }

    this.hasResolved = true;
    this.ui.launchBtn.disabled = true;
    this.ui.launchBtn.textContent = "Power";
    if (
      this.isOutOfArena(this.upperDiscBody) ||
      this.isOutOfArena(this.lowerDiscBody)
    ) {
      this.setStatus("you lost");
      return;
    }

    const upperColor = this.topFaceColor(this.upperDiscBody);
    const lowerColor = this.topFaceColor(this.lowerDiscBody);
    const greens = Number(upperColor === "green") + Number(lowerColor === "green");

    if (greens === 2) {
      this.setStatus("you won");
      this.playRandomWinSfx();
      return;
    }

    if (greens === 0) {
      this.setStatus("you lost");
      return;
    }

    this.setStatus("tie");
  }

  isOutOfArena(body) {
    const pos = body.translation();
    return Math.hypot(pos.x, pos.z) > OUT_OF_ARENA_RADIUS;
  }

  hasSettled(body) {
    const lin = body.linvel();
    const ang = body.angvel();
    const linearSq = lin.x * lin.x + lin.y * lin.y + lin.z * lin.z;
    const angularSq = ang.x * ang.x + ang.y * ang.y + ang.z * ang.z;
    return linearSq < 0.03 && angularSq < 0.08;
  }

  currentWind(time, out) {
    const wind = ARENA_CONFIGS[this.activeArenaKey].wind;
    const oscillation = Math.sin(time * wind.freq) * wind.pulse;
    out.x = wind.x + oscillation;
    out.y = 0;
    out.z = wind.z + Math.cos(time * wind.freq * 0.7) * wind.pulse * 0.45;
    return out;
  }

  applyWind(body, wind) {
    if (!body) {
      return;
    }

    body.applyImpulse(
      {
        x: wind.x * FIXED_STEP * 0.65,
        y: 0,
        z: wind.z * FIXED_STEP * 0.65,
      },
      true
    );
  }

  syncMesh(body, mesh) {
    const position = body.translation();
    const rotation = body.rotation();
    mesh.position.set(position.x, position.y, position.z);
    mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  isDiscCollisionPair(handleA, handleB) {
    if (!this.upperDiscCollider || !this.lowerDiscCollider) {
      return false;
    }
    const upper = this.upperDiscCollider.handle;
    const lower = this.lowerDiscCollider.handle;
    return (
      (handleA === upper && handleB === lower) ||
      (handleA === lower && handleB === upper)
    );
  }

  consumeCollisionSfxEvents() {
    if (!this.eventQueue) {
      return;
    }
    this.eventQueue.drainCollisionEvents((handleA, handleB, started) => {
      if (!started || !this.isDiscCollisionPair(handleA, handleB)) {
        return;
      }
      const now = performance.now();
      if (now - this.lastHitSfxAt < 80) {
        return;
      }
      this.lastHitSfxAt = now;
      this.playSfx("/sounds/hit.mp3", 0.82);
    });
  }

  stepPhysics() {
    if (!this.hasLaunched && this.upperDiscBody) {
      this.upperDiscBody.setNextKinematicTranslation({
        x: this.settings.posX,
        y: this.safeLaunchHeight(),
        z: this.settings.posZ,
      });
      this.upperDiscBody.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
    }

    if (this.hasLaunched) {
      this.roundElapsed += FIXED_STEP;
      this.currentWind(this.clock.elapsedTime, this._wind);
      this.applyWind(this.upperDiscBody, this._wind);
      this.applyWind(this.lowerDiscBody, this._wind);
    }

    this.world.timestep = FIXED_STEP;
    this.world.step(this.eventQueue);
    this.consumeCollisionSfxEvents();

    if (
      this.hasLaunched &&
      !this.hasResolved &&
      this.upperDiscBody &&
      this.lowerDiscBody
    ) {
      if (this.hasSettled(this.upperDiscBody) && this.hasSettled(this.lowerDiscBody)) {
        this.stableFrames += 1;
        if (this.stableFrames > 35) {
          this.resolveRound();
        }
      } else {
        this.stableFrames = 0;
      }

      if (
        this.isOutOfArena(this.upperDiscBody) ||
        this.isOutOfArena(this.lowerDiscBody)
      ) {
        this.resolveRound();
      }

      if (this.roundElapsed >= ROUND_TIMEOUT_SECONDS) {
        this.resolveRound();
      }
    }
  }

  animate() {
    if (!this.running) {
      return;
    }
    this.rafId = requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    if (this.isChargingPower) {
      this.chargeValue += this.chargeDirection * delta * 120;
      if (this.chargeValue >= 100) {
        this.chargeValue = 100;
        this.chargeDirection = -1;
      } else if (this.chargeValue <= 0) {
        this.chargeValue = 0;
        this.chargeDirection = 1;
      }
      this.updatePowerMeterUI();
    }
    this.accumulator = Math.min(this.accumulator + delta, 0.25);

    while (this.accumulator >= FIXED_STEP) {
      this.stepPhysics();
      this.accumulator -= FIXED_STEP;
    }

    if (this.upperDiscBody) {
      this.syncMesh(this.upperDiscBody, this.upperDiscMesh);
    }
    if (this.lowerDiscBody) {
      this.syncMesh(this.lowerDiscBody, this.lowerDiscMesh);
    }
    this.updateMiniMap();

    this.controls.update();

    if (this.skyBackdrop) {
      this.camera.getWorldDirection(this._tempForward);
      this.skyBackdrop.quaternion.copy(this.camera.quaternion);
      this.skyBackdrop.position
        .copy(this.camera.position)
        .addScaledVector(this._tempForward, 120);
    }

    this.renderer.render(this.scene, this.camera);
    if (this.skyUniforms) {
      this.skyUniforms.iTime.value += delta;
    }
    for (const uniforms of this.lavaUniforms) {
      uniforms.iTime.value += delta;
    }
  }

  applyResponsiveCamera() {
    if (window.innerWidth <= 760) {
      this.camera.position.set(0, 19.2, 31.5);
      this.controls.target.set(0, 0.45, 0);
    } else {
      this.camera.position.set(0, 13.3, 24.6);
      this.controls.target.set(0, 0.35, 0);
    }
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.applyResponsiveCamera();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  destroy() {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    window.removeEventListener("resize", this.handleResizeBound);
    window.removeEventListener("pointermove", this.handleWindowPointerMoveBound);
    window.removeEventListener("pointerup", this.handleWindowPointerUpBound);
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this.handleCanvasPointerDownBound
    );
    this.controls.dispose();
    if (this.arenaVisualRoot) {
      this.scene.remove(this.arenaVisualRoot);
      this.arenaVisualRoot = null;
    }
    if (this.arenaDracoLoader) {
      this.arenaDracoLoader.dispose();
      this.arenaDracoLoader = null;
    }
    if (this.arenaKtx2Loader) {
      this.arenaKtx2Loader.dispose();
      this.arenaKtx2Loader = null;
    }
    this.lavaUniforms.length = 0;
    this.clearArenaSurfacePhysics();
    this.clearArenaObstacles();
    this.renderer.dispose();
  }
}
