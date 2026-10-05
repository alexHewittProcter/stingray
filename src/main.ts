import * as THREE from 'three';
import { createAudio } from './audio/audio';
import { clampAdvance, installDebugHandle, runScript } from './debug';
import { dockView } from './game/dock';
import { Game, startState } from './game/game';
import { CLOSED, type MenuEvent, type MenuState, Swallow, menuEventFor, menuOn, openMenu, titleOnLoad } from './game/menu';
import { initialMemory, panelView, remember } from './game/panel';
import { pressFor } from './input/pilot';
import { listenKeyboard } from './input/raw';
import { createStepper, frameTimes } from './loop';
import { addCaustics } from './render/caustics';
import { createCameraRig } from './render/camera-rig';
import { createCombatView } from './render/combat-view';
import { createCraft } from './render/craft';
import { createDockGuide } from './render/dock-guide';
import { createFpsReadout } from './render/fps';
import { createHud } from './render/hud';
import { oceanInView } from './render/indoors';
import { createLandmarks } from './render/landmarks';
import { createLaunchPanel } from './render/launch-panel';
import { initialLegend, legendOn, legendTick } from './render/legend';
import { createMarineville } from './render/marineville';
import { createMenu } from './render/menu';
import { createMotes } from './render/motes';
import { createParticles } from './render/particles';
import { createPen } from './render/pen';
import { createSea } from './render/sea';
import { createSeabed } from './render/seabed';
import { createTunnel } from './render/tunnel';
import { updateScenery } from './render/sway';
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
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.5, 8000);

const sea = createSea(world);
scene.add(sea.group);

// The ocean side: drawn only when it could be seen (T6) — from inside Marineville, only through a door that is not
// shut (indoors.ts oceanInView). Behind the shut door it was hundreds of draw calls and most of the triangles.
const oceanSide: THREE.Object3D[] = [createSeabed(world), createLandmarks(world), createMarineville()];
scene.add(...oceanSide);

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
// what is drawn. L4: the game starts in standby in Pen 3; ?start=ocean (or ?at=…) starts at phase 1's spawn.
// R returns to standby from anywhere, either way.
const game = new Game(world, startState(world, params));

// The key legend's timing (T8, render/legend.ts).
let legend = initialLegend();

// The launch panel (L6): its decisions are pure (game/panel.ts); its memory is presentation only.
let panelMemory = initialMemory(game.state);
const launchPanel = createLaunchPanel(document.body, (control) => game.press(control));
// The docking guide (T6): on the way home, from the tunnel's last bend to the lock.
const dockGuide = createDockGuide(document.body);

const keyboard = listenKeyboard(window, (code) => {
  const control = pressFor(code);
  if (control) game.press(control);
});
// The legend (T9, render/legend.ts): back whenever no key has been touched for a moment, gone on the next press;
// H pins it. Keys only — the mouse does not count. (Menu keys never get here: the menu's listener keeps them.)
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  legend = legendOn(legend, e.code === 'KeyH' ? 'help' : 'key');
});

// L7: sound hears every fixed step's pair and sets its continuous sounds once per drawn frame; M mutes.
const audio = createAudio(window);
game.onStep = (previous, current) => audio.step(previous, current);

