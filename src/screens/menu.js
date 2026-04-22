import * as THREE from "three";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const AURA_ORIGIN = "https://auramaxx.gg";
const AURA_SDK_URL = `${AURA_ORIGIN}/login-with-aura/sdk.js`;
const AURA_CLIENT_ID_STORAGE_KEY = "aura_client_id";
const AURA_DEBUG_KEY = "aura_debug";

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
    if (window.__AURA_DEBUG__ === true) {
      console.log("[AURA]", ...args);
      return;
    }
    const enabled = window.localStorage.getItem(AURA_DEBUG_KEY) === "1";
    if (enabled) {
      console.log("[AURA]", ...args);
    }
  } catch {
    // Ignore logging failures.
  }
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
        <button id="menuProfile" class="menu-btn" type="button">profile</button>
      </div>
      <div id="auraConnectedStatus" class="menu-aura-status ${auraSession?.connected ? "visible" : ""}">
        ${auraSession?.connected ? formatAuraStatus(auraSession) : ""}
      </div>
    </div>
  `;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
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
  const bgColor = isHeaven
    ? "#8ccfff"
    : isJungle
      ? "#8edcb4"
      : isBrainrot
        ? "#25003a"
        : "#170807";
  scene.background = new THREE.Color(bgColor);
  scene.fog = new THREE.Fog(bgColor, 18, 58);

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    120
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
  scene.add(floor);

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

      float distToMouse = distance(uv, iMouse);
      float mouseFlare = exp(-distToMouse * 10.0) * iHover * 2.2;
      brighterColor.rgb += vec3(1.0, 0.35, 0.0) * mouseFlare * 0.8;
      middleColor.rgb += vec3(1.0, 0.25, 0.05) * mouseFlare * 0.65;

      float noiseTexel = pnoise(pos, 10.0, 5, 0.5);
      noiseTexel += mouseFlare * 0.6;

      float firstStep = smoothstep(0.0, noiseTexel, gradient);
      float darkerColorStep = smoothstep(0.0, noiseTexel, gradient - gradientStep);
      float darkerColorPath = firstStep - darkerColorStep;
      vec4 color = mix(brighterColor, darkerColor, darkerColorPath);
      float middleColorStep = smoothstep(0.0, noiseTexel, gradient - 0.4);
      color = mix(color, middleColor, darkerColorStep - middleColorStep);
      color = mix(vec4(0.0), color, firstStep);
      color.rgb += vec3(1.0, 0.58, 0.2) * mouseFlare * 0.6;

      gl_FragColor = color;
    }
  `;
  const heavenFragmentShader = `
    uniform float iTime;
    uniform vec2 iResolution;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;
      vec3 top = vec3(0.23, 0.56, 0.95);
      vec3 bottom = vec3(0.86, 0.94, 1.0);
      vec3 sky = mix(bottom, top, clamp(uv.y, 0.0, 1.0));

      float t = iTime * 0.08;
      float c1 = sin((uv.x * 7.0 + t) + sin(uv.y * 6.0)) * 0.5 + 0.5;
      float c2 = sin((uv.x * 12.0 - t * 1.4) + cos(uv.y * 9.0)) * 0.5 + 0.5;
      float clouds = smoothstep(0.58, 0.9, c1 * 0.62 + c2 * 0.38);

      vec3 color = mix(sky, vec3(0.98, 0.99, 1.0), clouds * 0.5);
      gl_FragColor = vec4(color, 1.0);
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
  const profileButton = app.querySelector("#menuProfile");
  const menuMuteToggleBtn = app.querySelector("#menuMuteToggle");
  const themeSelectEl = app.querySelector("#menuThemeSelect");
  const auraLoginContainer = app.querySelector("#aura-login");
  const auraConnectedStatus = app.querySelector("#auraConnectedStatus");
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
  let disconnectHandler = null;
  let signinHandler = null;
  let auraSyncInFlight = false;
  let auraSyncBurstTimer = null;
  let auraSyncBurstLeft = 0;
  const resolveAuraClientId = () => {
    const fromWindow = pickFirstString(window.__AURA_CLIENT_ID__);
    const fromMeta = pickFirstString(
      document.querySelector('meta[name="aura-client-id"]')?.getAttribute("content")
    );
    const fromStorage = pickFirstString(
      window.localStorage.getItem(AURA_CLIENT_ID_STORAGE_KEY)
    );
    const fromHostname =
      window.location.hostname && window.location.hostname !== "localhost"
        ? `aura-caps-${window.location.hostname}`
        : "";
    return fromWindow || fromMeta || fromStorage || fromHostname || "your-app";
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

  const clearDisconnectHandler = () => {
    if (disconnectHandler) {
      auraLoginContainer?.removeEventListener("click", disconnectHandler);
      disconnectHandler = null;
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

  const renderAuraDisconnect = () => {
    if (!auraLoginContainer) {
      return;
    }
    clearDisconnectHandler();
    clearSigninHandler();
    auraLoginContainer.classList.remove("hidden");
    auraLoginContainer.innerHTML =
      '<button id="auraDisconnectBtn" class="theme-btn aura-disconnect-btn" type="button">disconnect</button>';
    disconnectHandler = async (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest("#auraDisconnectBtn")) {
        return;
      }
      try {
        if (auraApi && typeof auraApi.SignOut === "function") {
          auraDebugLog("disconnect via Aura.SignOut");
          await auraApi.SignOut();
        } else if (auraApi && typeof auraApi.signOut === "function") {
          auraDebugLog("disconnect via Aura.signOut");
          await auraApi.signOut();
        }
      } catch {
        // Ignore sign-out API errors, local disconnect still applies.
      }
      onAuraDisconnect?.();
      auraDebugLog("local disconnect completed");
      setAuraConnectedStatus(null);
      renderAuraSignin();
    };
    auraLoginContainer.addEventListener("click", disconnectHandler);
  };

  const renderAuraSignin = () => {
    if (!auraLoginContainer) {
      return;
    }
    clearDisconnectHandler();
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
            onSuccess(result) {
              auraDebugLog("Aura.SigninButton onSuccess", result);
              const normalized = applyConnectedSession(result);
              if (normalized) {
                return;
              }
              readAuraSessionFromSdk().then((restoredFromSdk) => {
                auraDebugLog("SigninButton fallback restoredFromSdk", restoredFromSdk);
                if (restoredFromSdk) {
                  applyConnectedSession(restoredFromSdk);
                }
              });
            },
          });
          startAuraSyncBurst();
          return;
        }

        auraLoginContainer.innerHTML =
          '<button id="auraSigninBtn" class="theme-btn aura-login-fallback" type="button">log in with aura</button>';
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
    setAuraConnectedStatus(normalized);
    onAuraSuccess?.(normalized);
    renderAuraDisconnect();
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
      return normalized ? applyConnectedSession(normalized) : null;
    } catch {
      return null;
    } finally {
      auraSyncInFlight = false;
    }
  };

  const startAuraSyncBurst = () => {
    stopAuraSyncBurst();
    auraSyncBurstLeft = 15;
    auraSyncBurstTimer = setInterval(async () => {
      auraSyncBurstLeft -= 1;
      const synced = await syncAuraSessionFromSdk();
      if (synced || auraSyncBurstLeft <= 0) {
        stopAuraSyncBurst();
      }
    }, 1200);
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
  profileButton?.addEventListener("click", onProfile);
  themeSelectEl?.addEventListener("change", onThemeSelect);
  menuButtons.classList.add("disabled");

  if (!hasConnectedSession(auraSession)) {
    auraDebugLog("initial state: disconnected");
    loadAuraSdk()
    .then(async (Aura) => {
      auraApi = Aura;
      const restored = await syncAuraSessionFromSdk();
      if (restored) {
        return;
      }
      renderAuraSignin();
    })
    .catch(() => {
      renderAuraSignin();
    });
  } else {
    auraDebugLog("initial state: connected from app session", auraSession);
    setAuraConnectedStatus(auraSession);
    loadAuraSdk()
      .then((Aura) => {
        auraApi = Aura;
        syncAuraSessionFromSdk();
      })
      .catch(() => {});
    renderAuraDisconnect();
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
    controls.update();
    renderer.render(scene, camera);
  };

  const handleResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
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
    profileButton?.removeEventListener("click", onProfile);
    menuMuteToggleBtn.removeEventListener("click", onSoundToggleClick);
    themeSelectEl?.removeEventListener("change", onThemeSelect);
    clearDisconnectHandler();
    clearSigninHandler();
    stopAuraSyncBurst();
    window.removeEventListener("pointermove", onPointerMove);
    controls.dispose();
    dracoLoader.dispose();
    ktx2Loader.dispose();
    renderer.dispose();
  };
}
