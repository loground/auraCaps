import * as THREE from "three";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

export function mountMenuScreen({ app, onPlay, onCollection }) {
  app.innerHTML = `
    <div class="menu-overlay">
      <div class="menu-buttons">
        <button id="menuPlay" class="menu-btn" type="button">play</button>
        <button id="menuCollection" class="menu-btn" type="button">collection</button>
      </div>
    </div>
  `;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.domElement.className = "menu-canvas";
  app.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#170807");
  scene.fog = new THREE.Fog("#170807", 18, 58);

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    120
  );
  camera.position.set(0, 4.8, 18);

  const ambient = new THREE.AmbientLight(0xffb48a, 0.56);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xff5b31, 1.6);
  keyLight.position.set(8, 10, 6);
  keyLight.castShadow = true;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffda99, 0.72);
  fillLight.position.set(-8, 5, 2);
  scene.add(fillLight);

  const demonTopLight = new THREE.SpotLight(0xffc58f, 2.32, 60, 0.45, 0.35, 1);
  demonTopLight.position.set(0, 10, 4);
  demonTopLight.castShadow = true;
  scene.add(demonTopLight);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.MeshStandardMaterial({
      color: "#24100d",
      roughness: 0.92,
      metalness: 0.02,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.7;
  floor.receiveShadow = true;
  scene.add(floor);

  const titleUniforms = {
    iTime: { value: 0 },
    iResolution: { value: new THREE.Vector2(1, 1) },
  };
  const titleVertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const titleFragmentShader = `
    uniform float iTime;
    uniform vec2 iResolution;
    varying vec2 vUv;

    float rand(vec2 co){
      return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
    }

    float hermite(float t) {
      return t * t * (3.0 - 2.0 * t);
    }

    float noise(vec2 co, float frequency) {
      vec2 v = vec2(co.x * frequency, co.y * frequency);
      float ix1 = floor(v.x);
      float iy1 = floor(v.y);
      float ix2 = floor(v.x + 1.0);
      float iy2 = floor(v.y + 1.0);
      float fx = hermite(fract(v.x));
      float fy = hermite(fract(v.y));
      float fade1 = mix(rand(vec2(ix1, iy1)), rand(vec2(ix2, iy1)), fx);
      float fade2 = mix(rand(vec2(ix1, iy2)), rand(vec2(ix2, iy2)), fx);
      return mix(fade1, fade2, fy);
    }

    float pnoise(vec2 co, float freq, int steps, float persistence) {
      float value = 0.0;
      float ampl = 1.0;
      float sum = 0.0;
      for(int i = 0; i < 8; i++) {
        if(i >= steps) break;
        sum += ampl;
        value += noise(co, freq) * ampl;
        freq *= 2.0;
        ampl *= persistence;
      }
      return value / max(sum, 0.0001);
    }

    void main() {
      vec2 fragCoord = vUv * iResolution;
      vec2 uv = fragCoord.xy / iResolution.xy;
      float gradient = 1.0 - uv.y;
      float gradientStep = 0.2;
      vec2 pos = fragCoord.xy / iResolution.x;
      pos.y -= iTime * 0.3125;

      vec4 brighterColor = vec4(1.0, 0.65, 0.1, 0.25);
      vec4 darkerColor = vec4(1.0, 0.0, 0.15, 0.0625);
      vec4 middleColor = mix(brighterColor, darkerColor, 0.5);
      float noiseTexel = pnoise(pos, 10.0, 5, 0.5);

      float firstStep = smoothstep(0.0, noiseTexel, gradient);
      float darkerColorStep = smoothstep(0.0, noiseTexel, gradient - gradientStep);
      float darkerColorPath = firstStep - darkerColorStep;
      vec4 color = mix(brighterColor, darkerColor, darkerColorPath);
      float middleColorStep = smoothstep(0.0, noiseTexel, gradient - 0.4);
      color = mix(color, middleColor, darkerColorStep - middleColorStep);
      color = mix(vec4(0.0), color, firstStep);

      gl_FragColor = color;
    }
  `;

  const titleMaterial = new THREE.ShaderMaterial({
    uniforms: titleUniforms,
    vertexShader: titleVertexShader,
    fragmentShader: titleFragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  let titleMesh = null;
  const loader = new FontLoader();
  loader.load("/fonts/hell.json", (font) => {
    const titleGeometry = new TextGeometry("AURA CAPS", {
      font,
      size: 3.1,
      depth: 0.9,
      curveSegments: 8,
      bevelEnabled: true,
      bevelThickness: 0.12,
      bevelSize: 0.08,
      bevelSegments: 6,
    });
    titleGeometry.center();
    titleMesh = new THREE.Mesh(titleGeometry, titleMaterial);
    titleMesh.position.set(0, 8.3, 0.6);
    titleMesh.castShadow = true;
    scene.add(titleMesh);
  });

  let demon = null;
  let demonPivot = null;
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("/draco/");
  const ktx2Loader = new KTX2Loader();
  ktx2Loader.setTranscoderPath("/basis/");
  ktx2Loader.detectSupport(renderer);
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);
  gltfLoader.setKTX2Loader(ktx2Loader);

  gltfLoader.load("/3d/demon.glb", (gltf) => {
    demon = gltf.scene;
    demon.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    const bbox = new THREE.Box3().setFromObject(demon);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    demon.position.sub(center);

    demonPivot = new THREE.Group();
    demonPivot.position.set(0, 1.5, -1);
    demonPivot.scale.setScalar(10);
    demonPivot.rotation.y = -Math.PI * 0.5;
    demonPivot.add(demon);
    scene.add(demonPivot);

    demonTopLight.target = demonPivot;
    scene.add(demonTopLight.target);
  });

  const playButton = app.querySelector("#menuPlay");
  const collectionButton = app.querySelector("#menuCollection");
  playButton.addEventListener("click", onPlay);
  collectionButton.addEventListener("click", onCollection);

  let rafId = null;
  let running = true;

  const animate = () => {
    if (!running) {
      return;
    }
    rafId = requestAnimationFrame(animate);
    const t = performance.now() * 0.001;
    titleUniforms.iTime.value = t;
    if (titleMesh) {
      titleMesh.position.y = 8.3 + Math.sin(t * 1.8) * 0.2;
      titleMesh.rotation.y = Math.sin(t * 0.55) * 0.08;
    }
    renderer.render(scene, camera);
  };

  const handleResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    titleUniforms.iResolution.value.set(window.innerWidth, window.innerHeight);
  };

  handleResize();
  window.addEventListener("resize", handleResize);
  animate();

  return () => {
    running = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }
    window.removeEventListener("resize", handleResize);
    playButton.removeEventListener("click", onPlay);
    collectionButton.removeEventListener("click", onCollection);
    dracoLoader.dispose();
    ktx2Loader.dispose();
    renderer.dispose();
  };
}