// The menus (T9, game/menu.ts): the title over the live Pen 3 standby on load, the pause menu on Esc. An overlay on
// the one world, never a separate screen. While one is up the sim does not step (frameTimes) and the keys only
// move through it: a capture listener on the window sees every key first and keeps menu keys from the game, the
// legend and the sound's M; the key that closes a menu is swallowed until it is released, so Space on Resume does
// not also fire and Enter on Launch does not press anything.
let menu: MenuState = titleOnLoad(params) ? openMenu('title') : CLOSED;
const swallow = new Swallow();
const menuView = createMenu(document.body, (e) => menuEvent(e));
function menuEvent(e: MenuEvent): void {
  const { state, action } = menuOn(menu, e);
  menu = state;
  if (action === 'standby') game.toStandby();
  else if (action === 'ocean') game.toOcean();
  else if (action === 'toggleSound') audio.toggleMute();
  showMenu();
}
function showMenu(): void {
  audio.setPaused(menu.kind === 'pause');
  menuView.update(menu, audio.muted);
}
window.addEventListener('keydown', (e) => {
  if (swallow.down(e.code)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  if (menu.kind === null) {
    if (e.code !== 'Escape' || e.repeat) return;
    e.stopImmediatePropagation();
    swallow.add(e.code);
    menuEvent({ type: 'pause' });
    return;
  }
  e.preventDefault();
  e.stopImmediatePropagation();
  audio.gesture();
  if (e.code === 'KeyM' && !e.repeat) {
    audio.toggleMute();
    showMenu();
    return;
  }
  const event = menuEventFor(e.code);
  // Held arrows step through the items; a held Enter or Esc acts once.
  if (!event || (e.repeat && event.type !== 'up' && event.type !== 'down')) return;
  menuEvent(event);
  if (menu.kind === null) swallow.add(e.code);
}, { capture: true });
window.addEventListener('keyup', (e) => swallow.up(e.code), { capture: true });
// Losing the window pauses play — except under the witness tooling or an explicit ?menu=, whose driven pages must
// never stop on their own.
const pauseOnBlur = !['script', 'at', 'start', 'hold', 'view', 'menu'].some((k) => params.has(k));
window.addEventListener('blur', () => {
  swallow.clear();
  if (pauseOnBlur && menu.kind === null) menuEvent({ type: 'pause' });
});
showMenu();

const combatView = createCombatView(world, game.state.combat, particles);
scene.add(combatView.group);
oceanSide.push(combatView.group);
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
  panelMemory = remember(panelMemory, g);
  const panel = panelView(g, panelMemory, world.marineville.interior);
  const dock = dockView(g, panelMemory, world.marineville.interior);
  const target = craft.update(game.lastState.sub, g.sub, alpha, game.input, frameSeconds, g.launch.engines !== 'off', g.launch.clamps === 'locked');
  const penView = {
    cradle: game.lastState.launch.cradle + (g.launch.cradle - game.lastState.launch.cradle) * alpha,
    clamps: g.launch.clamps,
    craftYaw: target.yaw,
    guide: dock === null ? 'off' as const : dock.ready ? 'ready' as const : 'on' as const,
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
  const ocean = oceanInView(camera.position, door);
  for (const o of oceanSide) o.visible = ocean;
  // Every detonation since the last frame, not only the last step's: a frame that runs two steps keeps both (T8).
  combatView.update({ ...g.combat, detonations: game.takeDetonations() }, frameSeconds);
  particles.update(frameSeconds);
  sea.update(camera, scene, elapsed);
  motes.update(camera, elapsed);
  updateScenery(elapsed, camera, scene);

  launchPanel.update(panel);
  dockGuide.update(dock);
  legend = legendTick(legend, frameSeconds, { held: keyboard.held.size > 0, menu: menu.kind !== null });
  hud.showLegend(legend.shown, g.launch.clamps === 'locked' ? 'docked' : 'driving');

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
    clamped: g.launch.clamps === 'locked',
    status: panel.status,
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
  menu: () => menu.kind,
  closeMenu: () => {
    menu = CLOSED;
    showMenu();
  },
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
// ?menu=pause (witnessing): open the pause menu over the scripted moment.
if (params.get('menu') === 'pause') {
  menu = openMenu('pause');
  showMenu();
}
const hold = params.has('hold');
const stats = params.has('stats') ? document.body.appendChild(document.createElement('pre')) : null;
// ?fps: the on-screen frame-rate readout (T8) for measuring a real window; off by default.
const fps = params.has('fps') ? createFpsReadout(document.body) : null;
// The pool's reflection is a nested render: count the whole frame.
if (stats || fps) renderer.info.autoReset = false;
if (stats) {
  stats.id = 'stats';

  Object.assign(stats.style, { position: 'fixed', left: '8px', bottom: '8px', margin: '0', color: '#fff', font: '11px monospace' });
}

// The game starts in the pen with the door shut, so the ocean side is not drawn until the door first opens: compile
// its programs now, so that first opening does not stall on shader compiles.
// (The fog must be set first: it is part of every program.)
for (const o of oceanSide) o.visible = true;
sea.update(camera, scene, elapsed);
renderer.compile(scene, camera);

let last = performance.now();
renderer.setAnimationLoop((now) => {
  // rAF's timestamp can precede `last` on the first frame (after a long scripted advance): never run time backwards,
  // which would fling the camera's springs.
  const wallMs = now - last;
  // ?hold freezes the scripted moment whole: no sim steps and no effect, water or camera time either, so a
  // screenshot taken seconds later still shows a detonation's flash or a splash as the script left it.
  // A menu stops the sim too (T9): the title keeps the water and light alive; the pause menu freezes the frame.
  const time = frameTimes(wallMs / 1000, { hold, menu: menu.kind });
  last = now;
  elapsed += time.effects;
  const alpha = hold ? 1 : stepper.advance(time.sim);
  if (stats || fps) renderer.info.reset();
  draw(alpha, time.effects);
  audio.frame(game.state);
  if (fps) fps.frame(wallMs, renderer.info.render.calls, renderer.info.render.triangles);
  if (stats) {
    const { calls, triangles } = renderer.info.render;
    stats.textContent = `calls ${calls}  triangles ${triangles}  programs ${renderer.info.programs?.length ?? 0}  camera ${camera.position.toArray().map((n) => n.toFixed(1)).join(',')}  pen view ${rig.penWeight().toFixed(2)}`;
  }
});
