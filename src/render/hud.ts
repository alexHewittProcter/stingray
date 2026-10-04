// Plain DOM overlay: depth, speed, heading, the way home, targets left, and a key legend.

export interface HudReadout {
  depthMetres: number;
  speedKnots: number;
  headingDegrees: number;
  homeBearingDegrees: number;
  homeDistanceMetres: number;
  targetsLeft: number;
  targetsTotal: number;
  airborne: boolean;
  /** Phase 2: a one-line launch status shown in place of the targets line, or null at sea. */
  status: string | null;
}

export interface Hud {
  update(readout: HudReadout): void;
  /** Fade the key legend once the player has pressed something. */
  dismissLegend(): void;
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
.hud-legend { left: 50%; bottom: 18px; transform: translateX(-50%); text-align: center; font-weight: 400;
  transition: opacity 1.2s ease; }
.hud-legend b { color: #ffe066; }
.hud-reticle { position: absolute; left: 50%; top: 50%; width: 26px; height: 26px; margin: -13px 0 0 -13px;
  border: 2px solid rgba(255,224,102,.85); border-radius: 50%; box-shadow: 0 0 6px rgba(0,0,0,.5); }
.hud-reticle::after { content: ''; position: absolute; left: 50%; top: 50%; width: 4px; height: 4px;
  margin: -2px 0 0 -2px; background: rgba(255,224,102,.95); border-radius: 50%; }
`;

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function compassPoint(degrees: number): string {
  return COMPASS[Math.round(degrees / 45) % 8] ?? 'N';
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
    <div class="hud-panel hud-top"><span data-k="targets"></span></div>
    <div class="hud-reticle" data-k="reticle"></div>
    <div class="hud-panel hud-left">
      <div><span class="hud-label">DEPTH</span> <span class="hud-big" data-k="depth"></span></div>
      <div><span class="hud-label">SPEED</span> <span class="hud-big" data-k="speed"></span></div>
    </div>
    <div class="hud-panel hud-right">
      <div><span class="hud-label">HEADING</span> <span class="hud-big" data-k="heading"></span></div>
      <div><span class="hud-label">MARINEVILLE</span> <span data-k="home"></span></div>
    </div>
    <div class="hud-panel hud-legend" data-k="legend">
      <b>W</b>/<b>S</b> throttle &nbsp; <b>A</b>/<b>D</b> turn &nbsp; <b>↓</b>/<b>E</b> climb &nbsp; <b>↑</b>/<b>Q</b> dive &nbsp;
      <b>Shift</b> boost &nbsp; <b>Space</b> fire &nbsp; <b>R</b> restart
    </div>`;
  parent.appendChild(root);

  const el = (key: string): HTMLElement => {
    const found = root.querySelector<HTMLElement>(`[data-k="${key}"]`);
    if (!found) throw new Error(`hud element missing: ${key}`);
    return found;
  };
  const depth = el('depth');
  const speed = el('speed');
  const heading = el('heading');
  const home = el('home');
  const targets = el('targets');
  const legend = el('legend');

  return {
    reticle: el('reticle'),
    update(r) {
      depth.textContent = r.airborne ? `+${Math.max(-r.depthMetres, 0).toFixed(0)} m AIR` : `${Math.max(r.depthMetres, 0).toFixed(0)} m`;
      speed.textContent = `${Math.round(r.speedKnots)} kn`;
      heading.textContent = `${pad3(r.headingDegrees)}° ${compassPoint(r.headingDegrees)}`;
      home.textContent = `${pad3(r.homeBearingDegrees)}° · ${Math.round(r.homeDistanceMetres)} m`;
      targets.textContent = r.status !== null ? r.status : r.targetsLeft === 0
        ? 'ALL TARGETS DESTROYED — RETURN TO MARINEVILLE'
        : `TARGETS ${r.targetsTotal - r.targetsLeft} / ${r.targetsTotal}`;
    },
    dismissLegend() {
      legend.style.opacity = '0';
    },
  };
}
