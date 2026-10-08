import * as THREE from 'three';
import { createAudio } from './audio/audio';
import { clampAdvance, installDebugHandle, runScript, viewParam } from './debug';
import { dockView } from './game/dock';
import { Game, startState } from './game/game';
import { mappingOf } from './game/mode';
import { CLOSED, type MenuEvent, type MenuState, Swallow, menuEventFor, menuOn, openMenu, titleOnLoad } from './game/menu';
import { initialMemory, panelView, remember } from './game/panel';
import { pressFor } from './input/pilot';
import { troyPressFor, yawOfView } from './input/troy';
import { listenKeyboard } from './input/raw';
import { createStepper, frameTimes } from './loop';
import { addCaustics } from './render/caustics';
import { createCameraRig } from './render/camera-rig';
import { createCombatView } from './render/combat-view';
import { createCraft } from './render/craft';
import { createDockGuide } from './render/dock-guide';
import { createFollowCamera, troyAt } from './render/follow-camera';
import { createFpsReadout } from './render/fps';
import { createHud } from './render/hud';
import { createInteractView } from './render/interact';
import { oceanInView } from './render/indoors';
import { createLandmarks } from './render/landmarks';
import { createLaunchPanel } from './render/launch-panel';
import { initialLegend, legendOn, legendSituation, legendTick } from './render/legend';
import { createMarineville } from './render/marineville';
import { createMenu } from './render/menu';
import {
  initialOrbit, orbitBy, orbitDrag, orbitFromParam, orbitRecenter, orbitRelease, orbitTakeYaw, orbitTick, orbitView, orbitZoom, KEY_RATE,
} from './render/orbit';
import { createMotes } from './render/motes';
import { createParticles } from './render/particles';
import { createPen } from './render/pen';
import { createRooms } from './render/rooms';
import { createSea } from './render/sea';
import { createSeabed } from './render/seabed';
import { createTroy } from './render/troy';
import { createTunnel } from './render/tunnel';
import { updateScenery } from './render/sway';
import { targetsLeft } from './sim/combat';
import { INTERACTABLES } from './sim/interactables';
import { ROOMS } from './sim/rooms';
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
// Phase 3 (M4): Troy's follow camera has the view whenever the session mode is 'onFoot'; the rig keeps updating in
// every mode (its springs stay warm) and has the view otherwise — riding too, until T7's ride camera.
const follow = createFollowCamera(camera, ROOMS);
const RIG_NEAR = camera.near;
// Troy's rooms and Troy (phase 3, T1 greybox): the rooms are outside the ocean side and drawn only while the camera is
// in them (render/rooms.ts); their lamp stays in the scene and dims. Troy (M8, render/troy.ts) is drawn on foot and riding.
const rooms = createRooms(ROOMS);
scene.add(rooms.group, rooms.lamp);
const troy = createTroy();
scene.add(troy.group);
// Witnessing (debug): ?view=x,y,z,lookX,lookY,lookZ fixes the camera there, ignoring the rig; ?view=control,
// corridor or lounge are the rooms' presets (debug.ts VIEW_PRESETS).
const viewNumbers = viewParam(params.get('view'));
const viewFrom = viewNumbers
  ? [new THREE.Vector3(viewNumbers[0], viewNumbers[1], viewNumbers[2]), new THREE.Vector3(viewNumbers[3], viewNumbers[4], viewNumbers[5])] as const
  : null;
const hud = createHud(document.body);
// M5: the use prompt, the prop's glow (props tagged userData.interactable under the rooms) and the flavour line.
const interact = createInteractView(rooms.group, hud, INTERACTABLES);

// One scene, one world, one GameState for the session (game.ts); the mode is derived from it and changes only
// what is drawn. L4: the game starts in standby in Pen 3 (the control room from T8); ?start=control and ?start=ocean
// (or ?at=…) start there instead. Phase 3 (M3, M9): R returns to the control room from anywhere.
const game = new Game(world, startState(world, params));

// The key legend's timing (T8, render/legend.ts).
let legend = initialLegend();

// The launch panel (L6): its decisions are pure (game/panel.ts); its memory is presentation only.
let panelMemory = initialMemory(game.state);
const launchPanel = createLaunchPanel(document.body, (control) => game.press(control));
// The docking guide (T6): on the way home, from the tunnel's last bend to the lock.
const dockGuide = createDockGuide(document.body);

// T9: orbit the camera around the craft (render/orbit.ts) — drag on the game view or J/L/I/K, the wheel zooms, C or
// a double-click re-centres. ?orbit=yawDeg,pitchDeg[,zoom] (witnessing) starts orbited.
let orbit = orbitFromParam(params.get('orbit')) ?? initialOrbit();

