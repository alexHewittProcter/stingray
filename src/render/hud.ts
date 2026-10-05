// Plain DOM overlay: depth, speed, heading, the way home, targets left, and a key legend. In 'launch' presentation
// (phase 2, L6) the sea readouts that make no sense inside — the way home and the targets — give way to a one-line
// status, and the launch panel (launch-panel.ts) sits bottom centre.

import { legendRowsHtml } from './legend';

export interface HudReadout {
  depthMetres: number;
  speedKnots: number;
  headingDegrees: number;
  homeBearingDegrees: number;
  homeDistanceMetres: number;
  targetsLeft: number;
  targetsTotal: number;
  airborne: boolean;
  /** Held by the cradle's clamps (no airborne marker; above the pool the depth reads as height above water). */
  clamped: boolean;
  /** Phase 2: a one-line launch status shown in place of the targets line and the way home, or null at sea. */
  status: string | null;
}

export interface Hud {
  update(readout: HudReadout): void;
  /** Show or fade the key legend (when: render/legend.ts). */
  showLegend(shown: boolean): void;
}

const STYLE = `
.hud { position: fixed; inset: 0; pointer-events: none; color: #e8f6ff;
  font: 600 14px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; text-shadow: 0 1px 3px rgba(0,20,40,.9); }
.hud-panel { position: absolute; padding: 10px 14px; background: rgba(4,24,40,.42);
  border: 1px solid rgba(160,220,255,.35); border-radius: 6px; }
.hud-left { left: 18px; bottom: 18px; min-width: 170px; }
.hud-right { right: 18px; bottom: 18px; min-width: 190px; text-align: right; }
.hud-top { left: 50%; top: 16px; transform: translateX(-50%); text-align: center; letter-spacing: .08em; }
.hud-label { opacity: .7; font-weight: 400; }
.hud-big { font-size: 22px; }
.hud-legend { left: 18px; top: 16px; font-weight: 400; font-size: 12px; line-height: 1.5; padding: 7px 12px 8px;
  display: grid; grid-template-columns: auto auto; column-gap: 18px; transition: opacity .9s ease; }
.hud-legend.faded { opacity: 0; }
.hud-legend b { color: #ffe066; display: inline-block; min-width: 3.9em; }
.hud-legend .hud-label { grid-column: 1 / -1; margin-bottom: 1px; letter-spacing: .1em; }
.hud-status { letter-spacing: .1em; }
.hud-home-row[hidden] { display: none; }
.hud-reticle { position: absolute; left: 50%; top: 50%; width: 26px; height: 26px; margin: -13px 0 0 -13px;
  border: 2px solid rgba(255,224,102,.85); border-radius: 50%; box-shadow: 0 0 6px rgba(0,0,0,.5); }
.hud-reticle::after { content: ''; position: absolute; left: 50%; top: 50%; width: 4px; height: 4px;
  margin: -2px 0 0 -2px; background: rgba(255,224,102,.95); border-radius: 50%; }
`;

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function compassPoint(degrees: number): string {
  return COMPASS[Math.round(degrees / 45) % 8] ?? 'N';
}

/**
 * Depth below the surface; above it, height above the water with a small note — "AIR" in a leap, "ABOVE WATER" held on the
 * raised cradle (which used to read a misleading "0 m").
 */
export function depthText(r: Pick<HudReadout, 'depthMetres' | 'airborne' | 'clamped'>): { value: string; note: string } {
  const height = -r.depthMetres;
  if (r.airborne) return { value: `+${Math.max(height, 0).toFixed(0)} m`, note: 'AIR' };
  if (r.clamped && height >= 0.5) return { value: `+${height.toFixed(0)} m`, note: 'ABOVE WATER' };
  return { value: `${Math.max(r.depthMetres, 0).toFixed(0)} m`, note: '' };
}

function pad3(degrees: number): string {
  return String(Math.round(degrees) % 360).padStart(3, '0');
}

export function createHud(parent: HTMLElement): Hud & { reticle: HTMLElement } {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'hud';
  root.innerHTML = `
    <div class="hud-panel hud-top"><span class="hud-status" data-k="targets"></span></div>
    <div class="hud-reticle" data-k="reticle"></div>
    <div class="hud-panel hud-left">
      <div><span class="hud-label">DEPTH</span> <span class="hud-big" data-k="depth"></span> <span class="hud-label" data-k="depth-note"></span></div>
      <div><span class="hud-label">SPEED</span> <span class="hud-big" data-k="speed"></span></div>
    </div>
    <div class="hud-panel hud-right">
      <div><span class="hud-label">HEADING</span> <span class="hud-big" data-k="heading"></span></div>
      <div class="hud-home-row" data-k="home-row"><span class="hud-label">MARINEVILLE</span> <span data-k="home"></span></div>
    </div>
    <div class="hud-panel hud-legend" data-k="legend">
      <span class="hud-label">CONTROLS</span>
      ${legendRowsHtml()}
    </div>`;
  parent.appendChild(root);

  const el = (key: string): HTMLElement => {
    const found = root.querySelector<HTMLElement>(`[data-k="${key}"]`);
    if (!found) throw new Error(`hud element missing: ${key}`);
    return found;
  };
  const depth = el('depth');
  const depthNote = el('depth-note');
  const speed = el('speed');
  const heading = el('heading');
  const home = el('home');
  const homeRow = el('home-row');
  const targets = el('targets');
  const legend = el('legend');

  return {
    reticle: el('reticle'),
    update(r) {
      const d = depthText(r);
      depth.textContent = d.value;
      depthNote.textContent = d.note;
      speed.textContent = `${Math.round(r.speedKnots)} kn`;
      heading.textContent = `${pad3(r.headingDegrees)}° ${compassPoint(r.headingDegrees)}`;
      homeRow.hidden = r.status !== null;
      home.textContent = `${pad3(r.homeBearingDegrees)}° · ${Math.round(r.homeDistanceMetres)} m`;
      targets.textContent = r.status !== null ? r.status : r.targetsLeft === 0
        ? 'ALL TARGETS DESTROYED — RETURN TO MARINEVILLE'
        : `TARGETS ${r.targetsTotal - r.targetsLeft} / ${r.targetsTotal}`;
    },
    showLegend(shown) {
      legend.classList.toggle('faded', !shown);
    },
  };
}
