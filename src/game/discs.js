import * as THREE from "three";

export function createYinYangTexture(renderer) {
  const textureLoader = new THREE.TextureLoader();
  const texture = textureLoader.load("/yingyang.png");
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.center.set(0.5, 0.5);
  texture.repeat.set(1, 1);
  texture.offset.set(0, 0);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

export function createDiscMesh({ radius, height, sideColor, redFaceTexture }) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 64);
  const materials = [
    new THREE.MeshStandardMaterial({
      color: sideColor,
      roughness: 0.48,
      metalness: 0.28,
    }),
    new THREE.MeshStandardMaterial({
      color: "#29c96f",
      roughness: 0.42,
      metalness: 0.1,
    }),
    new THREE.MeshStandardMaterial({
      color: "#ffffff",
      map: redFaceTexture,
      roughness: 0.42,
      metalness: 0.1,
    }),
  ];

  const mesh = new THREE.Mesh(geometry, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
