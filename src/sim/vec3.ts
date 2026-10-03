// The sim's vector type: a plain object, never THREE.Vector3 (src/sim stays free of three.js).
export type Vec3 = { x: number; y: number; z: number };

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
