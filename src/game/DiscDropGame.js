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

export class DiscDropGame {
  constructor(app, { theme = "hell" } = {}) {
    this.app = app;
    this.theme = theme;
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

    this.minLaunchClearance = LOWER_DISC_START_Y + DISC_HEIGHT * 2.4;

    this.clock = new THREE.Clock();
    this.running = false;
    this.rafId = null;
    this.handleResizeBound = () => this.handleResize();
    this._wind = { x: 0, y: 0, z: 0 };
    this._tempQuat = new THREE.Quaternion();
    this._tempUp = new THREE.Vector3(0, 1, 0);
    this._tempForward = new THREE.Vector3();
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
    this.setupUIBindings();

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
    this.world.maxCcdSubsteps = 8;
    this.world.integrationParameters.maxCcdSubsteps = 8;

    const floorBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.22, 0)
    );
    this.floorCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.22, TABLE_RADIUS)
        .setFriction(0.38)
        .setRestitution(0.55),
      floorBody
    );

    const catchFloorBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1.15, 0)
    );
    this.catchFloorCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(TABLE_RADIUS + 1, 1, TABLE_RADIUS + 1)
        .setFriction(0.55)
        .setRestitution(0.2),
      catchFloorBody
    );
  }

  setupArenaVisualModel() {
    if (this.theme === "heaven") {
      this.floorMesh.visible = true;
      this.tableMesh.visible = true;
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
          const model = gltf.scene;
          model.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = false;
              child.receiveShadow = true;
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
          this.arenaVisualRoot.position.set(0, -0.5, 0);
          resolve();
        },
        undefined,
        () => {
          // Fallback to procedural visuals if model loading fails.
          this.floorMesh.visible = true;
          this.tableMesh.visible = true;
          resolve();
        }
      );
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

    this.ui.launchBtn.addEventListener("click", () => {
      if (this.hasResolved) {
        this.buildRoundBodies();
        return;
      }
      this.launchRound();
    });
    this.ui.resetBtn.addEventListener("click", () => this.buildRoundBodies());

    this.bindSlider("posX");
    this.bindSlider("posZ");
    this.bindSlider("height");
    this.bindSlider("power");
  }

  bindSlider(key) {
    const slider = this.ui.sliders[key];
    const sync = () => {
      this.settings[key] = Number(slider.input.value);
      slider.value.textContent = slider.format(this.settings[key]);

      if (!this.hasLaunched && this.upperDiscBody) {
        this.upperDiscBody.setNextKinematicTranslation({
          x: this.settings.posX,
          y: this.safeLaunchHeight(),
          z: this.settings.posZ,
        });
        this.upperDiscBody.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
        this.updateLaunchArrow();
      }
    };

    slider.input.addEventListener("input", sync);
    sync();
  }

  safeLaunchHeight() {
    return Math.max(this.settings.height, this.minLaunchClearance);
  }

  setStatus(message) {
    this.ui.statusEl.textContent = message;
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
    this.lowerDiscBody.setAngularDamping(0.003);
    this.lowerDiscBody.enableCcd(true);
    this.lowerDiscBody.setSoftCcdPrediction(0.3);
    this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(DISC_HEIGHT * 0.5, DISC_RADIUS)
        .setFriction(arena.lowerFriction)
        .setRestitution(arena.lowerRestitution)
        .setDensity(arena.lowerDensity),
      this.lowerDiscBody
    );

    this.upperDiscBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        this.settings.posX,
        this.settings.height,
        this.settings.posZ
      )
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(DISC_HEIGHT * 0.5, DISC_RADIUS)
        .setFriction(arena.upperFriction)
        .setRestitution(arena.upperRestitution)
        .setDensity(arena.upperDensity),
      this.upperDiscBody
    );
    this.upperDiscBody.setLinearDamping(0.06);
    this.upperDiscBody.setAngularDamping(0.03);
    this.upperDiscBody.enableCcd(true);
    this.upperDiscBody.setSoftCcdPrediction(0.3);

    this.hasLaunched = false;
    this.hasResolved = false;
    this.stableFrames = 0;
    this.roundElapsed = 0;
    this.ui.launchBtn.disabled = false;
    this.ui.launchBtn.textContent = "Hit";
    this.setStatus("choose a position to hit");
    this.updateLaunchArrow();
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

    if (toLower.lengthSq() < 0.000001) {
      toLower.set(0, -1, 0);
    } else {
      toLower.normalize();
    }

    this.launchArrow.position.set(this.settings.posX, launchY, this.settings.posZ);
    this.launchArrow.setDirection(toLower);
    this.launchArrow.setLength(1 + this.settings.power * 0.16, 0.7, 0.45);
    this.launchArrow.visible = !this.hasLaunched;
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

    const impulseScale = 0.9;
    this.upperDiscBody.applyImpulseAtPoint(
      {
        x: toLower.x * this.settings.power * impulseScale,
        y: -this.settings.power * 1.3,
        z: toLower.z * this.settings.power * impulseScale,
      },
      {
        x: this.settings.posX,
        y: launchY,
        z: this.settings.posZ,
      },
      true
    );

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
    this.ui.launchBtn.disabled = false;
    this.ui.launchBtn.textContent = "Play Again";
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
    this.world.step();

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
  }

  applyResponsiveCamera() {
    if (window.innerWidth <= 760) {
      this.camera.position.set(0, 15.2, 24.2);
      this.controls.target.set(0, 0.45, 0);
    } else {
      this.camera.position.set(0, 9.8, 16.4);
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
    this.clearArenaObstacles();
    this.renderer.dispose();
  }
}
