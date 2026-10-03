import * as THREE from 'three';
import { installDebugHandle } from './debug';
import type { GameMode, ModeController } from './game/mode';
import { PilotingMode } from './game/piloting';
import { listenKeyboard } from './input/raw';
import { createStepper } from './loop';
import { createChaseCamera } from './render/chase-camera';
import { createCombatView } from './render/combat-view';
import { createCraft } from './render/craft';
import { createHud } from './render/hud';
import { createLandmarks } from './render/landmarks';
import { createMarineville } from './render/marineville';
import { createMotes } from './render/motes';
import { createParticles } from './render/particles';
import { createSea } from './render/sea';
import { createSeabed } from './render/seabed';
import { targetsLeft } from './sim/combat';
import { forwardOf, speedOf } from './sim/sub';
import { FIXED_DT, createWorld } from './sim/world';

const KNOTS_PER_MS = 1.943844;
const DEG = 180 / Math.PI;
const compass = (degrees: number) => ((degrees % 360) + 360) % 360;

const seed = Number(new URLSearchParams(location.search).get('seed') ?? 1964) || 1964;
const world = createWorld(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.5, 8000);

const sea = createSea(world);
scene.add(sea.group);

scene.add(createSeabed(world), createLandmarks(world), createMarineville());

const motes = createMotes();
scene.add(motes.points);

const particles = createParticles();
scene.add(particles.points);

const craft = createCraft(particles);
scene.add(craft.group);

const chase = createChaseCamera(camera, world.seabedHeight);
const hud = createHud(document.body);
const keyboard = listenKeyboard(window);
window.addEventListener('keydown', () => hud.dismissLegend(), { once: true });

// One scene, one world: modes swap controllers, nothing reloads.
const modeName: GameMode = 'piloting';
const piloting = new PilotingMode();
const mode: ModeController = piloting;
mode.enter(world);

const combatView = createCombatView(world, piloting.combat, particles);
scene.add(combatView.group);

const RETICLE_RANGE = 150; // metres ahead of the nose
const aim = new THREE.Vector3();

const stepper = createStepper((dt) => mode.step(keyboard.held, dt), FIXED_DT);

let elapsed = 0;
function draw(alpha: number, frameSeconds: number): void {
  const target = craft.update(piloting.lastState, piloting.state, alpha, piloting.input, frameSeconds);
  if (piloting.jumped) {
    chase.snap(target);
    piloting.jumped = false;
  } else {
    chase.update(target, frameSeconds);
  }
  combatView.update(piloting.combat, frameSeconds);
  particles.update(frameSeconds);
  sea.update(camera, scene, elapsed);
  motes.update(camera, elapsed);

  const s = piloting.state;
  const home = world.marineville.tunnelMouth;
  hud.update({
    depthMetres: -s.pos.y,
    speedKnots: speedOf(s) * KNOTS_PER_MS,
    // North is -Z and yaw grows counter-clockwise, so the compass heading is -yaw.
    headingDegrees: compass(-s.yaw * DEG),
    homeBearingDegrees: compass(Math.atan2(home.x - s.pos.x, -(home.z - s.pos.z)) * DEG),
    homeDistanceMetres: Math.hypot(home.x - s.pos.x, home.y - s.pos.y, home.z - s.pos.z),
    targetsLeft: targetsLeft(piloting.combat),
    targetsTotal: world.targets.length,
    airborne: s.medium === 'airborne',
  });

  // The reticle marks where the nose points, 150 m ahead.
  const nose = forwardOf(target.yaw, target.pitch);
  aim.set(target.pos.x + nose.x * RETICLE_RANGE, target.pos.y + nose.y * RETICLE_RANGE, target.pos.z + nose.z * RETICLE_RANGE);
  camera.updateMatrixWorld();
  aim.project(camera);
  hud.reticle.hidden = aim.z > 1;
  hud.reticle.style.left = `${(aim.x * 0.5 + 0.5) * 100}%`;
  hud.reticle.style.top = `${(-aim.y * 0.5 + 0.5) * 100}%`;

  renderer.render(scene, camera);
}

installDebugHandle({
  mode: () => modeName,
  steps: () => piloting.steps,
  state: () => piloting.state,
  combat: () => piloting.combat,
  teleport: (pos, yaw) => {
    piloting.place({
      pos: { ...pos }, vel: { x: 0, y: 0, z: 0 }, yaw: yaw ?? piloting.state.yaw, pitch: 0, medium: pos.y > 0 ? 'airborne' : 'submerged',
    });
  },
  setInput: (input) => { piloting.override = input; },
  advance: (seconds) => {
    const steps = Math.round(seconds / FIXED_DT);
    // Draw every few steps so the camera and effects follow as they would at 60 fps.
    for (let i = 0; i < steps; i++) {
      mode.step(keyboard.held, FIXED_DT);
      elapsed += FIXED_DT;
      if (i % 2 === 1 || i === steps - 1) draw(1, FIXED_DT * 2);
    }
  },
  camera: () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z }),
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const frame = Math.min((now - last) / 1000, 0.1);
  last = now;
  elapsed += frame;
  const alpha = stepper.advance(frame);
  draw(alpha, frame);
});
