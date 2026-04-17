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
  FLOOR_RADIUS,
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
const OUT_OF_ARENA_RADIUS_OFFSET = 1.1;
const HEIGHT_MIN = 2;
const HEIGHT_MAX = 8;
const SLAMMER_HEIGHT_MULT = 2.64;
const SLAMMER_DENSITY_MULT = 2.45;

export class DiscDropGame {
  constructor(
    app,
    {
      theme = "hell",
      soundEnabled = true,
      isSoundEnabled = null,
      initialArenaKey = DEFAULT_ARENA_KEY,
      gameMode = "classic",
    } = {}
  ) {
    this.app = app;
    this.theme = theme;
    this.soundEnabled = soundEnabled;
    this.isSoundEnabled = typeof isSoundEnabled === "function" ? isSoundEnabled : null;
    this.gameMode = gameMode === "slammer" ? "slammer" : "classic";
    this.settings = { ...DEFAULT_SETTINGS };
    this.activeArenaKey =
      theme === "heaven" || theme === "jungle-bay"
        ? "classic"
        : initialArenaKey || DEFAULT_ARENA_KEY;
    this.arenaRadius = this.gameMode === "slammer" ? TABLE_RADIUS + 12.5 : TABLE_RADIUS;
    this.floorRadius =
      this.gameMode === "slammer"
        ? this.arenaRadius + 8.5
        : Math.max(this.arenaRadius, FLOOR_RADIUS);

    this.hasLaunched = false;
    this.hasResolved = false;
    this.stableFrames = 0;
    this.roundElapsed = 0;
    this.accumulator = 0;

    this.lowerDiscBody = null;
    this.floorDiscBodies = [];
    this.floorDiscColliders = [];
    this.floorDiscMeshes = [];
    this.floorCapTextures = [];
    this.floorBackTextures = [];
    this.upperDiscBody = null;

    this.arenaObstacleBodies = [];
    this.arenaObstacleMeshes = [];
    this.arenaSurfaceBodies = [];
    this.arenaSurfaceColliders = [];
    this.useArenaMeshFloor = false;
    this.lavaUniforms = [];

    this.minLaunchClearance =
      this.gameMode === "slammer"
        ? LOWER_DISC_START_Y + DISC_HEIGHT * 8.3
        : LOWER_DISC_START_Y + DISC_HEIGHT * 2.4;

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
    this.positionPickRadius = this.arenaRadius - 1.45;
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
    this.slammerMiniDots = [];
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
      RAPIER.ColliderDesc.cylinder(0.22, this.floorRadius)
        .setFriction(0.38)
        .setRestitution(0.55)
        .setContactSkin(0.001),
      floorBody
    );

