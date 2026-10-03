import * as THREE from 'three';

// One pooled point cloud for every short-lived effect: bubbles, spray, explosion sparks.
// Cosmetic only — it may use Math.random; nothing in the sim reads it.

export interface Burst {
  x: number; y: number; z: number;
  count: number;
  /** Speed range of each particle, metres per second. */
  speed: [number, number];
  /** Base velocity added to every particle. */
  vx?: number; vy?: number; vz?: number;
  life: [number, number];
  size: number;
  color: number;
  /** Vertical acceleration: positive rises (bubbles), negative falls (spray). */
  lift: number;
  /** Keep particles under the surface (bubbles stop at y = 0). */
  underwater?: boolean;
}

export interface Particles {
  readonly points: THREE.Points;
  emit(burst: Burst): void;
  update(dtSeconds: number): void;
}

export function createParticles(capacity = 3000): Particles {
  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const velocity = new Float32Array(capacity * 3);
  const life = new Float32Array(capacity);
  const maxLife = new Float32Array(capacity);
  const lift = new Float32Array(capacity);
  const baseSize = new Float32Array(capacity);
  const underwater = new Uint8Array(capacity);
  let next = 0;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: { scale: { value: 600 } },
    vertexShader: `
      attribute float size;
      uniform float scale;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * scale / max(-mv.z, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(vColor, smoothstep(0.5, 0.15, d) * 0.85);
      }`,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  const tint = new THREE.Color();

  return {
    points,
    emit(b) {
      tint.setHex(b.color);
      for (let n = 0; n < b.count; n++) {
        const i = next;
        next = (next + 1) % capacity;
        // Random direction on a sphere.
        const u = Math.random() * 2 - 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(1 - u * u);
        const s = b.speed[0] + Math.random() * (b.speed[1] - b.speed[0]);
        positions[i * 3] = b.x;
        positions[i * 3 + 1] = b.y;
        positions[i * 3 + 2] = b.z;
        velocity[i * 3] = r * Math.cos(a) * s + (b.vx ?? 0);
        velocity[i * 3 + 1] = u * s + (b.vy ?? 0);
        velocity[i * 3 + 2] = r * Math.sin(a) * s + (b.vz ?? 0);
        const l = b.life[0] + Math.random() * (b.life[1] - b.life[0]);
        life[i] = l;
        maxLife[i] = l;
        lift[i] = b.lift;
        baseSize[i] = b.size * (0.6 + Math.random() * 0.8);
        underwater[i] = b.underwater ? 1 : 0;
        colors[i * 3] = tint.r;
        colors[i * 3 + 1] = tint.g;
        colors[i * 3 + 2] = tint.b;
      }
    },
    update(dt) {
      const drag = Math.exp(-1.6 * dt);
      for (let i = 0; i < capacity; i++) {
        const remaining = life[i] ?? 0;
        if (remaining <= 0) {
          sizes[i] = 0;
          continue;
        }
        life[i] = remaining - dt;
        const vx = (velocity[i * 3] ?? 0) * drag;
        const vy = (velocity[i * 3 + 1] ?? 0) * drag + (lift[i] ?? 0) * dt;
        const vz = (velocity[i * 3 + 2] ?? 0) * drag;
        velocity[i * 3] = vx;
        velocity[i * 3 + 1] = vy;
        velocity[i * 3 + 2] = vz;
        positions[i * 3] = (positions[i * 3] ?? 0) + vx * dt;
        let y = (positions[i * 3 + 1] ?? 0) + vy * dt;
        if (underwater[i] && y > -0.2) {
          y = -0.2;
          life[i] = Math.min(life[i] ?? 0, 0.15);
        }
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = (positions[i * 3 + 2] ?? 0) + vz * dt;
        const t = Math.max((life[i] ?? 0) / (maxLife[i] || 1), 0);
        sizes[i] = (baseSize[i] ?? 0) * Math.sqrt(t);
      }
      geometry.attributes.position!.needsUpdate = true;
      geometry.attributes.size!.needsUpdate = true;
      geometry.attributes.color!.needsUpdate = true;
    },
  };
}