// M3: which keys press what is the session mode's when the key goes down — aboard 1–4 are the launch controls; on
// foot E is 'use' (aboard it stays climb, read by toSubInput); riding nothing presses.
const keyboard = listenKeyboard(window, (code) => {
  const mapping = mappingOf(game.mode);
  const press = mapping === 'aboard' ? pressFor(code) : mapping === 'onFoot' ? troyPressFor(code) : null;
  if (press) game.press(press);
  if (code === 'KeyC') orbit = orbitRecenter(orbit);
});
// M4: the orbit is reset to centre whenever play goes onto or off foot, so no on-foot offset carries over to the
// sub's views or back.
let wasOnFoot = game.mode === 'onFoot';
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
  // M9: the Controls page shows the current mode's card.
  menuView.update(menu, audio.muted, legendSituation(game.mode, game.state.launch.clamps));
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
const lookDir = new THREE.Vector3();
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
  const mode = game.mode;
  const onFoot = mode === 'onFoot';
  const enteredFoot = onFoot && !wasOnFoot;
  if (onFoot !== wasOnFoot) orbit = initialOrbit();
  wasOnFoot = onFoot;
  // The orbit: keys while held, the drive-away (on foot, walk-away) return, nothing while a menu is up.
  if (menu.kind !== null) {
    orbit = orbitRelease(orbit);
    drag = null;
  } else {
    const held = keyboard.held;
    // M3: on foot the arrows orbit too (aboard ↑ ↓ are dive / climb and ← → nothing).
    const arrows = onFoot ? { left: held.has('ArrowLeft'), right: held.has('ArrowRight'), up: held.has('ArrowUp'), down: held.has('ArrowDown') } : null;
    const swing = (held.has('KeyJ') || arrows?.left ? 1 : 0) - (held.has('KeyL') || arrows?.right ? 1 : 0);
    const lift = (held.has('KeyI') || arrows?.up ? 1 : 0) - (held.has('KeyK') || arrows?.down ? 1 : 0);
    if (swing !== 0 || lift !== 0) orbit = orbitBy(orbit, swing * KEY_RATE * frameSeconds, lift * KEY_RATE * frameSeconds);
    const i = game.input;
    // M4: on foot the ease-back is fed "Troy is moving", where aboard it is the sub's driving input.
    const moving = onFoot ? g.troy.speed > 0 : i.throttle !== 0 || i.yaw !== 0 || i.pitch !== 0;
    orbit = orbitTick(orbit, frameSeconds, moving);
    // M4: walking, he goes the way the camera looks — so the orbit's yaw becomes the follow camera's heading (the pose
    // does not move) rather than an offset its heading would chase him round with (orbit.ts orbitTakeYaw).
    if (onFoot && g.troy.speed > 0) {
      const taken = orbitTakeYaw(orbit);
      orbit = taken.orbit;
      follow.turn(taken.yaw);
    }
  }
  const penView = {
    cradle: game.lastState.launch.cradle + (g.launch.cradle - game.lastState.launch.cradle) * alpha,
    clamps: g.launch.clamps,
    craftYaw: target.yaw,
    guide: dock === null ? 'off' as const : dock.ready ? 'ready' as const : 'on' as const,
  };
  // The rig runs in every mode (M4: its springs stay warm); on foot the orbit is Troy's, not the sub's.
  const view = orbitView(orbit);
  camera.near = RIG_NEAR;
  const jumped = game.jumped;
  if (jumped) {
    rig.snap(target, g.launch.clamps, onFoot ? undefined : view);
    pen.snap(penView);
    game.jumped = false;
  } else {
    rig.update(target, g.launch.clamps, frameSeconds, onFoot ? undefined : view);
  }
  if (onFoot) {
    // M4: the follow camera, written after the rig. It snaps on jumps (R, the menu, ?start=, walkTo) and on coming onto
    // foot (standing up — T7/T9 may blend that).
    const troyNow = troyAt(game.lastState.troy, g.troy, alpha);
    if (jumped || enteredFoot) follow.snap(troyNow, view);
    else follow.update(troyNow, frameSeconds, view);
  }
  if (viewFrom) {
    camera.position.copy(viewFrom[0]);
    camera.lookAt(viewFrom[1]);
  }
  // M3: the drawn camera's yaw, for the next steps' on-foot mapping (W = away from the camera).
  game.cameraYaw = yawOfView(camera.getWorldDirection(lookDir), game.cameraYaw);
  rooms.update(camera);
  // M8: Troy animates on the frame's wall time (the sit blend, the breath) and fades when the camera is on top of him.
  troy.pose(g.troy, alpha, game.lastState.troy, { dt: frameSeconds, camera, snap: jumped });
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
  // M9: the card is the mode's; the sub's readouts (and the reticle) show only aboard.
  hud.showLegend(legend.shown, legendSituation(mode, g.launch.clamps));
  hud.showReadouts(mode === 'piloting' || mode === 'launch');
  interact.update(g);

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
  // Orbited, the reticle would sit wherever the nose happens to point across the view: hidden until it returns.
  hud.reticle.hidden = aim.z > 1 || orbit.weight > 0;
  hud.reticle.style.left = `${(aim.x * 0.5 + 0.5) * 100}%`;
  hud.reticle.style.top = `${(-aim.y * 0.5 + 0.5) * 100}%`;

  renderer.render(scene, camera);
}

// Orbit by mouse: only drags that start on the game view itself (the panel, the guide and the menu are not it).
// Pointer capture keeps a drag that leaves the window ending cleanly; a click without movement does nothing.
const canvas = renderer.domElement;
const DRAG_START_PX = 4;
let drag: { id: number; x: number; y: number; moved: boolean } | null = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (menu.kind !== null || drag || (e.button !== 0 && e.button !== 2)) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id || menu.kind !== null) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < DRAG_START_PX) return;
  drag.moved = true;
  drag.x = e.clientX;
  drag.y = e.clientY;
  orbit = orbitDrag(orbit, dx, dy);
});
const endDrag = (e: PointerEvent) => {
  if (!drag || e.pointerId !== drag.id) return;
  drag = null;
  orbit = orbitRelease(orbit);
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('lostpointercapture', endDrag);
canvas.addEventListener('dblclick', () => {
  if (menu.kind === null) orbit = orbitRecenter(orbit);
});
canvas.addEventListener('wheel', (e) => {
  if (menu.kind !== null) return;
  e.preventDefault();
  orbit = orbitZoom(orbit, e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1));
}, { passive: false });

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
  troy: () => game.state.troy,
  rooms: () => ROOMS,
  walkTo: (x, z) => game.walkTo(x, z),
  use: () => game.press('use'),
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
