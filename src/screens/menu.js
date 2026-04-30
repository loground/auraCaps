import * as THREE from "three";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

const AURA_ORIGIN = "https://auramaxx.gg";
const AURA_SDK_URL = `${AURA_ORIGIN}/login-with-aura/sdk.js`;
const AURA_CLIENT_ID_STORAGE_KEY = "aura_client_id";
const AURA_DEBUG_KEY = "aura_debug";
const AURA_DEFAULT_CLIENT_ID = "your-app";
const HELL_MENU_TUNING = {
  backgroundDarkness: 1.0,
  haloIntensity: 0.22,
  smokeIntensity: 0.14,
  fogDensity: 0.022,
  crackEmissiveIntensity: 0.9,
  emberCount: 34,
  underlightIntensity: 1.9,
  bloomStrength: 0.2,
  bloomRadius: 0.34,
  bloomThreshold: 0.88,
};
const HEAVEN_MENU_TUNING = {
  hazeStrength: 0.08,
  haloStrength: 0.16,
  moteCount: 14,
  bloomStrength: 0.07,
  bloomRadius: 0.2,
  bloomThreshold: 0.95,
};

function loadAuraSdk() {
  return new Promise((resolve, reject) => {
    if (typeof window !== "undefined" && window.Aura?.SigninButton) {
      resolve(window.Aura);
      return;
    }

    const existing = document.querySelector('script[data-aura-sdk="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Aura), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load Aura SDK")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = AURA_SDK_URL;
    script.async = true;
    script.dataset.auraSdk = "true";
    script.dataset.auraOrigin = AURA_ORIGIN;
    script.onload = () => resolve(window.Aura);
    script.onerror = () => reject(new Error("Failed to load Aura SDK"));
    document.head.appendChild(script);
  });
}

function safeCall(fn, context) {
  try {
    const value = fn.call(context);
    return Promise.resolve(value).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

function pickFirstString(...values) {
  for (const value of values) {
    const s = String(value || "").trim();
    if (s) {
      return s;
    }
  }
  return "";
}

function auraDebugLog(...args) {
  try {
    const entry = {
      scope: "menu",
      at: new Date().toISOString(),
      args,
    };
    window.__AURA_LOGS__ = Array.isArray(window.__AURA_LOGS__)
      ? window.__AURA_LOGS__
      : [];
    window.__AURA_LOGS__.push(entry);
    console.log("[AURA][MENU]", ...args);
    if (window.localStorage.getItem(AURA_DEBUG_KEY) === "1") {
      console.log("[AURA][MENU][DEBUG]", ...args);
    }
  } catch {
    // Ignore logging failures.
  }
}

// Heaven menu: soft skydome with subtle cloud depth and center halo.
function createHeavenBackground() {
  const uniforms = {
    iTime: { value: 0 },
    uHaze: { value: HEAVEN_MENU_TUNING.hazeStrength },
    uHalo: { value: HEAVEN_MENU_TUNING.haloStrength },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vLocalPos;
      void main() {
        vUv = uv;
        vLocalPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vLocalPos;
      uniform float iTime;
      uniform float uHaze;
      uniform float uHalo;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += noise(p) * a;
          p *= 2.0;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec2 uv = vUv;
        vec3 nrm = normalize(vLocalPos);
        float h = nrm.y * 0.5 + 0.5;

        vec3 top = vec3(0.61, 0.77, 0.95);
        vec3 mid = vec3(0.77, 0.88, 0.98);
        vec3 bot = vec3(0.9, 0.95, 0.99);
        vec3 color = mix(mid, top, smoothstep(0.35, 1.0, h));
        color = mix(bot, color, smoothstep(0.05, 0.62, h));

        vec2 cloudUv = vec2(uv.x * 2.0, h * 1.65) + vec2(iTime * 0.008, -iTime * 0.005);
        float cloud = fbm(cloudUv);
        float haze = smoothstep(0.62, 0.92, cloud) * uHaze;
        color += vec3(0.07, 0.1, 0.14) * haze;

        float centerHalo = exp(-length((uv - vec2(0.5, 0.47)) * vec2(1.1, 0.95)) * 4.0);
        color += vec3(0.1, 0.13, 0.18) * centerHalo * uHalo;

        float vignette = smoothstep(0.97, 0.25, length((uv - 0.5) * vec2(1.2, 1.0)));
        color *= mix(0.9, 1.0, vignette);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    depthWrite: false,
    depthTest: false,
    side: THREE.BackSide,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 24), material);
  return { mesh, uniforms };
}

// Heaven menu: soft local cloud-haze around hero emergence point.
function createHeavenCloudBase() {
  const uniforms = { iTime: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float iTime;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      void main() {
        vec2 uv = vUv - 0.5;
        vec2 p = uv * vec2(1.15, 0.92);
        float d = length(p);
        float n = noise((uv + 0.5) * 11.0 + vec2(iTime * 0.03, -iTime * 0.02));
        float soft = smoothstep(0.55, 0.12, d) * smoothstep(0.38, 0.9, n);
        vec3 col = mix(vec3(0.88, 0.94, 0.99), vec3(0.74, 0.85, 0.96), d);
        gl_FragColor = vec4(col, soft * 0.14);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(14.4, 10.2), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, -2.56, -0.72);
  return { mesh, uniforms };
}

// Heaven menu: sparse drifting light motes for subtle atmospheric polish.
function createHeavenMotes() {
  const count = HEAVEN_MENU_TUNING.moteCount;
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const r = 2.0 + Math.random() * 9.0;
    const a = Math.random() * Math.PI * 2;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = -1.4 + Math.random() * 8.2;
    positions[i * 3 + 2] = Math.sin(a) * r - 0.8;
    speeds[i] = 0.1 + Math.random() * 0.18;
    phases[i] = Math.random() * Math.PI * 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  const uniforms = { iTime: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      attribute float aSpeed;
      attribute float aPhase;
      uniform float iTime;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float t = iTime * aSpeed + aPhase;
        p.y += mod(t * 1.05, 7.2);
        p.x += sin(t * 1.2) * 0.05;
        p.z += cos(t * 1.1) * 0.05;
        if (p.y > 5.8) p.y -= 7.2;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 1.0 + 1.8 * (1.0 / max(1.0, -mv.z * 0.11));
        vAlpha = 0.38 + 0.62 * sin(t * 2.0);
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float a = smoothstep(0.5, 0.0, d) * vAlpha;
        vec3 col = mix(vec3(1.0, 1.0, 1.0), vec3(0.84, 0.92, 1.0), d);
        gl_FragColor = vec4(col, a * 0.16);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.position.set(0, -0.2, -0.8);
  return { points, uniforms };
}

// Hell menu: inside-facing skydome so no finite plane edges appear while orbiting.
function createHellBackground() {
  const uniforms = {
    iTime: { value: 0 },
    uDarkness: { value: HELL_MENU_TUNING.backgroundDarkness },
    uHalo: { value: HELL_MENU_TUNING.haloIntensity },
    uSmoke: { value: HELL_MENU_TUNING.smokeIntensity },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vLocalPos;
      void main() {
        vUv = uv;
        vLocalPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vLocalPos;
      uniform float iTime;
      uniform float uDarkness;
      uniform float uHalo;
      uniform float uSmoke;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += noise(p) * a;
          p *= 2.02;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec2 uv = vUv;
        vec3 nrm = normalize(vLocalPos);
        vec3 top = vec3(0.025, 0.003, 0.004);
        vec3 mid = vec3(0.05, 0.006, 0.007);
        vec3 bot = vec3(0.006, 0.0, 0.001);
        float h = nrm.y * 0.5 + 0.5;
        vec3 color = mix(mid, top, smoothstep(0.2, 1.0, h));
        color = mix(bot, color, smoothstep(0.0, 0.58, h));

        vec2 smokeUv = vec2(uv.x * 2.5, h * 1.6) + vec2(0.0, iTime * 0.014);
        float smoke = fbm(smokeUv);
        float haze = smoothstep(0.42, 0.9, smoke) * uSmoke;
        color += vec3(0.09, 0.015, 0.012) * haze;

        float centerGlow = exp(-length((uv - vec2(0.5, 0.43)) * vec2(1.14, 0.95)) * 5.8);
        color += vec3(0.22, 0.03, 0.02) * centerGlow * uHalo;

        float vignette = smoothstep(0.95, 0.24, length((uv - 0.5) * vec2(1.25, 0.95)));
        color *= mix(0.44, 1.0, vignette);
        color *= 1.0 / max(0.001, uDarkness);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
    depthWrite: false,
    depthTest: false,
    side: THREE.BackSide,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(220, 32, 24), material);
  mesh.position.set(0, 0, 0);
  return { mesh, uniforms };
}

function createMenuTextureSphere(renderer, path) {
  const texture = new THREE.TextureLoader().load(path);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide,
    toneMapped: false,
    fog: false,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(18, 20, 20), material);
  mesh.position.set(0, 12, 0);
  mesh.rotation.y = Math.PI / 2;
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return { mesh, texture };
}

// Hell menu: cracked ground with emissive lava accents concentrated near center.
function createHellCrackedGround() {
  const uniforms = {
    iTime: { value: 0 },
    uCrackEmissive: { value: HELL_MENU_TUNING.crackEmissiveIntensity },
  };
  const basePlate = new THREE.Mesh(
    new THREE.CylinderGeometry(7.6, 8.5, 0.95, 48),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color("#130707"),
      roughness: 0.93,
      metalness: 0.05,
    })
  );
  basePlate.position.y = -3.16;
  basePlate.receiveShadow = true;
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float iTime;
      uniform float uCrackEmissive;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += noise(p) * a;
          p *= 2.04;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec2 uv = vUv - vec2(0.5);
        float dist = length(uv);
        float radialFalloff = smoothstep(0.62, 0.1, dist);

        vec2 p = (uv + 0.5) * 18.0;
        float n = fbm(p + vec2(iTime * 0.02, -iTime * 0.012));
        float n2 = fbm(p * 1.9 + vec2(-iTime * 0.015, iTime * 0.01));
        float crack = smoothstep(0.7, 0.92, abs(n - n2) * 1.9);

        float pulse = 0.88 + 0.12 * sin(iTime * 2.2 + uv.x * 11.0);
        float glow = crack * radialFalloff * pulse * uCrackEmissive;

        vec3 rock = vec3(0.055, 0.02, 0.019);
        rock *= mix(0.66, 1.0, radialFalloff);
        vec3 lava = vec3(1.0, 0.28, 0.08) * glow;
        vec3 color = rock + lava;
        float alpha = smoothstep(0.64, 0.26, dist);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(6.4, 96), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -2.67;

  const group = new THREE.Group();
  group.add(basePlate);
  group.add(mesh);

  return { group, mesh, basePlate, uniforms };
}

function createJungleMenuGround() {
  const group = new THREE.Group();

  const sand = new THREE.Mesh(
    new THREE.CylinderGeometry(5.4, 6.2, 0.46, 44),
    new THREE.MeshStandardMaterial({
      color: "#d8bd72",
      roughness: 0.86,
      metalness: 0.02,
    })
  );
  sand.position.y = -2.92;
  sand.receiveShadow = true;
  group.add(sand);

  const grass = new THREE.Mesh(
    new THREE.CircleGeometry(5.15, 64),
    new THREE.MeshStandardMaterial({
      color: "#6faf52",
      roughness: 0.74,
      metalness: 0.03,
    })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -2.68;
  grass.receiveShadow = true;
  group.add(grass);

  const woodMat = new THREE.MeshStandardMaterial({
    color: "#9a612a",
    roughness: 0.62,
    metalness: 0.04,
  });
  for (let i = 0; i < 7; i += 1) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.14, 4.6), woodMat);
    plank.position.set((i - 3) * 0.72, -2.55 + Math.sin(i) * 0.012, -0.05);
    plank.rotation.y = (i - 3) * 0.015;
    plank.receiveShadow = true;
    group.add(plank);
  }

  const waterRing = new THREE.Mesh(
    new THREE.TorusGeometry(5.9, 0.08, 10, 72),
    new THREE.MeshBasicMaterial({
      color: "#50c9d6",
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  waterRing.rotation.x = Math.PI / 2;
  waterRing.position.y = -2.66;
  group.add(waterRing);

  group.position.set(0, 0, -1);
  return { group, waterRing };
}

function createBrainrotMenuGround() {
  const uniforms = { iTime: { value: 0 } };
  const group = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(5.2, 5.85, 0.52, 48),
    new THREE.MeshStandardMaterial({
      color: "#170025",
      roughness: 0.72,
      metalness: 0.18,
      emissive: new THREE.Color("#32005a"),
      emissiveIntensity: 0.2,
    })
  );
  base.position.y = -2.95;
  base.receiveShadow = true;
  group.add(base);

  const padMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float iTime;

      void main() {
        vec2 uv = vUv - 0.5;
        float d = length(uv);
        float grid = mod(floor((vUv.x + iTime * 0.05) * 9.0) + floor(vUv.y * 9.0), 2.0);
        vec3 purple = vec3(0.35, 0.0, 0.72);
        vec3 cyan = vec3(0.0, 0.85, 1.0);
        vec3 pink = vec3(1.0, 0.05, 0.72);
        vec3 color = mix(purple, cyan, grid * 0.36);
        color = mix(color, pink, smoothstep(0.44, 0.2, abs(uv.x + uv.y) * 0.55) * 0.2);
        float rim = smoothstep(0.49, 0.37, d);
        float alpha = smoothstep(0.52, 0.46, d);
        color *= 0.42 + rim * 0.58;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const pad = new THREE.Mesh(new THREE.CircleGeometry(5.3, 72), padMaterial);
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = -2.66;
  group.add(pad);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(5.45, 0.075, 10, 72),
    new THREE.MeshBasicMaterial({
      color: "#eaff35",
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -2.6;
  group.add(ring);

  group.position.set(0, -0.5, -1);
  return { group, pad, ring, uniforms };
}

// Hell menu: sparse embers for atmosphere, intentionally low count for performance.
function createHellEmbers() {
  const count = HELL_MENU_TUNING.emberCount;
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const phases = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const r = 1.9 + Math.random() * 8.8;
    const a = Math.random() * Math.PI * 2;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = -2.0 + Math.random() * 5.1;
    positions[i * 3 + 2] = Math.sin(a) * r - 0.3;
    speeds[i] = 0.16 + Math.random() * 0.22;
    phases[i] = Math.random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

  const uniforms = { iTime: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      attribute float aSpeed;
      attribute float aPhase;
      uniform float iTime;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float t = iTime * aSpeed + aPhase;
        p.y += mod(t * 1.3, 5.8);
        p.x += sin(t * 1.55) * 0.05;
        p.z += cos(t * 1.2) * 0.05;
        if (p.y > 3.8) p.y -= 5.8;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 1.2 + 1.6 * (1.0 / max(1.0, -mv.z * 0.12));
        vAlpha = 0.42 + 0.58 * sin(t * 2.2);
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float a = smoothstep(0.5, 0.0, d) * vAlpha;
        vec3 col = mix(vec3(1.0, 0.8, 0.4), vec3(1.0, 0.35, 0.12), d);
        gl_FragColor = vec4(col, a * 0.22);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.position.set(0, -0.7, -0.4);
  return { points, uniforms };
}

export function mountMenuScreen({
  app,
  onPlay,
  onCollection,
  onProfile,
  theme = "hell",
  onThemeChange,
  soundEnabled = true,
  onSoundToggle,
  auraSession = null,
  onAuraSuccess,
  onAuraDisconnect,
}) {
  const formatAuraStatus = (sessionLike) => {
    const wallet = sessionLike?.walletAddress || "";
    if (wallet.length >= 10) {
      return `connected with aura • ${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
    }
    return "connected with aura";
  };
  const hasConnectedSession = (sessionLike) =>
    Boolean(sessionLike?.connected || sessionLike?.walletAddress || sessionLike?.user);
  let localAuraSession = auraSession;

  app.innerHTML = `
    <div class="menu-overlay">
      <div class="menu-mute-switch" role="group" aria-label="Menu mute switcher">
        <button id="menuMuteToggle" class="menu-mute-btn ${soundEnabled ? "" : "muted"}" type="button">
          ${soundEnabled ? "mute: off" : "mute: on"}
        </button>
      </div>
      <div class="menu-top-right">
        <div id="aura-login" class="aura-login-slot" aria-label="Aura login"></div>
      </div>
      <div class="menu-theme-picker" role="group" aria-label="Theme switcher">
        <select id="menuThemeSelect" class="menu-theme-select">
          <option value="heaven" ${theme === "heaven" ? "selected" : ""}>heaven</option>
          <option value="hell" ${theme === "hell" ? "selected" : ""}>hell</option>
          <option value="jungle-bay" ${theme === "jungle-bay" ? "selected" : ""}>jungle bay</option>
          <option value="brainrot" ${theme === "brainrot" ? "selected" : ""}>brainrot</option>
        </select>
      </div>
      <div id="menuPreloader" class="menu-preloader">
        <div class="sigil"></div>
        <p>SUMMONING</p>
      </div>
      <div class="menu-buttons">
        <button id="menuPlay" class="menu-btn" type="button">play</button>
        <button id="menuCollection" class="menu-btn" type="button">collection</button>
      </div>
      <div id="auraConnectedStatus" class="menu-aura-status ${auraSession?.connected ? "visible" : ""}">
        ${auraSession?.connected ? formatAuraStatus(auraSession) : ""}
      </div>
      <div id="auraHintStatus" class="menu-aura-status"></div>
    </div>
  `;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearAlpha(1);
  renderer.domElement.style.pointerEvents = "auto";
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.domElement.className = "menu-canvas";
  app.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const isHeaven = theme === "heaven";
  const isJungle = theme === "jungle-bay";
  const isBrainrot = theme === "brainrot";
  const isHell = !isHeaven && !isJungle && !isBrainrot;
  const bgColor = isHeaven
    ? "#8ccfff"
    : isJungle
      ? "#8edcb4"
      : isBrainrot
        ? "#25003a"
        : "#170807";
  scene.background = new THREE.Color(bgColor);
  scene.fog = isHell
    ? new THREE.FogExp2("#120404", HELL_MENU_TUNING.fogDensity)
    : isHeaven
      ? new THREE.Fog("#c8dff4", 20, 72)
      : new THREE.Fog(bgColor, 18, 58);

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    700
  );
  camera.position.set(0, 4.8, 18);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.rotateSpeed = 0.28;
  controls.target.set(0, 4.2, 0);
  controls.minPolarAngle = Math.PI * 0.43;
  controls.maxPolarAngle = Math.PI * 0.57;
  controls.minAzimuthAngle = -0.22;
  controls.maxAzimuthAngle = 0.22;
  controls.update();

  const ambient = new THREE.AmbientLight(
    isHeaven ? 0xe6f6ff : isJungle ? 0xf4ffd6 : isBrainrot ? 0xffe5fb : 0xffb48a,
    isHeaven ? 0.78 : isJungle ? 0.82 : isBrainrot ? 0.92 : 0.56
  );
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(
    isHeaven ? 0xd2ecff : isJungle ? 0xffefbd : isBrainrot ? 0xa7ff3d : 0xff5b31,
    isHeaven ? 1.45 : isJungle ? 1.52 : isBrainrot ? 1.75 : 1.6
  );
  keyLight.position.set(8, 10, 6);
  keyLight.castShadow = true;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(
    isHeaven ? 0xffffff : isJungle ? 0xd1ffd2 : isBrainrot ? 0x77d2ff : 0xffda99,
    isHeaven ? 0.88 : isJungle ? 0.76 : isBrainrot ? 1.04 : 0.72
  );
  fillLight.position.set(-8, 5, 2);
  scene.add(fillLight);

  const demonTopLight = new THREE.SpotLight(
    isHeaven ? 0xf2fbff : isJungle ? 0xfff5ca : isBrainrot ? 0xff7eea : 0xffc58f,
    isHeaven ? 2.0 : isJungle ? 2.18 : isBrainrot ? 2.45 : 2.32,
    60,
    0.45,
    0.35,
    1
  );
  demonTopLight.position.set(0, 10, 4);
  demonTopLight.castShadow = true;
  scene.add(demonTopLight);

  let hellUnderLight = null;
  let hellRimLight = null;
  let hellBackLight = null;
  let heavenRimLight = null;
  let heavenBounceLight = null;
  let heavenAccentLight = null;
  if (isHeaven) {
    ambient.color.set("#e6f2ff");
    ambient.intensity = 0.74;
    keyLight.color.set("#cee5ff");
    keyLight.intensity = 1.36;
    keyLight.position.set(7.4, 10.1, 5.8);
    fillLight.color.set("#f9fdff");
    fillLight.intensity = 0.82;
    fillLight.position.set(-7.8, 5.0, 1.8);
    demonTopLight.color.set("#eef8ff");
    demonTopLight.intensity = 2.06;
    demonTopLight.position.set(0, 10.0, 3.2);
    demonTopLight.angle = 0.48;
    demonTopLight.penumbra = 0.44;

    heavenRimLight = new THREE.DirectionalLight("#f4e8d8", 0.46);
    heavenRimLight.position.set(-7.0, 6.7, -7.8);
    scene.add(heavenRimLight);

    heavenBounceLight = new THREE.PointLight("#d6ecff", 0.82, 18, 1.7);
    heavenBounceLight.position.set(0, -2.15, -0.6);
    scene.add(heavenBounceLight);

    heavenAccentLight = new THREE.DirectionalLight("#ffe6c4", 0.2);
    heavenAccentLight.position.set(5.5, 5.0, -6.5);
    scene.add(heavenAccentLight);
  }
  if (isHell) {
    // Cinematic hell lighting rig tuned for readability and silhouette separation.
    ambient.color.set("#52201a");
    ambient.intensity = 0.2;
    keyLight.color.set("#ffd6b5");
    keyLight.intensity = 0.8;
    keyLight.position.set(5.6, 9.2, 5.3);
    fillLight.color.set("#5a1712");
    fillLight.intensity = 0.24;
    fillLight.position.set(-6.4, 4.0, -1.6);
    demonTopLight.color.set("#ffcc96");
    demonTopLight.intensity = 2.2;
    demonTopLight.position.set(0.4, 10.1, 3.0);
    demonTopLight.angle = 0.5;
    demonTopLight.penumbra = 0.42;

    hellUnderLight = new THREE.PointLight(
      "#ff4a1f",
      HELL_MENU_TUNING.underlightIntensity,
      18,
      1.9
    );
    hellUnderLight.position.set(0, -2.25, -0.3);
    scene.add(hellUnderLight);

    hellRimLight = new THREE.DirectionalLight("#ff6b42", 0.56);
    hellRimLight.position.set(-6.8, 6.9, -9.0);
    scene.add(hellRimLight);

    hellBackLight = new THREE.PointLight("#5d130d", 0.48, 24, 2.1);
    hellBackLight.position.set(0, 6.0, -15.0);
    scene.add(hellBackLight);
  }

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.MeshStandardMaterial({
      color: isHeaven ? "#d4e8f6" : isJungle ? "#acc98d" : isBrainrot ? "#300942" : "#24100d",
      roughness: 0.92,
      metalness: 0.02,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.7;
  floor.receiveShadow = true;

  let heavenBackground = null;
  let menuTextureSphere = null;
  let heavenCloudBase = null;
  let heavenMotes = null;
  let hellBackground = null;
  let hellGround = null;
  let hellEmbers = null;
  let jungleGround = null;
  let brainrotGround = null;
  const menuTexturePath = isHeaven
    ? "/themes/heaven.webp"
    : isJungle
      ? "/themes/junglebay.webp"
      : isBrainrot
        ? "/themes/brainrot.webp"
        : isHell
          ? "/themes/hell.webp"
          : "";
  if (menuTexturePath) {
    menuTextureSphere = createMenuTextureSphere(renderer, menuTexturePath);
    scene.add(menuTextureSphere.mesh);
  }
  if (isHeaven) {
    heavenCloudBase = createHeavenCloudBase();
    scene.add(heavenCloudBase.mesh);
    heavenMotes = createHeavenMotes();
    scene.add(heavenMotes.points);
  }
  if (isHell) {
    hellGround = createHellCrackedGround();
    scene.add(hellGround.group);
    hellEmbers = createHellEmbers();
    scene.add(hellEmbers.points);
  }
  if (isJungle) {
    jungleGround = createJungleMenuGround();
    scene.add(jungleGround.group);
  }
  if (isBrainrot) {
    brainrotGround = createBrainrotMenuGround();
    scene.add(brainrotGround.group);
  }

  const titleUniforms = {
    iTime: { value: 0 },
    iResolution: { value: new THREE.Vector2(1, 1) },
    iMouse: { value: new THREE.Vector2(0.5, 0.5) },
    iHover: { value: 0 },
  };
  const titleVertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const hellFragmentShader = `
    uniform float iTime;
    uniform vec2 iResolution;
    uniform vec2 iMouse;
    uniform float iHover;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    void main() {
      vec2 uv = vUv;
      float bottomHeat = smoothstep(0.0, 0.68, 1.0 - uv.y);
      float topShade = smoothstep(0.2, 1.0, uv.y);
      vec3 forged = vec3(0.12, 0.06, 0.055);
      vec3 metal = vec3(0.22, 0.1, 0.085);
      vec3 col = mix(forged, metal, bottomHeat * 0.52);
      col *= mix(1.0, 0.56, topShade);

      vec2 p = uv * vec2(7.8, 4.4);
      float nA = noise(p + vec2(0.0, -iTime * 0.08));
      float nB = noise(p * 1.85 + vec2(iTime * 0.06, 0.0));
      float crack = smoothstep(0.74, 0.92, abs(nA - nB) * 2.0);
      float lava = crack * bottomHeat;

      float flicker = 0.92 + 0.08 * sin(iTime * 6.0 + uv.x * 11.0);
      vec3 lavaCol = vec3(1.0, 0.34, 0.11);
      col += lavaCol * lava * flicker * 0.62;

      float lowerEdge = smoothstep(0.0, 0.36, 1.0 - uv.y);
      col += vec3(0.7, 0.2, 0.1) * lowerEdge * 0.12;

      float distToMouse = distance(uv, iMouse);
      float mouseFlare = exp(-distToMouse * 9.0) * iHover;
      col += vec3(1.0, 0.46, 0.2) * mouseFlare * 0.34;

      gl_FragColor = vec4(col, 0.96);
    }
  `;
  const heavenFragmentShader = `
    uniform float iTime;
    uniform vec2 iResolution;
    uniform vec2 iMouse;
    uniform float iHover;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    void main() {
      vec2 uv = vUv;
      float t = iTime * 0.15;
      vec3 baseA = vec3(0.74, 0.86, 0.98);
      vec3 baseB = vec3(0.57, 0.73, 0.92);
      vec3 col = mix(baseA, baseB, smoothstep(0.2, 1.0, uv.y));

      float facet = noise(uv * vec2(11.0, 6.0) + vec2(0.0, t));
      float edge = smoothstep(0.0, 0.14, uv.x) * smoothstep(0.0, 0.14, 1.0 - uv.x);
      float fresnelLike = pow(1.0 - edge, 1.7);
      col += vec3(0.14, 0.19, 0.27) * fresnelLike * 0.11;

      float lowerGlow = smoothstep(0.0, 0.55, 1.0 - uv.y);
      col += vec3(0.16, 0.23, 0.32) * lowerGlow * 0.08;
      col += vec3(0.08, 0.11, 0.15) * facet * 0.045;

      float distToMouse = distance(uv, iMouse);
      float hover = exp(-distToMouse * 9.0) * iHover;
      col += vec3(0.2, 0.26, 0.36) * hover * 0.14;
      gl_FragColor = vec4(col, 0.98);
    }
  `;
  const kaleFragmentShader = `
    uniform float iTime;
    uniform vec2 iResolution;
    uniform vec2 iMouse;
    uniform float iHover;
    varying vec2 vUv;

    float hash12(vec2 p){
      vec3 p3  = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    float noise(vec2 p){
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f*f*(3.0-2.0*f);
      float a = hash12(i + vec2(0.0, 0.0));
      float b = hash12(i + vec2(1.0, 0.0));
      float c = hash12(i + vec2(0.0, 1.0));
      float d = hash12(i + vec2(1.0, 1.0));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    void main() {
      vec2 fragCoord = vUv * iResolution.xy;
      vec2 uv = fragCoord / iResolution.xy;

      // sand base color
      vec4 sandcolor = vec4(0.9606, 0.6601, 0.1445, 1.0);

      // pseudo textures (iChannel0/1 replacement)
      float nLo = noise(uv * 64.0 + vec2(iTime * 0.03, -iTime * 0.02));
      float nHi = noise(uv * 256.0 + vec2(-iTime * 0.12, iTime * 0.07));
      float nHi2 = noise(uv * 256.0 + vec2(sin(iTime * 0.4), cos(iTime * 0.3)));
      float nHi3 = noise(uv * 256.0 + vec2(cos(iTime * 0.21), -sin(iTime * 0.35)));

      vec4 sandtexture = vec4(vec3(nLo), 1.0);
      vec4 sandspecular = vec4(nHi, nHi2, nHi3, 1.0);
      vec4 sandspecular2 = vec4(nHi2, nHi3, nHi, 1.0);
      vec4 sandspecular3 = vec4(nHi3, nHi, nHi2, 1.0);

      sandspecular.xyz =
        sandspecular.xxx * sandspecular3.yyy * sandspecular2.zzz * vec3(2.0);

      float d = abs(fragCoord.y - ((1.3 + sin(iTime)) * 200.0));
      d = d * 0.003;
      d = pow(d, 0.6);
      d = min(d, 1.0);

      vec4 sandbase = min(sandcolor + sandtexture * 0.06, vec4(1.0));
      vec4 darkensand = mix(sandtexture, vec4(0.0), d);
      vec4 gradientgen = mix(sandspecular, darkensand, d);
      vec4 finalmix = min(sandbase + gradientgen * 0.3, vec4(1.0));

      // hover boost to make interaction visible
      float distToMouse = distance(uv, iMouse);
      float hoverGlow = exp(-distToMouse * 9.5) * iHover;
      finalmix.rgb += vec3(0.18, 0.12, 0.02) * hoverGlow;
      finalmix.rgb = min(finalmix.rgb, vec3(1.0));

      gl_FragColor = vec4(finalmix.rgb, 1.0);
    }
  `;
  const brainrotFragmentShader = `
    uniform float iTime;
    uniform vec2 iResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv * 2.0 - 1.0;
      float t = iTime * 0.65;

      vec3 baseA = vec3(0.18, 0.00, 0.30); // dark purple
      vec3 baseB = vec3(0.03, 0.00, 0.10); // near-black violet
      vec3 color = mix(baseB, baseA, vUv.y);

      // Cheap animated bands and swirl.
      float bands = sin((uv.y + t * 0.85) * 11.0) * 0.5 + 0.5;
      float swirl = sin((uv.x * 1.7 + uv.y * 0.8 - t * 0.45) * 7.0) * 0.5 + 0.5;
      float pulse = 0.5 + 0.5 * sin(t * 1.6);

      // Tiny grain without expensive fbm loops.
      float grain = hash(floor((uv + 1.0) * 46.0 + t * 3.0)) * 0.12;

      vec3 pink = vec3(0.96, 0.23, 0.78);
      vec3 cyan = vec3(0.20, 0.86, 1.00);
      vec3 lime = vec3(0.74, 0.98, 0.22);

      color = mix(color, pink, bands * 0.32);
      color = mix(color, cyan, swirl * 0.28);
      color += lime * (bands * swirl * pulse * 0.09);
      color += grain;
      color = clamp(color, 0.0, 1.0);

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const titleMaterial = new THREE.ShaderMaterial({
    uniforms: titleUniforms,
    vertexShader: titleVertexShader,
    fragmentShader: isHeaven
      ? heavenFragmentShader
      : isJungle
        ? kaleFragmentShader
        : isBrainrot
          ? brainrotFragmentShader
        : hellFragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  let titleMesh = null;
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const titleScreen = new THREE.Vector3();
  let hoverTarget = 0;
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
    updateResponsiveLayout();
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

  const menuModelPath = isHeaven
    ? "/3d/heaven.glb"
    : isJungle
      ? "/3d/jbMenu.glb"
      : isBrainrot
        ? "/3d/tungMain.glb"
      : "/3d/demon.glb";
  const jungleMenuYDesktop = 1.38;
  const jungleMenuYMobile = 0.93;
  const brainrotMenuYDesktop = 1.42;
  const brainrotMenuYMobile = 1.02;
  const brainrotMenuScaleDesktop = 9.2;
  const brainrotMenuScaleMobile = 7.6;
  gltfLoader.load(
    menuModelPath,
    (gltf) => {
      demon = gltf.scene;
      demon.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (isHeaven && child.material && !Array.isArray(child.material)) {
            const n = String(child.name || "").toLowerCase();
            child.material.roughness = Math.min(child.material.roughness ?? 1, 0.66);
            child.material.metalness = Math.max(child.material.metalness ?? 0, 0.06);
            if (n.includes("cap") || n.includes("coin")) {
              child.material.emissive = new THREE.Color("#80abeb");
              child.material.emissiveIntensity = 0.12;
            } else if (n.includes("wing")) {
              child.material.emissive = new THREE.Color("#a9c6ef");
              child.material.emissiveIntensity = 0.09;
            } else if (n.includes("cloud")) {
              child.material.emissive = new THREE.Color("#c9ddf8");
              child.material.emissiveIntensity = 0.06;
              child.material.roughness = Math.min(child.material.roughness ?? 1, 0.74);
            } else {
              child.material.emissive = new THREE.Color("#86afe8");
              child.material.emissiveIntensity = 0.07;
            }
            child.material.needsUpdate = true;
          }
          if (isHell && child.material && !Array.isArray(child.material)) {
            // Make the hand/cap integrate with the new lighting and boost cap readability.
            child.material.roughness = Math.min(child.material.roughness ?? 1, 0.78);
            child.material.metalness = Math.max(child.material.metalness ?? 0, 0.08);
            const n = String(child.name || "").toLowerCase();
            if (n.includes("cap") || n.includes("coin")) {
              child.material.emissive = new THREE.Color("#5a180d");
              child.material.emissiveIntensity = 0.28;
            } else {
              child.material.emissive = new THREE.Color("#0f0303");
              child.material.emissiveIntensity = 0.11;
            }
            child.material.needsUpdate = true;
          }
        }
      });

      const bbox = new THREE.Box3().setFromObject(demon);
      const center = new THREE.Vector3();
      bbox.getCenter(center);
      demon.position.sub(center);

      demonPivot = new THREE.Group();
      demonPivot.position.set(
        0,
        isJungle ? jungleMenuYDesktop : isBrainrot ? brainrotMenuYDesktop : 1.5,
        -1
      );
      demonPivot.scale.setScalar(isBrainrot ? brainrotMenuScaleDesktop : 10);
      demonPivot.rotation.y = -Math.PI * 0.5;
      demonPivot.add(demon);
      scene.add(demonPivot);

      demonTopLight.target = demonPivot;
      scene.add(demonTopLight.target);
      revealMenu();
    },
    undefined,
    () => {
      revealMenu();
    }
  );

  const playButton = app.querySelector("#menuPlay");
  const collectionButton = app.querySelector("#menuCollection");
  const menuMuteToggleBtn = app.querySelector("#menuMuteToggle");
  const themeSelectEl = app.querySelector("#menuThemeSelect");
  const auraLoginContainer = app.querySelector("#aura-login");
  const auraConnectedStatus = app.querySelector("#auraConnectedStatus");
  const auraHintStatus = app.querySelector("#auraHintStatus");
  const preloader = app.querySelector("#menuPreloader");
  const menuButtons = app.querySelector(".menu-buttons");
  const updateSoundButton = (enabled) => {
    menuMuteToggleBtn.classList.toggle("muted", !enabled);
    menuMuteToggleBtn.textContent = enabled ? "mute: off" : "mute: on";
  };
  const onSoundToggleClick = () => {
    const enabled = onSoundToggle ? onSoundToggle() : menuMuteToggleBtn.classList.contains("muted");
    updateSoundButton(Boolean(enabled));
  };
  const onThemeSelect = () => onThemeChange?.(themeSelectEl?.value || "hell");
  let auraApi = null;
  let connectedActionHandler = null;
  let signinHandler = null;
  let auraSyncInFlight = false;
  let auraSyncBurstTimer = null;
  let auraSyncBurstLeft = 0;
  const isValidAuraClientId = (value) => /^[a-z0-9][a-z0-9_-]{1,63}$/i.test(value);
  const resolveAuraClientId = () => {
    const fromEnv = pickFirstString(import.meta.env?.VITE_AURA_CLIENT_ID);
    const fromWindow = pickFirstString(window.__AURA_CLIENT_ID__);
    const fromMeta = pickFirstString(
      document.querySelector('meta[name="aura-client-id"]')?.getAttribute("content")
    );
    const fromStorageRaw = pickFirstString(
      window.localStorage.getItem(AURA_CLIENT_ID_STORAGE_KEY)
    );
    const hostLabel = pickFirstString(window.location.hostname?.split(".")?.[0]);
    const candidates = [fromEnv, fromWindow, fromMeta, fromStorageRaw, hostLabel];
    const resolved = candidates.find((candidate) => isValidAuraClientId(candidate));
    if (fromStorageRaw && !isValidAuraClientId(fromStorageRaw)) {
      try {
        window.localStorage.removeItem(AURA_CLIENT_ID_STORAGE_KEY);
      } catch {
        // Ignore storage errors.
      }
    }
    return resolved || AURA_DEFAULT_CLIENT_ID;
  };
  const setAuraHint = (message) => {
    if (!auraHintStatus) {
      return;
    }
    const hasMessage = Boolean(String(message || "").trim());
    auraHintStatus.classList.toggle("visible", hasMessage);
    auraHintStatus.textContent = hasMessage ? String(message) : "";
  };

  const extractLikelyPayloads = (input) => {
    const queue = [input];
    const out = [];
    const seen = new Set();
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item || typeof item !== "object" || seen.has(item)) {
        continue;
      }
      seen.add(item);
      out.push(item);
      queue.push(item.result, item.data, item.payload, item.session, item.user);
    }
    return out;
  };

  const normalizeAuraSession = (input) => {
    auraDebugLog("normalizeAuraSession input", input);
    const payloads = extractLikelyPayloads(input);
    let user = null;
    let walletAddress = "";

    for (const payload of payloads) {
      const candidateUser =
        payload?.user ||
        payload?.profile ||
        payload?.account ||
        payload?.data?.user ||
        payload?.data?.profile ||
        payload?.result?.user ||
        payload?.result?.profile ||
        null;
      if (!user && candidateUser && typeof candidateUser === "object") {
        user = candidateUser;
      }

      const candidateWallet = pickFirstString(
        payload?.walletAddress,
        payload?.wallet,
        payload?.address,
        payload?.ethAddress,
        payload?.user?.walletAddress,
        payload?.user?.wallet,
        payload?.user?.address,
        payload?.profile?.walletAddress,
        payload?.profile?.wallet,
        payload?.profile?.address,
        payload?.account?.walletAddress,
        payload?.account?.address,
        Array.isArray(payload?.addresses) ? payload.addresses[0] : "",
        Array.isArray(payload?.user?.addresses) ? payload.user.addresses[0] : ""
      );
      if (!walletAddress && candidateWallet) {
        walletAddress = candidateWallet;
      }
    }

    const hasIdentity =
      Boolean(walletAddress) ||
      Boolean(user) ||
      Boolean(input?.connected) ||
      Boolean(input?.isConnected);
    auraDebugLog("normalizeAuraSession parsed", {
      hasIdentity,
      walletAddress,
      hasUser: Boolean(user),
    });
    if (!hasIdentity) {
      return null;
    }
    return {
      connected: true,
      walletAddress,
      user,
    };
  };

  const clearConnectedActionHandler = () => {
    if (connectedActionHandler) {
      auraLoginContainer?.removeEventListener("click", connectedActionHandler);
      connectedActionHandler = null;
    }
  };

  const clearSigninHandler = () => {
    if (signinHandler) {
      auraLoginContainer?.removeEventListener("click", signinHandler);
      signinHandler = null;
    }
  };

  const stopAuraSyncBurst = () => {
    if (auraSyncBurstTimer !== null) {
      clearInterval(auraSyncBurstTimer);
      auraSyncBurstTimer = null;
    }
    auraSyncBurstLeft = 0;
  };

  const renderAuraConnectedAction = () => {
    if (!auraLoginContainer) {
      return;
    }
    clearConnectedActionHandler();
    clearSigninHandler();
    auraLoginContainer.classList.remove("hidden");
    auraLoginContainer.innerHTML =
      '<button id="auraProfileBtn" class="theme-btn aura-disconnect-btn" type="button">profile</button>';
    connectedActionHandler = async (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest("#auraProfileBtn")) {
        return;
      }
      onProfile?.();
    };
    auraLoginContainer.addEventListener("click", connectedActionHandler);
  };

  const renderAuraSignin = () => {
    if (!auraLoginContainer) {
      return;
    }
    clearConnectedActionHandler();
    clearSigninHandler();
    auraLoginContainer.classList.remove("hidden");
    auraLoginContainer.innerHTML = "";
    signinHandler = async () => {
      try {
        if (!auraApi) {
          auraApi = await loadAuraSdk();
          auraDebugLog("Aura SDK loaded", Object.keys(auraApi || {}));
        }
        const clientId = resolveAuraClientId();
        auraDebugLog("sign-in requested", { clientId });
        setAuraHint(`Aura login ready (${clientId})`);
        if (clientId === AURA_DEFAULT_CLIENT_ID) {
          setAuraHint("Aura clientId is not configured. Set VITE_AURA_CLIENT_ID.");
        }
        try {
          window.localStorage.setItem(AURA_CLIENT_ID_STORAGE_KEY, clientId);
        } catch {
          // Ignore storage errors.
        }

        if (typeof auraApi?.SigninButton === "function") {
          auraDebugLog("mounting Aura.SigninButton");
          auraApi.SigninButton({
            container: "#aura-login",
            clientId,
            mode: "light",
            text: "log in",
            onClose(error) {
              auraDebugLog("Aura.SigninButton onClose", error);
              setAuraHint(error?.message || "Aura login closed.");
              readAuraSessionFromSdk().then((restoredFromSdk) => {
                auraDebugLog("onClose restoredFromSdk", restoredFromSdk);
                if (restoredFromSdk) {
                  applyConnectedSession(restoredFromSdk);
                  setAuraHint("");
                  return;
                }
                startAuraSyncBurst();
              });
            },
            onError(error) {
              auraDebugLog("Aura.SigninButton onError", error);
              setAuraHint(error?.message || "Aura login failed.");
              startAuraSyncBurst();
            },
            onSuccess(result) {
              auraDebugLog("Aura.SigninButton onSuccess", result);
              const normalized = applyConnectedSession(result);
              if (normalized) {
                setAuraHint("");
                return;
              }
              readAuraSessionFromSdk().then((restoredFromSdk) => {
                auraDebugLog("SigninButton fallback restoredFromSdk", restoredFromSdk);
                if (restoredFromSdk) {
                  applyConnectedSession(restoredFromSdk);
                  setAuraHint("");
                }
              });
            },
          });
          startAuraSyncBurst();
          return;
        }

        auraLoginContainer.innerHTML =
          '<button id="auraSigninBtn" class="theme-btn aura-login-fallback" type="button">log in</button>';
        const fallbackBtn = auraLoginContainer.querySelector("#auraSigninBtn");
        fallbackBtn?.addEventListener(
          "click",
          async () => {
            if (typeof auraApi?.signIn !== "function") {
              return;
            }
            const result = await auraApi.signIn({
              auraOrigin: AURA_ORIGIN,
              clientId,
              mode: "light",
            });
            auraDebugLog("Aura.signIn fallback result", result);
            applyConnectedSession(result);
          },
          { once: true }
        );
      } catch {
        auraDebugLog("sign-in failed, starting sync burst");
        setAuraHint("Aura popup closed but no auth callback received.");
        startAuraSyncBurst();
      }
    };
    signinHandler();
  };

  const readAuraSessionFromSdk = async () => {
    if (!auraApi) {
      return null;
    }

    let normalized = null;
    if (typeof auraApi.getSession === "function") {
      const session = await safeCall(auraApi.getSession, auraApi);
      auraDebugLog("Aura.getSession()", session);
      normalized = normalizeAuraSession(session);
      if (normalized) {
        return normalized;
      }
    }

    if (typeof auraApi.getCurrentUser === "function") {
      const user = await safeCall(auraApi.getCurrentUser, auraApi);
      auraDebugLog("Aura.getCurrentUser()", user);
      normalized = normalizeAuraSession({ user });
      if (normalized) {
        return normalized;
      }
    }

    if (typeof auraApi.getWalletAddress === "function") {
      const walletAddress = await safeCall(auraApi.getWalletAddress, auraApi);
      auraDebugLog("Aura.getWalletAddress()", walletAddress);
      normalized = normalizeAuraSession({ walletAddress });
      if (normalized) {
        return normalized;
      }
    }

    if (typeof auraApi.getUser === "function") {
      const user = await safeCall(auraApi.getUser, auraApi);
      auraDebugLog("Aura.getUser()", user);
      normalized = normalizeAuraSession({ user });
      if (normalized) {
        return normalized;
      }
    }

    return null;
  };

  const applyConnectedSession = (sessionLike) => {
    const normalized = normalizeAuraSession(sessionLike);
    if (!normalized) {
      auraDebugLog("applyConnectedSession skipped: no normalized session");
      return null;
    }
    auraDebugLog("applyConnectedSession success", normalized);
    localAuraSession = normalized;
    setAuraConnectedStatus(normalized);
    setAuraHint("");
    onAuraSuccess?.(normalized);
    renderAuraConnectedAction();
    stopAuraSyncBurst();
    return normalized;
  };

  const syncAuraSessionFromSdk = async () => {
    if (!auraApi || auraSyncInFlight) {
      return null;
    }
    auraSyncInFlight = true;
    try {
      const normalized = await readAuraSessionFromSdk();
      if (normalized) {
        return applyConnectedSession(normalized);
      }
      if (hasConnectedSession(localAuraSession)) {
        localAuraSession = null;
        onAuraDisconnect?.();
        setAuraConnectedStatus(null);
        setAuraHint("Not connected. Use Login with Aura.");
        renderAuraSignin();
      }
      return null;
    } catch {
      return null;
    } finally {
      auraSyncInFlight = false;
    }
  };

  const startAuraSyncBurst = () => {
    stopAuraSyncBurst();
    auraSyncBurstLeft = 50;
    auraSyncBurstTimer = setInterval(async () => {
      auraSyncBurstLeft -= 1;
      const synced = await syncAuraSessionFromSdk();
      if (synced || auraSyncBurstLeft <= 0) {
        stopAuraSyncBurst();
      }
    }, 1500);
  };

  const setAuraConnectedStatus = (sessionLike) => {
    if (!auraConnectedStatus) {
      return;
    }
    const connected = Boolean(sessionLike?.walletAddress || sessionLike?.user || sessionLike?.connected);
    auraConnectedStatus.classList.toggle("visible", connected);
    auraConnectedStatus.textContent = connected ? formatAuraStatus(sessionLike) : "";
  };

  const onAuraMessage = (event) => {
    const origin = String(event.origin || "");
    const isAuraOrigin =
      origin === AURA_ORIGIN ||
      origin.endsWith(".auramaxx.gg") ||
      origin.includes("auramaxx.gg");
    if (!isAuraOrigin) {
      return;
    }
    const type = event.data?.type;
    auraDebugLog("window message", { origin, type, data: event.data });
    setAuraHint(`Aura message: ${type || "unknown"} from ${origin}`);
    const payload =
      event.data?.result ??
      event.data?.data ??
      event.data?.payload ??
      event.data;
    const looksLikeAuraLogin =
      type === "aura.login.result" ||
      String(type || "").includes("aura") ||
      Boolean(payload?.walletAddress || payload?.user || payload?.authenticated);
    if (!looksLikeAuraLogin) {
      return;
    }
    applyConnectedSession(payload);
  };
  menuMuteToggleBtn.addEventListener("click", onSoundToggleClick);
  playButton.addEventListener("click", onPlay);
  collectionButton.addEventListener("click", onCollection);
  themeSelectEl?.addEventListener("change", onThemeSelect);
  menuButtons.classList.add("disabled");

  if (!hasConnectedSession(auraSession)) {
    auraDebugLog("initial state: disconnected");
    loadAuraSdk()
    .then(async (Aura) => {
      auraApi = Aura;
      const restored = await syncAuraSessionFromSdk();
      if (restored) {
        setAuraHint("");
        return;
      }
      setAuraHint("Not connected. Use Login with Aura.");
      renderAuraSignin();
    })
    .catch(() => {
      setAuraHint("Failed to load Aura SDK.");
      renderAuraSignin();
    });
  } else {
    auraDebugLog("initial state: connected from app session", auraSession);
    localAuraSession = auraSession;
    setAuraConnectedStatus(localAuraSession);
    setAuraHint("");
    loadAuraSdk()
      .then((Aura) => {
        auraApi = Aura;
        syncAuraSessionFromSdk();
      })
      .catch(() => {});
    renderAuraConnectedAction();
  }

  const onWindowFocus = () => {
    syncAuraSessionFromSdk();
  };
  window.addEventListener("focus", onWindowFocus);
  window.addEventListener("message", onAuraMessage);
  document.addEventListener("visibilitychange", onWindowFocus);

  const revealMenu = () => {
    preloader.classList.add("hidden");
    menuButtons.classList.remove("disabled");
  };

  const onPointerMove = (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    if (!titleMesh) {
      hoverTarget = 0;
      return;
    }

    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObject(titleMesh, false);
    if (hits.length > 0 && hits[0].uv) {
      hoverTarget = 1;
      titleUniforms.iMouse.value.copy(hits[0].uv);
      return;
    }

    // Fallback: screen-space hover zone around the title.
    titleScreen.copy(titleMesh.position).project(camera);
    const sx = (titleScreen.x * 0.5 + 0.5) * rect.width + rect.left;
    const sy = (-titleScreen.y * 0.5 + 0.5) * rect.height + rect.top;
    const dx = event.clientX - sx;
    const dy = event.clientY - sy;
    const inZone = Math.abs(dx) < 420 && Math.abs(dy) < 140;
    hoverTarget = inZone ? 1 : 0;
    if (inZone) {
      const u = THREE.MathUtils.clamp((dx + 420) / 840, 0, 1);
      const v = THREE.MathUtils.clamp(1 - (dy + 140) / 280, 0, 1);
      titleUniforms.iMouse.value.set(u, v);
    }
  };

  window.addEventListener("pointermove", onPointerMove);

  let rafId = null;
  let running = true;
  let composer = null;
  let bloomPass = null;
  const useMenuPost = (isHell || isHeaven) && window.innerWidth > 680;
  if (useMenuPost) {
    // Restrained bloom for theme-specific emissive accents.
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      isHeaven ? HEAVEN_MENU_TUNING.bloomStrength : HELL_MENU_TUNING.bloomStrength,
      isHeaven ? HEAVEN_MENU_TUNING.bloomRadius : HELL_MENU_TUNING.bloomRadius,
      isHeaven ? HEAVEN_MENU_TUNING.bloomThreshold : HELL_MENU_TUNING.bloomThreshold
    );
    composer.addPass(bloomPass);
  }

  const animate = () => {
    if (!running) {
      return;
    }
    rafId = requestAnimationFrame(animate);
    const t = performance.now() * 0.001;
    titleUniforms.iTime.value = t;
    titleUniforms.iHover.value = THREE.MathUtils.lerp(
      titleUniforms.iHover.value,
      hoverTarget,
      0.2
    );
    if (titleMesh) {
      titleMesh.position.y = 8.3 + Math.sin(t * 1.8) * 0.2;
      titleMesh.rotation.y = Math.sin(t * 0.55) * 0.08;
    }
    if (hellBackground) {
      hellBackground.uniforms.iTime.value = t;
    }
    if (menuTextureSphere) {
      menuTextureSphere.mesh.rotation.y = Math.PI / 2 + t * 0.018;
    }
    if (heavenBackground) {
      heavenBackground.uniforms.iTime.value = t;
    }
    if (heavenCloudBase) {
      heavenCloudBase.uniforms.iTime.value = t;
    }
    if (heavenMotes) {
      heavenMotes.uniforms.iTime.value = t;
    }
    if (hellGround) {
      hellGround.uniforms.iTime.value = t;
    }
    if (jungleGround) {
      jungleGround.waterRing.rotation.z = t * 0.12;
    }
    if (brainrotGround) {
      brainrotGround.uniforms.iTime.value = t;
      brainrotGround.ring.rotation.z = t * 0.55;
    }
    if (hellEmbers) {
      hellEmbers.uniforms.iTime.value = t;
    }
    controls.update();
    if (composer) {
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
  };

  const handleResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) {
      composer.setSize(window.innerWidth, window.innerHeight);
    }
    if (bloomPass) {
      bloomPass.setSize(window.innerWidth, window.innerHeight);
    }
    titleUniforms.iResolution.value.set(window.innerWidth, window.innerHeight);
    updateResponsiveLayout();
  };

  const updateResponsiveLayout = () => {
    const isMobile = window.innerWidth <= 640;
    if (titleMesh) {
      titleMesh.scale.setScalar(isMobile ? 0.43 : 1);
      titleMesh.position.y = isMobile ? 9.25 : 8.3;
    }
    if (demonPivot) {
      const scale = isBrainrot
        ? isMobile
          ? brainrotMenuScaleMobile
          : brainrotMenuScaleDesktop
        : isMobile
          ? 8.2
          : 10;
      demonPivot.scale.setScalar(scale);
      const y = isJungle
        ? isMobile
          ? jungleMenuYMobile
          : jungleMenuYDesktop
        : isBrainrot
          ? isMobile
            ? brainrotMenuYMobile + 0.08
            : brainrotMenuYDesktop + 0.14
          : isMobile
            ? 1.05
            : 1.5;
      demonPivot.position.set(0, y, -1);
    }
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
    window.removeEventListener("focus", onWindowFocus);
    window.removeEventListener("message", onAuraMessage);
    document.removeEventListener("visibilitychange", onWindowFocus);
    playButton.removeEventListener("click", onPlay);
    collectionButton.removeEventListener("click", onCollection);
    menuMuteToggleBtn.removeEventListener("click", onSoundToggleClick);
    themeSelectEl?.removeEventListener("change", onThemeSelect);
    clearConnectedActionHandler();
    clearSigninHandler();
    stopAuraSyncBurst();
    window.removeEventListener("pointermove", onPointerMove);
    controls.dispose();
    dracoLoader.dispose();
    ktx2Loader.dispose();
    composer?.dispose();
    menuTextureSphere?.mesh.geometry.dispose();
    menuTextureSphere?.mesh.material.dispose();
    menuTextureSphere?.texture.dispose();
    hellBackground?.mesh.geometry.dispose();
    hellBackground?.mesh.material.dispose();
    heavenBackground?.mesh.geometry.dispose();
    heavenBackground?.mesh.material.dispose();
    heavenCloudBase?.mesh.geometry.dispose();
    heavenCloudBase?.mesh.material.dispose();
    heavenMotes?.points.geometry.dispose();
    heavenMotes?.points.material.dispose();
    hellGround?.mesh.geometry.dispose();
    hellGround?.mesh.material.dispose();
    hellGround?.basePlate?.geometry.dispose();
    hellGround?.basePlate?.material.dispose();
    hellGround?.baseCore?.geometry.dispose();
    hellGround?.baseCore?.material.dispose();
    for (const chunk of hellGround?.rockChunks ?? []) {
      chunk.geometry.dispose();
    }
    for (const child of jungleGround?.group.children ?? []) {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
    for (const child of brainrotGround?.group.children ?? []) {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
    hellEmbers?.points.geometry.dispose();
    hellEmbers?.points.material.dispose();
    if (heavenRimLight) scene.remove(heavenRimLight);
    if (heavenBounceLight) scene.remove(heavenBounceLight);
    if (heavenAccentLight) scene.remove(heavenAccentLight);
    if (hellUnderLight) scene.remove(hellUnderLight);
    if (hellRimLight) scene.remove(hellRimLight);
    if (hellBackLight) scene.remove(hellBackLight);
    renderer.dispose();
  };
}
