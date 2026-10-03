import * as THREE from 'three';
import { createStingray } from './render/stingray';

// Standalone inspection page for the Stingray model (model.html).
//
// Query params:
//   ?angle=<deg>  fix the orbit angle (otherwise the camera orbits slowly)
//   ?elev=<deg>   camera elevation above the horizontal (default 15)
//   ?spin=1       spin the ratchet drive
//
// Angle convention (camera around the model, which points its nose at −Z):
//   0   = camera on −X, looking at the PORT side (nose on the left, like stingray.png)
//   90  = camera on +Z, behind the stern (the chase view)
//   180 = camera on +X, starboard side
//   270 = camera on −Z, head-on
//
// window.__viewer.render(angleDeg, elevDeg) positions the camera, fixes the orbit there and
// renders synchronously — works in a hidden tab, where requestAnimationFrame is paused.

declare global {
  interface Window {
    __viewer?: { render(angleDeg: number, elevDeg: number): void };
  }
}

const DISTANCE = 34;
const TARGET = new THREE.Vector3(0, 1.5, 0);
const ORBIT_DEG_PER_SECOND = 12;
const DRIVE_RADIANS_PER_SECOND = 3;

const params = new URLSearchParams(location.search);
const fixedAngle = params.has('angle') ? Number(params.get('angle')) : null;
let elevation = Number(params.get('elev') ?? 15);
const spin = params.get('spin') === '1';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd0ee);
scene.add(new THREE.HemisphereLight(0xdff2ff, 0x40566a, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-20, 40, 15);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.5, 500);
const stingray = createStingray();
scene.add(stingray.group);

let angle = fixedAngle ?? 0;
let orbiting = fixedAngle === null;
let driveAngle = 0;

function draw(angleDeg: number, elevDeg: number): void {
  const a = THREE.MathUtils.degToRad(angleDeg);
  const e = THREE.MathUtils.degToRad(elevDeg);
  camera.position.set(
    TARGET.x - DISTANCE * Math.cos(a) * Math.cos(e),
    TARGET.y + DISTANCE * Math.sin(e),
    TARGET.z + DISTANCE * Math.sin(a) * Math.cos(e),
  );
  camera.lookAt(TARGET);
  stingray.setDriveSpin(driveAngle);
  renderer.render(scene, camera);
}

window.__viewer = {
  render(angleDeg, elevDeg) {
    orbiting = false;
    angle = angleDeg;
    elevation = elevDeg;
    draw(angle, elevation);
  },
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  draw(angle, elevation);
});

draw(angle, elevation); // one frame now, even if the tab is hidden

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (orbiting) angle += ORBIT_DEG_PER_SECOND * dt;
  if (spin) driveAngle += DRIVE_RADIANS_PER_SECOND * dt;
  draw(angle, elevation);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
