// The docking guide (phase 2, L6 "dock guidance on the HUD", T6): a small instrument on the right of the screen,
// shown on the way home from the tunnel's last stretch to the lock. DOM and SVG only; every number and the hint come
// from the pure view-model in game/dock.ts.
//
//   - The scope: the pen seen from above, the craft's nose up. The craft is the solid shape in the middle; the
//     cradle's berth is the dashed outline of the same shape, where the cradle would hold her, turned to the pen's
//     axis; the ring round the berth is the lock zone at the craft's height (it shrinks when she is too high or low).
//     The small diamond is where she would come to rest if the pilot let go of W now.
//   - The height bar beside it: the berth's level across the middle, the craft's marker above or below it.
//   - Speed (in knots, as the HUD) with the 3 m/s (5.8 kn) lock limit marked; alignment; the one thing to do next — green with "PRESS 3" exactly
//     when the sim would accept the lock.

import type { DockView } from '../game/dock';
import { TUNING as T } from '../sim/tuning';

export interface DockGuide {
  update(view: DockView | null): void;
}

const SCOPE = 170; // px
const SCOPE_M = 16; // metres from the centre to the scope's edge at true scale
const PX = SCOPE / 2 / SCOPE_M; // px per metre
const BAR_M = 8; // metres either side of the berth's level on the height bar
const SPEED_MAX = 8; // m/s across the speed bar
/** The HUD reads speed in knots; the guide does too, so the two agree. */
const KNOTS = 1.943844;

const STYLE = `
.dg { position: fixed; right: 18px; top: 50%; transform: translateY(-58%); z-index: 1; pointer-events: none;
  padding: 10px 12px 11px; width: 236px; box-sizing: border-box; color: #e8f6ff;
  font: 600 12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; text-shadow: 0 1px 3px rgba(0,20,40,.9);
  background: rgba(4,24,40,.55); border: 1px solid rgba(160,220,255,.35); border-radius: 6px;
  transition: border-color .2s ease, box-shadow .2s ease; }
.dg[hidden] { display: none; }
.dg.ready { border-color: rgba(90,240,120,.9); box-shadow: 0 0 14px rgba(70,240,100,.45); }
.dg-head { display: flex; justify-content: space-between; letter-spacing: .1em; margin-bottom: 6px; }
.dg-label { opacity: .7; font-weight: 400; }
.dg-dist { font-size: 15px; }
.dg-row { display: flex; gap: 6px; align-items: stretch; }
.dg svg { display: block; overflow: visible; }
.dg-meter { display: flex; align-items: center; gap: 6px; margin-top: 7px; }
.dg-meter .dg-label { width: 3.6em; }
.dg-track { position: relative; flex: 1; height: 8px; border-radius: 4px; background: rgba(255,255,255,.12); }
.dg-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 4px; background: #ffb12a; }
.dg-tick { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: #e8f6ff; }
.dg-val { width: 5.2em; text-align: right; white-space: nowrap; }
.ok { color: #6be37c; }
.bad { color: #ffb12a; }
.dg-fill.ok { background: #52ef6b; }
.dg-hint { margin-top: 8px; padding: 5px 6px; border-radius: 4px; text-align: center; letter-spacing: .06em;
  background: rgba(0,0,0,.35); color: #ffe066; min-height: 2.6em; display: grid; place-items: center; }
.dg.ready .dg-hint { background: rgba(40,170,70,.85); color: #fff; text-shadow: 0 1px 2px rgba(0,40,10,.8);
  animation: dg-pulse 1s ease-in-out infinite; }
@keyframes dg-pulse { 0%, 100% { filter: brightness(1.15); } 50% { filter: brightness(.8); } }
`;

// The craft from above, nose up (−y), in metres: a 26 m hull with its swept fins and tailplanes.
const CRAFT_PATH = [
  'M 0 -13', 'L 1.4 -9.5', 'L 1.9 -2', 'L 6.2 3.2', 'L 6.2 4.6', 'L 2.1 3.4', 'L 2 9.5', 'L 4.6 12.2', 'L 4.6 13',
  'L -4.6 13', 'L -4.6 12.2', 'L -2 9.5', 'L -2.1 3.4', 'L -6.2 4.6', 'L -6.2 3.2', 'L -1.9 -2', 'L -1.4 -9.5', 'Z',
].join(' ');

const svgEl = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/** Metres shown true to scale from the centre; beyond, the scope compresses toward its rim (at SCOPE_FAR). */
const SCOPE_NEAR = 11;
const SCOPE_FAR = 60;

/**
 * Metres in the craft's frame (x to starboard, y astern) to px from the scope's centre: true scale out to
 * SCOPE_NEAR, then compressed so the berth stays on the scope out to SCOPE_FAR; past that it sits on the rim.
 */
