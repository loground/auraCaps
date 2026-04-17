import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FLOOR_RADIUS, TABLE_RADIUS } from "./constants.js";

export function createRenderer(app) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;
  app.appendChild(renderer.domElement);
  return renderer;
}

export function createWorldScene(renderer, { theme = "hell" } = {}) {
  const isHeaven = theme === "heaven";
  const isJungle = theme === "jungle-bay";
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(
    isHeaven ? "#8ecfff" : isJungle ? "#8ddbb2" : "#1b0706"
  );

  const camera = new THREE.PerspectiveCamera(
    52,
    window.innerWidth / window.innerHeight,
    0.1,
    140
  );
  camera.position.set(0, 9, 14);
  camera.lookAt(0, 0.5, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0.35, 0);
  controls.minDistance = 6;
  controls.maxDistance = 40;
  controls.maxPolarAngle = Math.PI * 0.495;

  const ambientLight = new THREE.AmbientLight(
    isHeaven ? 0xe9f7ff : isJungle ? 0xf4ffd8 : 0xffccb3,
    isHeaven ? 0.92 : isJungle ? 0.86 : 0.73
  );
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(
    isHeaven ? 0xf1fbff : isJungle ? 0xfff1c4 : 0xffd2b0,
    isHeaven ? 1.62 : isJungle ? 1.56 : 1.49
  );
  directionalLight.position.set(8, 14, 8);
  scene.add(directionalLight);

  let skyUniforms = null;
  let skyBackdrop = null;
  if (isHeaven || isJungle) {
    skyUniforms = {
      iTime: { value: 0 },
    };
    const skyMaterial = new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: isJungle
        ? `
        varying vec2 vUv;
        uniform float iTime;

        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
        float noise(vec2 p){
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(hash(i + vec2(0,0)), hash(i + vec2(1,0)), u.x),
                     mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
        }
        float fbm(vec2 p){
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 5; i++) {
            v += a * noise(p);
            p *= 2.0;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec2 uv = vUv * vec2(1.9, 1.25);
          vec2 drift = vec2(iTime * 0.003, iTime * 0.0017);
          float n = fbm(uv * 2.0 + drift);
          float n2 = fbm(uv * 3.6 - drift * 1.8);
          float clouds = smoothstep(0.45, 0.92, n * 0.7 + n2 * 0.3);
          vec3 sky = mix(vec3(0.39, 0.78, 0.94), vec3(0.96, 0.95, 0.70), clamp(vUv.y, 0.0, 1.0));
          vec3 color = mix(sky, vec3(1.0, 0.98, 0.9), clouds * 0.62);
          gl_FragColor = vec4(color, 1.0);
        }
      `
        : `
        varying vec2 vUv;
        uniform float iTime;

        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
        float noise(vec2 p){
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(hash(i + vec2(0,0)), hash(i + vec2(1,0)), u.x),
                     mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
        }
        float fbm(vec2 p){
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 5; i++) {
            v += a * noise(p);
            p *= 2.0;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec2 uv = vUv * vec2(2.0, 1.5);
          vec2 flow = vec2(iTime * 0.004, iTime * 0.002);
          float c = fbm(uv * 2.4 + flow);
          float c2 = fbm(uv * 4.2 - flow * 1.6);
          float clouds = smoothstep(0.44, 0.9, c * 0.75 + c2 * 0.25);
          vec3 sky = mix(vec3(0.39, 0.67, 0.96), vec3(0.72, 0.88, 1.0), vUv.y);
          vec3 color = mix(sky, vec3(0.96, 0.98, 1.0), clouds * 0.8);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    const skyPlane = new THREE.Mesh(new THREE.PlaneGeometry(320, 180), skyMaterial);
    skyPlane.position.set(0, 0, -120);
    skyPlane.renderOrder = -1;
    skyPlane.frustumCulled = false;
    scene.add(skyPlane);
    skyBackdrop = skyPlane;
  }

  const floorMaterial = new THREE.MeshStandardMaterial({
    color: isHeaven ? "#e2eef8" : isJungle ? "#d0e9b6" : "#263049",
    metalness: 0.05,
    roughness: 0.78,
  });
  const floorMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(FLOOR_RADIUS, FLOOR_RADIUS + 1, 0.4, 96),
    floorMaterial
  );
  floorMesh.position.y = -0.2;
  scene.add(floorMesh);

  const tableMaterial = new THREE.MeshStandardMaterial({
    color: isHeaven ? "#c8deef" : isJungle ? "#96b878" : "#111827",
    metalness: 0.1,
    roughness: 0.88,
  });
  const tableMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS + 0.4, 0.24, 96),
    tableMaterial
  );
  tableMesh.position.y = 0.12;
  scene.add(tableMesh);

  return {
    scene,
    camera,
    controls,
    floorMesh,
    tableMesh,
    floorMaterial,
    tableMaterial,
    skyUniforms,
    skyBackdrop,
  };
}
