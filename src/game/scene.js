import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FLOOR_RADIUS, TABLE_RADIUS } from "./constants.js";

export function createRenderer(app) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  app.appendChild(renderer.domElement);
  return renderer;
}

export function createWorldScene(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1b0706");

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
  controls.maxDistance = 28;
  controls.maxPolarAngle = Math.PI * 0.495;

  const ambientLight = new THREE.AmbientLight(0xffccb3, 0.73);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffd2b0, 1.49);
  directionalLight.position.set(8, 14, 8);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.set(1024, 1024);
  scene.add(directionalLight);

  const floorMaterial = new THREE.MeshStandardMaterial({
    color: "#263049",
    metalness: 0.05,
    roughness: 0.78,
  });
  const floorMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(FLOOR_RADIUS, FLOOR_RADIUS + 1, 0.4, 96),
    floorMaterial
  );
  floorMesh.position.y = -0.2;
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);

  const tableMaterial = new THREE.MeshStandardMaterial({
    color: "#111827",
    metalness: 0.1,
    roughness: 0.88,
  });
  const tableMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS + 0.4, 0.24, 96),
    tableMaterial
  );
  tableMesh.position.y = 0.12;
  tableMesh.receiveShadow = true;
  scene.add(tableMesh);

  return {
    scene,
    camera,
    controls,
    floorMesh,
    tableMesh,
    floorMaterial,
    tableMaterial,
  };
}
