import * as THREE from "three";

export function applyCenterCropToTexture(texture) {
  if (!texture) return texture;
  const applyCrop = () => {
    const width = texture.image?.naturalWidth || texture.image?.videoWidth || texture.image?.width;
    const height =
      texture.image?.naturalHeight || texture.image?.videoHeight || texture.image?.height;
    if (!width || !height) return;
    if (width > height) {
      texture.repeat.set(height / width, 1);
    } else {
      texture.repeat.set(1, width / height);
    }
    texture.offset.set((1 - texture.repeat.x) * 0.5, (1 - texture.repeat.y) * 0.5);
    texture.needsUpdate = true;
  };
  texture.userData = { ...(texture.userData || {}), centerCrop: true };
  if (texture.image) {
    applyCrop();
  } else {
    const applyCropOnce = () => {
      texture.removeEventListener("update", applyCropOnce);
      applyCrop();
    };
    texture.addEventListener("update", applyCropOnce);
  }
  return texture;
}

export function loadDiscTexture(renderer, path, { centerCrop = false } = {}) {
  const textureLoader = new THREE.TextureLoader();
  const texture = textureLoader.load(path);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.center.set(0.5, 0.5);
  texture.repeat.set(1, 1);
  texture.offset.set(0, 0);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.userData = { ...(texture.userData || {}), sourcePath: path };
  if (centerCrop) {
    applyCenterCropToTexture(texture);
  }
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
