import * as THREE from 'three';

// Soft additive glow sprites for lamps, eyes and flashes: one shared falloff texture.

let haloTexture: THREE.Texture | null = null;

/** A soft round falloff; a plain white texel outside a browser (node tests have no canvas). */
export function halo(): THREE.Texture {
  if (haloTexture) return haloTexture;
  if (typeof document === 'undefined') {
    haloTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    haloTexture.needsUpdate = true;
    return haloTexture;
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  haloTexture = new THREE.CanvasTexture(canvas);
  return haloTexture;
}

export function glowMaterial(color: number, opacity = 0.55): THREE.SpriteMaterial {
  return new THREE.SpriteMaterial({
    map: halo(),
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
}

export function glow(color: number, size: number, opacity = 0.55): THREE.Sprite {
  const sprite = new THREE.Sprite(glowMaterial(color, opacity));
  sprite.scale.setScalar(size);
  return sprite;
}
