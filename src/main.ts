import * as THREE from 'three';
import { createAudio } from './audio/audio';
import { clampAdvance, installDebugHandle, runScript } from './debug';
import { Game, launchStatus } from './game/game';
import { pressFor } from './input/pilot';
import { listenKeyboard } from './input/raw';
import { createStepper } from './loop';
import { addCaustics } from './render/caustics';
import { createCameraRig } from './render/camera-rig';
import { createCombatView } from './render/combat-view';
import { createCraft } from './render/craft';
import { createHud } from './render/hud';
import { createLandmarks } from './render/landmarks';
import { createMarineville } from './render/marineville';
import { createMotes } from './render/motes';
import { createParticles } from './render/particles';
import { createPen } from './render/pen';
import { createSea } from './render/sea';
import { createSeabed } from './render/seabed';
import { createTunnel } from './render/tunnel';
import { updateScenery } from './render/sway';
import { targetsLeft } from './sim/combat';
import { oceanStart, standby } from './sim/launch';
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
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
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

const params = new URLSearchParams(location.search);

// Pen 3 and its cradle (phase 2, T3); the camera rig blends the pen camera and phase 1's chase camera.
const pen = createPen(world.marineville.interior);
scene.add(pen.root);
pen.reflect(craft.group);
// The launch tunnel and the ocean door (phase 2, T4): the bore is culled when it could not be seen.
const tunnel = createTunnel(world.marineville.interior);
scene.add(tunnel.root);
const rig = createCameraRig(camera, world);
// Witnessing (debug): ?view=x,y,z,lookX,lookY,lookZ fixes the camera there, ignoring the rig.
const viewNumbers = params.get('view')?.split(',').map(Number);
const viewFrom = viewNumbers?.length === 6 && viewNumbers.every(Number.isFinite)
  ? [new THREE.Vector3(...viewNumbers.slice(0, 3)), new THREE.Vector3(...viewNumbers.slice(3))] as const
  : null;
const hud = createHud(document.body);

// One scene, one world, one GameState for the session (game.ts); the mode is derived from it and changes only
// what is drawn. Until the pen and tunnel are drawn (phase 2, T5) the game starts at sea and R returns there;
// ?start=pen opts in to starting docked in the (undrawn) pen, with R returning to standby.
const startInPen = params.get('start') === 'pen' && !params.has('at');
const game = startInPen ? new Game(world, standby(world), 'standby') : new Game(world, oceanStart(world), 'spawn');

const keyboard = listenKeyboard(window, (code) => {
  const control = pressFor(code);
  if (control) game.press(control);
});
window.addEventListener('keydown', () => hud.dismissLegend(), { once: true });

// L7: sound hears every fixed step's pair and sets its continuous sounds once per drawn frame; M mutes.
const audio = createAudio(window);
game.onStep = (previous, current) => audio.step(previous, current);

const combatView = createCombatView(world, game.state.combat, particles);
scene.add(combatView.group);
addCaustics(scene);

const RETICLE_RANGE = 150; // metres ahead of the nose
const aim = new THREE.Vector3();

// ?at=x,y,z&yaw=degrees&pitch=degrees starts the sub there (at rest) — for inspecting a view or taking a screenshot.
const at = params.get('at')?.split(',').map(Number);
if (at && at.length === 3 && at.every(Number.isFinite)) {
  const [x = 0, y = 0, z = 0] = at;
  game.place({
    pos: { x, y, z },
    vel: { x: 0, y: 0, z: 0 },
    yaw: (Number(params.get('yaw') ?? 0) * Math.PI) / 180,
    pitch: (Number(params.get('pitch') ?? 0) * Math.PI) / 180,
    medium: y > 0 ? 'airborne' : 'submerged',
  });
}

const stepper = createStepper((dt) => game.step(keyboard.held, dt), FIXED_DT);