    const catchFloorBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1.15, 0)
    );
    this.catchFloorCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(this.floorRadius + 1, 1, this.floorRadius + 1)
        .setFriction(0.55)
        .setRestitution(0.2)
        .setContactSkin(0.001),
      catchFloorBody
    );
  }

  setupArenaVisualModel() {
    const usesProceduralArena = this.theme === "heaven" || this.gameMode === "slammer";
    if (usesProceduralArena) {
      this.floorMesh.visible = true;
      this.tableMesh.visible = true;
      if (this.gameMode === "slammer") {
        this.floorMesh.scale.setScalar(this.floorRadius / FLOOR_RADIUS);
        this.tableMesh.scale.setScalar(this.arenaRadius / TABLE_RADIUS);
      } else {
        this.floorMesh.scale.setScalar(1);
        this.tableMesh.scale.setScalar(1);
      }
      this.useArenaMeshFloor = false;
      this.floorCollider.setEnabled(true);
      return Promise.resolve();
    }

    const arenaModelPath =
      this.theme === "jungle-bay" ? "/3d/jbArena.glb" : "/3d/hellArena1.glb";

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
        arenaModelPath,
        (gltf) => {
          this.lavaUniforms.length = 0;
          const model = gltf.scene;
          model.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = false;
              child.receiveShadow = false;
              if (this.theme === "hell" && child.name === "Object_8") {
                child.material = this.createLavaMaterial();
              }
              if (this.theme === "jungle-bay") {
                const seaName = String(child.name || "").toLowerCase();
                if (
                  seaName === "sphere001_sea_0" ||
                  seaName.startsWith("sphere001_sea_0.")
                ) {
                  child.material = this.createWaterMaterial();
                }
              }
            }
          });

          const center = new THREE.Vector3();
          const size = new THREE.Vector3();
          const sourceBox = new THREE.Box3().setFromObject(model);
          sourceBox.getCenter(center);
          sourceBox.getSize(size);
          model.position.sub(center);

          const scale =
            this.theme === "jungle-bay"
              ? ((this.arenaRadius * 2) / Math.max(size.x, size.z, 0.001)) * 5
              : 10;

          this.arenaVisualRoot.clear();
          this.arenaVisualRoot.add(model);
          this.arenaVisualRoot.scale.setScalar(scale);
          this.arenaVisualRoot.position.set(
            10,
            this.theme === "jungle-bay" ? -15 : -0.62,
            -5
          );
          this.createArenaSurfacePhysics();
          resolve();
        },
        undefined,
        () => {
          console.warn(`Failed to load arena model: ${arenaModelPath}`);
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

  createArenaSurfacePhysics() {
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
        RAPIER.ColliderDesc.trimesh(vertices, indices).setContactSkin(0.0015),
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

  createWaterMaterial() {
    const uniforms = {
      iTime: { value: 0 },
    };
    this.lavaUniforms.push(uniforms);

    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float iTime;
        varying vec2 vUv;
        varying vec3 vWorldPos;

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

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.55;
          for (int i = 0; i < 4; i++) {
            v += a * noise(p);
            p *= 2.0;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec2 uv = vUv * 6.5;
          float t = iTime * 0.14;

          float waveA = fbm(uv + vec2(t * 0.9, -t * 0.35));
          float waveB = fbm(uv * 1.7 - vec2(t * 0.4, t * 0.75));
          float wave = waveA * 0.58 + waveB * 0.42;

          float e = 0.03;
          float waveX = fbm((uv + vec2(e, 0.0)) + vec2(t * 0.9, -t * 0.35)) * 0.58
                      + fbm((uv + vec2(e, 0.0)) * 1.7 - vec2(t * 0.4, t * 0.75)) * 0.42;
          float waveY = fbm((uv + vec2(0.0, e)) + vec2(t * 0.9, -t * 0.35)) * 0.58
                      + fbm((uv + vec2(0.0, e)) * 1.7 - vec2(t * 0.4, t * 0.75)) * 0.42;
          vec3 n = normalize(vec3((wave - waveX) * 1.8, (wave - waveY) * 1.8, 1.0));

          vec3 deep = vec3(0.01, 0.16, 0.28);
          vec3 mid = vec3(0.05, 0.36, 0.55);
          vec3 shallow = vec3(0.14, 0.62, 0.75);
          vec3 foam = vec3(0.78, 0.93, 0.96);

          vec3 color = mix(deep, mid, smoothstep(0.18, 0.62, wave));
          color = mix(color, shallow, smoothstep(0.52, 0.9, wave));

          float crest = smoothstep(0.78, 1.0, wave);
          color = mix(color, foam, crest * 0.45);

          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 2.4);
          color += vec3(0.16, 0.30, 0.34) * fresnel * 0.45;

          vec3 lightDir = normalize(vec3(0.4, 0.8, 0.35));
          float spec = pow(max(dot(reflect(-lightDir, n), viewDir), 0.0), 28.0);
          color += vec3(1.0, 0.97, 0.85) * spec * 0.28;

          gl_FragColor = vec4(color, 0.94);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
  }

  setupDiscs() {
    this.slammerBackTextures = [
      loadDiscTexture(this.renderer, "/caps/slammer1.png"),
      loadDiscTexture(this.renderer, "/caps/slammer2.png"),
      loadDiscTexture(this.renderer, "/caps/slammer3.png"),
    ];
    this.mainBackTexture =
      this.slammerBackTextures[
        Math.floor(Math.random() * this.slammerBackTextures.length)
      ];
    this.backFaceTextures = [
      loadDiscTexture(this.renderer, "/caps/back1.png"),
      loadDiscTexture(this.renderer, "/caps/back2.png"),
      loadDiscTexture(this.renderer, "/caps/back3.png"),
    ];
    this.capTextures = Array.from({ length: 9 }, (_, idx) =>
      loadDiscTexture(this.renderer, `/caps/${idx + 1}.webp`)
    );

    this.lowerCapTexture = this.randomCapTexture();
    this.upperCapTexture = this.randomCapTexture();
    this.lowerBackTexture = this.randomBackTexture();
    this.upperBackTexture =
      this.gameMode === "slammer" ? this.mainBackTexture : this.randomBackTexture();
    if (this.gameMode === "slammer") {
      this.upperCapTexture = this.upperBackTexture;
    }

    if (this.gameMode === "slammer") {
      this.floorCapTextures = Array.from({ length: 6 }, () => this.randomCapTexture());
      this.floorBackTextures = Array.from({ length: 6 }, () => this.randomBackTexture());
      this.floorDiscMeshes = this.floorCapTextures.map((capTex, idx) => {
        const mesh = createDiscMesh({
          radius: DISC_RADIUS,
          height: DISC_HEIGHT,
          sideColor: "#a9b3c8",
          topFaceMap: this.floorBackTextures[idx],
          bottomFaceMap: capTex,
        });
        this.scene.add(mesh);
        return mesh;
      });
      this.lowerDiscMesh = this.floorDiscMeshes[0];

      this.upperDiscMesh = createDiscMesh({
        radius: DISC_RADIUS,
        height: DISC_HEIGHT * SLAMMER_HEIGHT_MULT,
        sideColor: "#dfe7f5",
        topFaceMap: this.upperBackTexture,
        bottomFaceMap: this.upperCapTexture,
      });
      this.scene.add(this.upperDiscMesh);
      return;
    }

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
    if (this.gameMode === "slammer") {
      this.floorDiscMeshes.forEach((mesh, idx) => {
        setDiscFaceTextures({
          mesh,
          topFaceMap: this.floorBackTextures[idx],
          bottomFaceMap: this.floorCapTextures[idx],
        });
      });
      setDiscFaceTextures({
        mesh: this.upperDiscMesh,
        topFaceMap: this.upperBackTexture,
        bottomFaceMap: this.upperCapTexture,
      });
      return;
    }

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
      this.theme === "heaven" || this.theme === "jungle-bay"
        ? ["classic"]
        : Object.keys(ARENA_CONFIGS);
    for (const key of arenaKeys) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = ARENA_CONFIGS[key].label;
      this.ui.arenaSelectEl.appendChild(option);
    }
    this.ui.arenaSelectEl.value = this.activeArenaKey;
    this.ui.arenaSelectEl.disabled =
      this.theme === "heaven" || this.theme === "jungle-bay";

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

    mesh.position.set(def.x, def.y, def.z);
    this.scene.add(mesh);

    this.arenaObstacleBodies.push(body);
    this.arenaObstacleMeshes.push(mesh);
  }

  applyArena(key) {
    this.activeArenaKey =
      this.theme === "heaven" || this.theme === "jungle-bay" ? "classic" : key;
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

    this.ui.arenaHintEl.textContent =
      this.gameMode === "slammer"
        ? `${arena.hint} Slammer: flip 4+ floor caps face up to win.`
        : arena.hint;
    this.ui.arenaTagEl.textContent = arena.label;

    if (this.theme === "heaven") {
      this.floorMaterial.color.set("#d8ebfb");
      this.tableMaterial.color.set("#bfdcf4");
    } else if (this.theme === "jungle-bay") {
      this.floorMaterial.color.set("#d4e6ba");
      this.tableMaterial.color.set("#8cb07a");
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

    for (const body of this.floorDiscBodies) {
      this.world.removeRigidBody(body);
    }
    this.floorDiscBodies.length = 0;
    this.floorDiscColliders.length = 0;
    this.lowerDiscBody = null;

    if (this.upperDiscBody) {
      this.world.removeRigidBody(this.upperDiscBody);
    }
    this.upperDiscBody = null;
    this.upperDiscCollider = null;
    this.lowerDiscCollider = null;

    if (this.gameMode === "slammer") {
      const slammerDiscHeight = DISC_HEIGHT * SLAMMER_HEIGHT_MULT;
      const stackCount = 6;
      const stackStep = DISC_HEIGHT + 0.012;
      for (let i = 0; i < stackCount; i += 1) {
        const offsetX = (i % 2 === 0 ? 1 : -1) * 0.018;
        const offsetZ = (i % 3 - 1) * 0.014;
        const y = LOWER_DISC_START_Y + i * stackStep;
        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic().setTranslation(offsetX, y, offsetZ)
        );
        body.setLinearDamping(0.02);
        body.setAngularDamping(0.0017);
        body.setAdditionalSolverIterations(10);
        body.enableCcd(true);
        body.setSoftCcdPrediction(0.32);
        const collider = this.world.createCollider(
          RAPIER.ColliderDesc.cylinder(DISC_HEIGHT * 0.5, DISC_RADIUS)
            .setFriction(arena.lowerFriction)
            .setRestitution(arena.lowerRestitution)
            .setDensity(arena.lowerDensity * 1.08)
            .setContactSkin(0.0008)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
          body
        );
        this.floorDiscBodies.push(body);
        this.floorDiscColliders.push(collider);
      }
      this.lowerDiscBody = this.floorDiscBodies[0] ?? null;
      this.lowerDiscCollider = this.floorDiscColliders[0] ?? null;

      this.upperDiscBody = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
          this.settings.posX,
          this.settings.height,
          this.settings.posZ
        )
      );
      this.upperDiscCollider = this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(slammerDiscHeight * 0.5, DISC_RADIUS)
          .setFriction(arena.upperFriction)
          .setRestitution(arena.upperRestitution)
          .setDensity(arena.upperDensity * SLAMMER_DENSITY_MULT)
          .setContactSkin(0.0008)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        this.upperDiscBody
      );
      this.upperDiscBody.setLinearDamping(0.055);
      this.upperDiscBody.setAngularDamping(0.03);
      this.upperDiscBody.setAdditionalSolverIterations(10);
      this.upperDiscBody.enableCcd(true);
      this.upperDiscBody.setSoftCcdPrediction(0.34);
      this.minLaunchClearance = LOWER_DISC_START_Y + stackCount * stackStep + 0.75;
    } else {
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
          .setContactSkin(0.0008)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        this.lowerDiscBody
      );
      this.floorDiscBodies.push(this.lowerDiscBody);
      this.floorDiscColliders.push(this.lowerDiscCollider);

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
          .setContactSkin(0.0008)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        this.upperDiscBody
      );
      this.upperDiscBody.setLinearDamping(0.06);
      this.upperDiscBody.setAngularDamping(0.03);
      this.upperDiscBody.setAdditionalSolverIterations(8);
      this.upperDiscBody.enableCcd(true);
      this.upperDiscBody.setSoftCcdPrediction(0.3);
      this.minLaunchClearance = LOWER_DISC_START_Y + DISC_HEIGHT * 2.4;
    }

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
    if (this.isSoundEnabled && !this.isSoundEnabled()) {
      return;
    }
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
    if (this.gameMode === "slammer" && this.floorDiscBodies.length > 0) {
      let sx = 0;
      let sy = -Infinity;
      let sz = 0;
      for (const body of this.floorDiscBodies) {
        const p = body.translation();
        sx += p.x;
        sy = Math.max(sy, p.y);
        sz += p.z;
      }
      const n = this.floorDiscBodies.length;
      return { x: sx / n, y: sy, z: sz / n };
    }

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
    const radius = Math.max(this.arenaRadius, 0.001);
    const mapScale = half * 0.88;

    const mapToUi = (x, z) => {
      const nx = THREE.MathUtils.clamp(x / radius, -1, 1);
      const nz = THREE.MathUtils.clamp(z / radius, -1, 1);
      return {
        x: half + nx * mapScale,
        y: half + nz * mapScale,
      };
    };

    let lowerPos = { x: 0, z: 0 };
    if (this.gameMode === "slammer" && this.floorDiscBodies.length > 0) {
      let sx = 0;
      let sz = 0;
      for (const body of this.floorDiscBodies) {
        const p = body.translation();
        sx += p.x;
        sz += p.z;
      }
      const n = this.floorDiscBodies.length;
      lowerPos = { x: sx / n, z: sz / n };
    } else if (this.lowerDiscBody) {
      lowerPos = this.lowerDiscBody.translation();
    }
    const upperPos =
      this.upperDiscBody && this.hasLaunched
        ? this.upperDiscBody.translation()
        : { x: this.settings.posX, z: this.settings.posZ };

    const lowerUi = mapToUi(lowerPos.x, lowerPos.z);
    const upperUi = mapToUi(upperPos.x, upperPos.z);
    if (this.gameMode === "slammer") {
      this.ui.miniLowerDotEl.style.display = "none";
      if (this.ui.miniLowerLabelEl) {
        this.ui.miniLowerLabelEl.style.display = "none";
      }

      while (this.slammerMiniDots.length < this.floorDiscBodies.length) {
        const dot = document.createElement("div");
        dot.className = "mini-dot stack";
        this.ui.miniMapEl.appendChild(dot);
        this.slammerMiniDots.push(dot);
      }
      while (this.slammerMiniDots.length > this.floorDiscBodies.length) {
        const dot = this.slammerMiniDots.pop();
        dot?.remove();
      }
      for (let i = 0; i < this.floorDiscBodies.length; i += 1) {
        const p = this.floorDiscBodies[i].translation();
        const ui = mapToUi(p.x, p.z);
        this.slammerMiniDots[i].style.left = `${ui.x}px`;
        this.slammerMiniDots[i].style.top = `${ui.y}px`;
      }
    } else {
      this.ui.miniLowerDotEl.style.display = "";
      if (this.ui.miniLowerLabelEl) {
        this.ui.miniLowerLabelEl.style.display = "";
      }
      for (const dot of this.slammerMiniDots) {
        dot.remove();
      }
      this.slammerMiniDots.length = 0;
      this.ui.miniLowerDotEl.style.left = `${lowerUi.x}px`;
      this.ui.miniLowerDotEl.style.top = `${lowerUi.y}px`;
    }
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

    const horizontalSpeed =
      this.gameMode === "slammer" ? 1.3 + power01 * 10.2 : 2 + power01 * 13;
    const downwardSpeed =
      this.gameMode === "slammer" ? 20 + power01 * 58 : 12 + power01 * 40;
    this.upperDiscBody.setLinvel(
      {
        x: direction.x * horizontalSpeed,
        y: -downwardSpeed,
        z: direction.z * horizontalSpeed,
      },
      true
    );

    const impulseScale = this.gameMode === "slammer" ? 1.72 : 1.08;
    const downwardImpulseScale = this.gameMode === "slammer" ? 2.75 : 1.5;
    this.upperDiscBody.applyImpulseAtPoint(
      {
        x: toLower.x * this.settings.power * impulseScale,
        y: -this.settings.power * downwardImpulseScale,
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
    if (!this.upperDiscBody || this.floorDiscBodies.length === 0) {
      return;
    }

    this.hasResolved = true;
    this.ui.launchBtn.disabled = true;
    this.ui.launchBtn.textContent = "Power";
    if (this.isOutOfArena(this.upperDiscBody)) {
      this.setStatus("you lost");
      return;
    }

    if (this.floorDiscBodies.some((body) => this.isOutOfArena(body))) {
      this.setStatus("you lost");
      return;
    }

    if (this.gameMode === "slammer") {
      const faceUpCount = this.floorDiscBodies.reduce(
        (sum, body) => sum + Number(this.topFaceColor(body) === "green"),
        0
      );
      if (faceUpCount > 3) {
        this.setStatus("you won");
        this.playRandomWinSfx();
      } else {
        this.setStatus("you lost");
      }
      return;
    }

    const upperColor = this.topFaceColor(this.upperDiscBody);
    const lowerColor = this.topFaceColor(this.floorDiscBodies[0]);
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
    const limit =
      this.gameMode === "slammer"
        ? this.floorRadius - 0.8
        : this.arenaRadius + OUT_OF_ARENA_RADIUS_OFFSET;
    return Math.hypot(pos.x, pos.z) > limit;
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

  applySlammerEdgeContainment(body) {
    if (!body || this.gameMode !== "slammer") {
      return;
    }

    const pos = body.translation();
    const radius = Math.hypot(pos.x, pos.z);
    if (radius < 0.0001) {
      return;
    }

    const nx = pos.x / radius;
    const nz = pos.z / radius;
    const softStart = Math.max(1, this.floorRadius - 4.2);
    const hardLimit = this.floorRadius - 0.45;

    if (radius > softStart) {
      const t = THREE.MathUtils.clamp(
        (radius - softStart) / Math.max(0.001, hardLimit - softStart),
        0,
        1
      );
      const inwardImpulse = 0.7 + t * 3.8;
      body.applyImpulse(
        {
          x: -nx * inwardImpulse,
          y: 0,
          z: -nz * inwardImpulse,
        },
        true
      );

      const lin = body.linvel();
      const outward = lin.x * nx + lin.z * nz;
      if (outward > 0) {
        const damp = 0.22 + t * 0.55;
        body.setLinvel(
          {
            x: lin.x - nx * outward * damp,
            y: lin.y,
            z: lin.z - nz * outward * damp,
          },
          true
        );
      }
    }

    if (radius > hardLimit) {
      const scale = hardLimit / radius;
      body.setTranslation(
        {
          x: pos.x * scale,
          y: pos.y,
          z: pos.z * scale,
        },
        true
      );
    }
  }

  syncMesh(body, mesh) {
    const position = body.translation();
    const rotation = body.rotation();
    mesh.position.set(position.x, position.y, position.z);
    mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  isDiscCollisionPair(handleA, handleB) {
    if (!this.upperDiscCollider) {
      return false;
    }
    const upperHandle = this.upperDiscCollider.handle;
    const floorHandles = this.floorDiscColliders.map((collider) => collider.handle);
    if (handleA === upperHandle) {
      return floorHandles.includes(handleB);
    }
    if (handleB === upperHandle) {
      return floorHandles.includes(handleA);
    }
    return false;
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
      for (const body of this.floorDiscBodies) {
        this.applyWind(body, this._wind);
      }

      if (this.gameMode === "slammer") {
        this.applySlammerEdgeContainment(this.upperDiscBody);
        for (const body of this.floorDiscBodies) {
          this.applySlammerEdgeContainment(body);
        }
      }
    }

    this.world.timestep = FIXED_STEP;
    this.world.step(this.eventQueue);
    this.consumeCollisionSfxEvents();

    if (
      this.hasLaunched &&
      !this.hasResolved &&
      this.upperDiscBody &&
      this.floorDiscBodies.length > 0
    ) {
      const allSettled =
        this.hasSettled(this.upperDiscBody) &&
        this.floorDiscBodies.every((body) => this.hasSettled(body));
      if (allSettled) {
        this.stableFrames += 1;
        if (this.stableFrames > 35) {
          this.resolveRound();
        }
      } else {
        this.stableFrames = 0;
      }

      if (
        this.isOutOfArena(this.upperDiscBody) ||
        this.floorDiscBodies.some((body) => this.isOutOfArena(body))
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

    if (this.upperDiscBody && this.upperDiscMesh) {
      this.syncMesh(this.upperDiscBody, this.upperDiscMesh);
    }
    if (this.gameMode === "slammer") {
      const count = Math.min(this.floorDiscBodies.length, this.floorDiscMeshes.length);
      for (let i = 0; i < count; i += 1) {
        this.syncMesh(this.floorDiscBodies[i], this.floorDiscMeshes[i]);
      }
    } else if (this.lowerDiscBody && this.lowerDiscMesh) {
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