function toScope(x: number, y: number, edge: number): [number, number, boolean] {
  const r = Math.hypot(x, y);
  const near = SCOPE_NEAR * PX;
  if (r * PX <= near) return [x * PX, y * PX, false];
  const t = Math.min((r - SCOPE_NEAR) / (SCOPE_FAR - SCOPE_NEAR), 1);
  const px = near + (edge - near) * Math.sqrt(t);
  return [(x / r) * px, (y / r) * px, t >= 1];
}

export function createDockGuide(parent: HTMLElement): DockGuide {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'dg';
  root.hidden = true;
  root.innerHTML = `
    <div class="dg-head"><span class="dg-label">DOCKING</span><span><span class="dg-label">CRADLE</span> <span class="dg-dist" data-k="dist"></span></span></div>
    <div class="dg-row" data-k="row"></div>
    <div class="dg-meter"><span class="dg-label">SPEED</span><div class="dg-track"><div class="dg-fill" data-k="fill"></div>
      <div class="dg-tick" style="left:${(T.lockSpeed / SPEED_MAX) * 100}%"></div></div><span class="dg-val" data-k="speed"></span></div>
    <div class="dg-meter"><span class="dg-label">ALIGN</span><span data-k="align" style="flex:1"></span><span class="dg-val" data-k="pitch"></span></div>
    <div class="dg-hint" data-k="hint"></div>`;
  parent.appendChild(root);
  const q = (k: string) => root.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
  const dist = q('dist');
  const fill = q('fill');
  const speed = q('speed');
  const align = q('align');
  const pitch = q('pitch');
  const hint = q('hint');

  // ---- The scope ----
  const c = SCOPE / 2;
  const scope = svgEl('svg', { width: SCOPE, height: SCOPE, viewBox: `0 0 ${SCOPE} ${SCOPE}` });
  scope.append(
    svgEl('circle', { cx: c, cy: c, r: c - 1, fill: 'rgba(0,10,20,.45)', stroke: 'rgba(160,220,255,.35)' }),
    svgEl('line', { x1: c, y1: 4, x2: c, y2: SCOPE - 4, stroke: 'rgba(160,220,255,.16)' }),
    svgEl('line', { x1: 4, y1: c, x2: SCOPE - 4, y2: c, stroke: 'rgba(160,220,255,.16)' }),
    svgEl('circle', { cx: c, cy: c, r: SCOPE_NEAR * PX, fill: 'none', stroke: 'rgba(160,220,255,.12)', 'stroke-dasharray': '2 3' }),
  );
  // The berth: the lock ring and the dashed outline where the cradle would hold her, moved and turned each frame.
  const berth = svgEl('g', {});
  const ring = svgEl('circle', { cx: 0, cy: 0, r: T.lockRadius * PX, fill: 'rgba(255,177,42,.12)', stroke: '#ffb12a', 'stroke-width': 1.5 });
  const berthShape = svgEl('path', {
    d: CRAFT_PATH, transform: `scale(${PX})`, fill: 'none', stroke: '#ffb12a', 'stroke-width': 1.4 / PX, 'stroke-dasharray': `${3 / PX} ${2 / PX}`,
  });
  const berthCross = svgEl('path', { d: 'M -5 0 H 5 M 0 -5 V 5', stroke: '#ffb12a', 'stroke-width': 1.5 });
  const berthTurn = svgEl('g', {});
  berthTurn.append(berthShape);
  berth.append(ring, berthTurn, berthCross);
  // Off the scope: an arrow at the rim pointing the way.
  const arrow = svgEl('path', { d: 'M 0 -7 L 6 5 L -6 5 Z', fill: '#ffb12a' });
  const rest = svgEl('path', { d: 'M 0 -5 L 5 0 L 0 5 L -5 0 Z', fill: 'none', stroke: '#e8f6ff', 'stroke-width': 1.5 });
  const craft = svgEl('path', {
    d: CRAFT_PATH, transform: `translate(${c} ${c}) scale(${PX})`, fill: 'rgba(120,190,255,.35)', stroke: 'rgba(207,233,255,.8)', 'stroke-width': 1 / PX,
  });
  // The berth's outline is true to scale; clip it to the scope's face when it is drawn near the rim.
  const clip = svgEl('clipPath', { id: 'dg-clip' });
  clip.append(svgEl('circle', { cx: c, cy: c, r: c - 1 }));
  const defs = svgEl('defs', {});
  defs.append(clip);
  const clipped = svgEl('g', { 'clip-path': 'url(#dg-clip)' });
  clipped.append(berth);
  scope.append(defs, craft, clipped, rest, arrow);

  // ---- The height bar ----
  const barW = 26;
  const barH = SCOPE;
  const bpx = barH / 2 / BAR_M;
  const bar = svgEl('svg', { width: barW, height: barH, viewBox: `0 0 ${barW} ${barH}` });
  const band = svgEl('rect', { x: 2, y: barH / 2 - T.lockRadius * bpx, width: barW - 4, height: 2 * T.lockRadius * bpx, rx: 3, fill: 'rgba(255,177,42,.15)' });
  bar.append(
    svgEl('rect', { x: 2, y: 0, width: barW - 4, height: barH, rx: 4, fill: 'rgba(0,10,20,.45)', stroke: 'rgba(160,220,255,.35)' }),
    band,
    svgEl('line', { x1: 0, y1: barH / 2, x2: barW, y2: barH / 2, stroke: '#ffb12a', 'stroke-width': 2 }),
  );
  const marker = svgEl('path', { d: 'M -9 0 L -3 -4 L 9 -1.4 L 9 1.4 L -3 4 Z', fill: '#cfe9ff' });
  bar.append(marker);
  const barLabel = svgEl('text', { x: barW / 2, y: 11, 'text-anchor': 'middle', fill: 'rgba(232,246,255,.7)', 'font-size': 9 });
  barLabel.textContent = 'HT';
  bar.append(barLabel);

  q('row').append(scope, bar);

  let last = '';
  return {
    update(v) {
      root.hidden = v === null;
      if (!v) return;
      const amber = v.ready ? '#52ef6b' : '#ffb12a';
      root.classList.toggle('ready', v.ready);
      dist.textContent = `${v.distance < 10 ? v.distance.toFixed(1) : Math.round(v.distance)} m`;
      dist.className = `dg-dist ${v.over ? 'ok' : ''}`;

      // Berth on the scope (screen y down = astern).
      const [bx, by, off] = toScope(v.berth.right, -v.berth.ahead, c - 10);
      berth.setAttribute('transform', `translate(${c + bx} ${c + by})`);
      berth.setAttribute('opacity', off ? '0' : '1');
      // Past true scale the outline and ring shrink with the compression, so the berth never looks closer than it is.
      const shrink = Math.min(1, Math.hypot(bx, by) / (Math.hypot(v.berth.right, v.berth.ahead) * PX || 1));
      berthTurn.setAttribute('transform', `rotate(${(-v.berthTurn * 180) / Math.PI}) scale(${shrink})`);
      ring.setAttribute('r', String(Math.max(v.ringRadius * PX * shrink, 0.5)));
      for (const el of [ring, berthShape, berthCross]) el.setAttribute('stroke', v.over ? amber : '#ffb12a');
      ring.setAttribute('fill', v.over ? (v.ready ? 'rgba(82,239,107,.25)' : 'rgba(255,177,42,.25)') : 'rgba(255,177,42,.10)');
      arrow.setAttribute('opacity', off ? '1' : '0');
      if (off) arrow.setAttribute('transform', `translate(${c + bx} ${c + by}) rotate(${(Math.atan2(bx, -by) * 180) / Math.PI})`);
      // Where she would come to rest: the berth, less the cradle as seen from the rest point.
      const [rx, ry] = toScope(v.berth.right - v.coast.right, -(v.berth.ahead - v.coast.ahead), c - 6);
      rest.setAttribute('transform', `translate(${c + rx} ${c + ry})`);
      rest.setAttribute('opacity', v.speed > 0.8 ? '1' : '0');

      // Height: the cradle's level across the middle; the craft above it when the berth is below her.
      const up = Math.max(-BAR_M, Math.min(BAR_M, v.berth.up));
      marker.setAttribute('transform', `translate(${barW / 2} ${barH / 2 + up * bpx})`);
      const levelOk = Math.abs(v.berth.up) <= T.lockRadius;
      marker.setAttribute('fill', levelOk ? (v.over ? amber : '#cfe9ff') : '#ff8a5c');
      band.setAttribute('fill', levelOk ? 'rgba(82,239,107,.18)' : 'rgba(255,177,42,.15)');

      fill.style.width = `${Math.min(v.speed / SPEED_MAX, 1) * 100}%`;
      fill.className = `dg-fill${v.slow ? ' ok' : ''}`;
      speed.textContent = `${(v.speed * KNOTS).toFixed(1)} kn`;
      speed.className = `dg-val ${v.slow ? 'ok' : 'bad'}`;
      const headingOk = v.alignDegrees <= (T.lockHeading * 180) / Math.PI;
      align.textContent = `${Math.round(v.alignDegrees)}° off axis`;
      align.className = headingOk ? 'ok' : 'bad';
      const pitchOk = Math.abs(v.pitchDegrees) <= (T.lockPitch * 180) / Math.PI;
      pitch.textContent = `${Math.round(v.pitchDegrees)}° ptch`;
      pitch.className = `dg-val ${pitchOk ? 'ok' : 'bad'}`;
      if (v.hint !== last) {
        last = v.hint;
        hint.textContent = v.hint;
      }
    },
  };
}