let elapsed = 0;
function draw(alpha: number, frameSeconds: number): void {
  const g = game.state;
  const target = craft.update(game.lastState.sub, g.sub, alpha, game.input, frameSeconds, g.launch.engines !== 'off');
  const penView = {
    cradle: game.lastState.launch.cradle + (g.launch.cradle - game.lastState.launch.cradle) * alpha,
    clamps: g.launch.clamps,
    craftYaw: target.yaw,
  };
  if (game.jumped) {
    rig.snap(target, g.launch.clamps);
    pen.snap(penView);
    game.jumped = false;
  } else {
    rig.update(target, g.launch.clamps, frameSeconds);
  }
  if (viewFrom) {
    camera.position.copy(viewFrom[0]);
    camera.lookAt(viewFrom[1]);
  }
  pen.update(camera, penView, frameSeconds, elapsed);
  const door = game.lastState.launch.door + (g.launch.door - game.lastState.launch.door) * alpha;
  tunnel.update(camera, { door, doorMoving: g.launch.doorDir !== 0 }, elapsed);
  combatView.update(g.combat, frameSeconds);
  particles.update(frameSeconds);
  sea.update(camera, scene, elapsed);
  motes.update(camera, elapsed);
  updateScenery(elapsed, camera, scene);

  const s = g.sub;
  const home = world.marineville.tunnelMouth;
  hud.update({
    depthMetres: -s.pos.y,
    speedKnots: speedOf(s) * KNOTS_PER_MS,
    // North is -Z and yaw grows counter-clockwise, so the compass heading is -yaw.
    headingDegrees: compass(-s.yaw * DEG),
    homeBearingDegrees: compass(Math.atan2(home.x - s.pos.x, -(home.z - s.pos.z)) * DEG),
    homeDistanceMetres: Math.hypot(home.x - s.pos.x, home.y - s.pos.y, home.z - s.pos.z),
    targetsLeft: targetsLeft(g.combat),
    targetsTotal: world.targets.length,
    // L3: the airborne marker is hidden while the clamps hold the sub.
    airborne: s.medium === 'airborne' && g.launch.clamps === 'released',
    status: game.mode === 'launch' ? launchStatus(g) : null,
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
  mode: () => game.mode,
  steps: () => game.steps,
  state: () => game.state.sub,
  combat: () => game.state.combat,
  launch: () => game.state.launch,
  press: (control) => game.press(control),
  teleport: (pos, yaw) => {
    game.place({
      pos: { ...pos }, vel: { x: 0, y: 0, z: 0 }, yaw: yaw ?? game.state.sub.yaw, pitch: 0, medium: pos.y > 0 ? 'airborne' : 'submerged',
    });
  },
  setInput: (input) => { game.override = input; },
  advance: (seconds) => {
    const steps = Math.round(clampAdvance(seconds) / FIXED_DT);
    // Draw every few steps so the camera and effects follow as they would at 60 fps.
    for (let i = 0; i < steps; i++) {
      game.step(keyboard.held, FIXED_DT);
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

// Witnessing (debug): ?script=cradle,8,engines,2.1,clamps,1 presses controls and advances the sim before the first
// frame (a control name presses it, a number runs that many seconds); ?hold then keeps the sim still while frames
// draw, so a screenshot shows exactly the scripted moment; ?stats writes the renderer's counts into the page.
const script = params.get('script');
if (script) runScript(script, window.__stingray!);
const hold = params.has('hold');
const stats = params.has('stats') ? document.body.appendChild(document.createElement('pre')) : null;
if (stats) {
  stats.id = 'stats';
  renderer.info.autoReset = false; // the pool's reflection is a nested render: count the whole frame

  Object.assign(stats.style, { position: 'fixed', left: '8px', bottom: '8px', margin: '0', color: '#fff', font: '11px monospace' });
}

let last = performance.now();
renderer.setAnimationLoop((now) => {
  // rAF's timestamp can precede `last` on the first frame (after a long scripted advance): never run time backwards,
  // which would fling the camera's springs.
  const frame = THREE.MathUtils.clamp((now - last) / 1000, 0, 0.1);
  last = now;
  elapsed += frame;
  const alpha = hold ? 1 : stepper.advance(frame);
  if (stats) renderer.info.reset();
  draw(alpha, frame);
  audio.frame(game.state);
  if (stats) {
    const { calls, triangles } = renderer.info.render;
    stats.textContent = `calls ${calls}  triangles ${triangles}  programs ${renderer.info.programs?.length ?? 0}  camera ${camera.position.toArray().map((n) => n.toFixed(1)).join(',')}  pen view ${rig.penWeight().toFixed(2)}`;
  }
});
