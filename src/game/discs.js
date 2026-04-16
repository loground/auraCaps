import * as THREE from "three";

export function loadDiscTexture(renderer, path) {
  const textureLoader = new THREE.TextureLoader();
  const texture = textureLoader.load(path);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.center.set(0.5, 0.5);
  texture.repeat.set(1, 1);
  texture.offset.set(0, 0);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

export function createDiscMesh({
  radius,
  height,
  sideColor,
  topFaceMap = null,
  bottomFaceMap = null,
}) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 64);
  const materials = [
    new THREE.MeshStandardMaterial({
      color: sideColor,
      roughness: 0.48,
      metalness: 0.28,
    }),
    new THREE.MeshStandardMaterial({
      color: "#ffffff",
      map: topFaceMap,
      roughness: 0.42,
      metalness: 0.1,
    }),
    new THREE.MeshStandardMaterial({
      color: "#ffffff",
      map: bottomFaceMap,
      roughness: 0.42,
      metalness: 0.1,
    }),
  ];

  const mesh = new THREE.Mesh(geometry, materials);
  return mesh;
}

export function setDiscFaceTextures({ mesh, topFaceMap, bottomFaceMap }) {
  const materials = mesh.material;
  if (!Array.isArray(materials) || materials.length < 3) {
    return;
  }

  materials[1].map = topFaceMap;
  materials[1].needsUpdate = true;
  materials[2].map = bottomFaceMap;
  materials[2].needsUpdate = true;
}
