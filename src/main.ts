import * as THREE from 'three';
import { installDebugHandle } from './debug';
import type { GameMode, ModeController } from './game/mode';
import { PilotingMode } from './game/piloting';
import { listenKeyboard } from './input/raw';
import { createStepper } from './loop';
import { createSea } from './render/sea';
import { FIXED_DT, createWorld } from './sim/world';

const seed = Number(new URLSearchParams(location.search).get('seed') ?? 1964) || 1964;
const world = createWorld(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 8000);
camera.position.set(0, -30, 0);
camera.lookAt(0, -32, -100);

const sea = createSea(world);
scene.add(sea.group);

const keyboard = listenKeyboard(window);

// One scene, one world: modes swap controllers, nothing reloads.
const modeName: GameMode = 'piloting';
const piloting = new PilotingMode();
const mode: ModeController = piloting;
mode.enter(world);

const stepper = createStepper((dt) => mode.step(keyboard.held, dt), FIXED_DT);

let elapsed = 0;
function draw(): void {
  sea.update(camera, scene, elapsed);
  renderer.render(scene, camera);
}

installDebugHandle({
  mode: () => modeName,
  steps: () => piloting.steps,
  camera: () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z }),
  setCameraY: (y) => { camera.position.y = y; },
  advance: (seconds) => {
    const steps = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < steps; i++) mode.step(keyboard.held, FIXED_DT);
    elapsed += steps * FIXED_DT;
    draw();
  },
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const frame = (now - last) / 1000;
  last = now;
  elapsed += frame;
  stepper.advance(frame);
  draw();
});
