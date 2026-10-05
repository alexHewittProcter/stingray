// The launch panel (phase 2, L6): a strip of Stingray's cockpit console along the bottom of the screen — grey
// enamel, chrome trim, oval speaker grilles, and four lever-and-lamp controls (cradle, engines, clamps, ocean door)
// with ball-topped levers, round lamps and cream keycaps. DOM and CSS only; every decision comes from the pure
// view-model in game/panel.ts. Clicks press a control without taking keyboard focus from the game.

import type { ControlView, PanelView } from '../game/panel';
import type { LaunchControl } from '../sim/launch';

export interface LaunchPanel {
  update(view: PanelView): void;
}

const STYLE = `
.lp { position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 2;
  font-size: clamp(12px, 1.75vh, 20px); font-family: "Futura", "Century Gothic", "Avenir Next", "Trebuchet MS", sans-serif;
  color: #26292a; user-select: none; -webkit-user-select: none; pointer-events: auto; touch-action: manipulation; }
.lp[hidden] { display: none; }
.lp-console { position: relative; display: flex; align-items: stretch; gap: .55em; padding: .55em .8em .7em;
  border-radius: 1.1em .3em 1.1em .3em / 1.1em .3em 1.1em .3em;
  background:
    repeating-linear-gradient(90deg, rgba(255,255,255,.025) 0 2px, rgba(0,0,0,.025) 2px 4px),
    linear-gradient(180deg, #d3d6d1 0%, #b7bbb6 9%, #a9ada8 60%, #8f938e 100%);
  border: 2px solid #5b5f5c;
  box-shadow: inset 0 2px 0 rgba(255,255,255,.75), inset 0 -3px 0 rgba(0,0,0,.25), 0 6px 18px rgba(0,0,0,.55), 0 0 0 4px rgba(20,24,26,.35); }
.lp-console::before { content: ''; position: absolute; left: 1.2em; right: 1.2em; top: -.42em; height: .32em; border-radius: .2em;
  background: linear-gradient(180deg, #f4f6f7, #9aa1a5 55%, #e7ebee); box-shadow: 0 1px 2px rgba(0,0,0,.5); }
.lp-screw { position: absolute; width: .5em; height: .5em; border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #f2f2ee, #8b8d8a 60%, #5d5f5c);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.35); }
.lp-screw::after { content: ''; position: absolute; left: 15%; right: 15%; top: 45%; height: 10%; background: rgba(40,40,40,.55); transform: rotate(35deg); }
.lp-grille { flex: none; align-self: center; width: 2.9em; height: 4.4em; }
.lp-main { display: flex; flex-direction: column; gap: .45em; min-width: 14em; }
.lp.lp-solo-msg .lp-main { min-width: 25em; }
.lp-bank { justify-content: center; }
.lp-plate { display: flex; align-items: center; justify-content: center; height: 1.75em; padding: 0 .7em;
  width: 0; min-width: 100%; box-sizing: border-box;
  border-radius: .35em; background: linear-gradient(180deg, #0d1f1a, #18302a); color: #e9e3c8;
  box-shadow: inset 0 2px 4px rgba(0,0,0,.8), 0 1px 0 rgba(255,255,255,.6);
  font: 600 .82em/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; white-space: nowrap; overflow: hidden; }
.lp-title { color: rgba(233,227,200,.45); }
.lp-title[hidden] { display: none; }
.lp-msg { color: #f2e6b8; text-shadow: 0 0 6px rgba(242,230,184,.35); overflow: hidden; text-overflow: ellipsis; }
.lp-msg.refused { color: #ff6a4d; text-shadow: 0 0 8px rgba(255,80,50,.6); animation: lp-blink .5s ease-in-out 3; }
.lp-bank { display: flex; gap: .45em; }
.lp-ctl { position: relative; width: 6.3em; padding: .45em .3em .4em; border-radius: .45em; cursor: default;
  display: flex; flex-direction: column; align-items: center; gap: .3em;
  background: linear-gradient(180deg, #9da19c, #8b8f8a);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.45), inset 0 -1px 0 rgba(0,0,0,.3), 0 1px 0 rgba(255,255,255,.35); }
.lp-ctl.pressable { cursor: pointer; }
.lp-ctl.pressable:hover { background: linear-gradient(180deg, #a7aba6, #959994); }
.lp-ctl:active { transform: translateY(1px); }
.lp-head { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 0 .25em; box-sizing: border-box; }
.lp-key { width: 1.35em; height: 1.35em; border-radius: .25em; display: grid; place-items: center;
  font: 700 .9em/1 ui-monospace, Menlo, monospace; color: #2a2a26;
  background: linear-gradient(180deg, #fbf5e2, #ddd2b2); box-shadow: 0 2px 0 #9d9378, 0 3px 3px rgba(0,0,0,.35), inset 0 1px 0 #fff; }
.lp-ctl.next .lp-key { animation: lp-next 1.6s ease-in-out infinite; }
.lp-lamp { width: 1.45em; height: 1.45em; border-radius: 50%; position: relative;
  background: radial-gradient(circle at 50% 50%, var(--lamp) 0 52%, transparent 54%),
    radial-gradient(circle at 35% 30%, #fafafa, #8d9195 55%, #4c5054);
  box-shadow: 0 1px 2px rgba(0,0,0,.6), 0 0 var(--glow) var(--halo); --glow: 0; --halo: transparent; }
.lp-lamp::after { content: ''; position: absolute; left: 30%; top: 24%; width: 22%; height: 16%; border-radius: 50%;
  background: rgba(255,255,255,.55); filter: blur(.5px); }
.lp-lamp.dark  { --lamp: #3a2f27; }
.lp-lamp.amber { --lamp: #ffb12a; --glow: .8em; --halo: rgba(255,170,30,.85); }
.lp-lamp.green { --lamp: #52ef6b; --glow: .8em; --halo: rgba(70,240,100,.75); }
.lp-lamp.red   { --lamp: #ff3b22; --glow: 1em; --halo: rgba(255,50,30,.95); animation: lp-flash .4s ease-in-out 5; }
.lp-lamp.amber.moving { animation: lp-pulse .9s ease-in-out infinite; }
.lp-slot { position: relative; width: 2.1em; height: 3.9em; border-radius: .9em;
  background: linear-gradient(90deg, #6d716d, #7f837f 50%, #6d716d);
  box-shadow: inset 0 1px 3px rgba(0,0,0,.5), 0 1px 0 rgba(255,255,255,.4); }
.lp-slot::before { content: ''; position: absolute; left: 50%; top: .5em; bottom: .5em; width: .32em; margin-left: -.16em;
  border-radius: .2em; background: #141617; box-shadow: inset 0 1px 2px #000, 0 1px 0 rgba(255,255,255,.35); }
.lp-tick { position: absolute; left: .18em; width: .38em; height: 2px; background: rgba(30,32,33,.55); }
.lp-tick.r { left: auto; right: .18em; }
.lp-knob { position: absolute; left: 50%; top: .5em; width: 1.5em; height: 1.5em; margin: -.75em 0 0 -.75em;
  border-radius: 50%; background: radial-gradient(circle at 34% 30%, rgba(255,255,255,.85) 0 8%, var(--ball) 34%, var(--ball-dark) 100%);
  box-shadow: 0 .25em .35em rgba(0,0,0,.55); --ball: #d43a28; --ball-dark: #6e140c; }
.lp-knob::before { content: ''; position: absolute; left: 50%; top: 92%; width: .34em; height: .45em; margin-left: -.17em;
  background: linear-gradient(90deg, #6e7477, #eef1f2 45%, #6e7477); border-radius: 0 0 .1em .1em; z-index: -1; }
.lp-ctl[data-c="engines"] .lp-knob { --ball: #f3ead0; --ball-dark: #988c69; }
.lp-ctl[data-c="clamps"]  .lp-knob { --ball: #f0c53a; --ball-dark: #8a6a0c; }
.lp-ctl[data-c="door"]    .lp-knob { --ball: #5f95d6; --ball-dark: #1d3e66; }
.lp-ctl.snap .lp-knob { transition: transform .28s cubic-bezier(.3,1.5,.5,1); }
.lp-name { font-weight: 700; font-size: .78em; letter-spacing: .12em; color: #22272a; text-shadow: 0 1px 0 rgba(255,255,255,.45); white-space: nowrap; }
.lp-word { min-width: 6.2em; text-align: center; padding: .18em .3em; border-radius: .2em; background: #141716; color: #e2b44a;
  font: 600 .7em/1.1 ui-monospace, Menlo, monospace; letter-spacing: .1em; box-shadow: inset 0 1px 2px #000, 0 1px 0 rgba(255,255,255,.4); }
.lp-word.green { color: #6be37c; }
.lp-word.dark { color: #a49c86; }
@keyframes lp-pulse { 0%, 100% { filter: brightness(1.15); } 50% { filter: brightness(.55); } }
@keyframes lp-blink { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
@keyframes lp-flash { 0%, 100% { filter: brightness(1.2); } 50% { filter: brightness(.6); } }
@keyframes lp-next { 0%, 100% { box-shadow: 0 2px 0 #9d9378, 0 3px 3px rgba(0,0,0,.35), inset 0 1px 0 #fff; }
  50% { box-shadow: 0 2px 0 #9d9378, 0 0 .7em .15em rgba(255,236,170,.9), inset 0 1px 0 #fff; } }
`;

// An oval speaker grille like the cockpit's: cream bezel, dark slots.
const GRILLE = `<svg class="lp-grille" viewBox="0 0 58 88" aria-hidden="true">
  <defs><linearGradient id="lpg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf6e6"/><stop offset="1" stop-color="#cdc3a3"/></linearGradient></defs>
  <ellipse cx="29" cy="44" rx="27" ry="42" fill="#6a6d69"/>
  <ellipse cx="29" cy="44" rx="25" ry="40" fill="url(#lpg)"/>
  ${[18, 28, 38, 48, 58, 68].map((y) => {
    const half = 20 * Math.sqrt(Math.max(0, 1 - ((y - 44) / 38) ** 2));
    return `<rect x="${29 - half}" y="${y - 3}" width="${2 * half}" height="6" rx="3" fill="#2b2d2b"/>`;
  }).join('')}
</svg>`;

// The knob's travel along the slot, in em, from top (0) to bottom (1).
const TRAVEL = 2.9;

interface ControlEls {
  root: HTMLElement;
  lamp: HTMLElement;
  knob: HTMLElement;
  word: HTMLElement;
  last: string;
}

export function createLaunchPanel(parent: HTMLElement, onPress: (control: LaunchControl) => void): LaunchPanel {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'lp';
  root.hidden = true;
  root.innerHTML = `
    <div class="lp-console">
      <span class="lp-screw" style="left:.35em;top:.35em"></span><span class="lp-screw" style="right:.35em;top:.35em"></span>
      <span class="lp-screw" style="left:.35em;bottom:.35em"></span><span class="lp-screw" style="right:.35em;bottom:.35em"></span>
      ${GRILLE}
      <div class="lp-main">
        <div class="lp-plate"><span class="lp-title">PEN 3 · LAUNCH</span><span class="lp-msg" data-k="msg"></span></div>
        <div class="lp-bank" data-k="bank"></div>
      </div>
      ${GRILLE}
    </div>`;
  parent.appendChild(root);

  const bank = root.querySelector<HTMLElement>('[data-k="bank"]')!;
  const msg = root.querySelector<HTMLElement>('[data-k="msg"]')!;
  const title = root.querySelector<HTMLElement>('.lp-title')!;
  const controls = new Map<LaunchControl, ControlEls>();

  // A press on the panel must not take focus or start a text selection: the game's keys stay live after a click.
  root.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (e.button !== 0) return;
    const ctl = (e.target as HTMLElement).closest<HTMLElement>('.lp-ctl');
    const control = ctl?.dataset.c as LaunchControl | undefined;
    if (control) onPress(control);
  });

  function make(c: ControlView): ControlEls {
    const el = document.createElement('div');
    el.className = 'lp-ctl';
    el.dataset.c = c.control;
    el.title = `${c.label} (key ${c.key})`;
    el.innerHTML = `
      <div class="lp-head"><span class="lp-key">${c.key}</span><span class="lp-lamp dark"></span></div>
      <div class="lp-slot"><span class="lp-tick" style="top:.45em"></span><span class="lp-tick r" style="top:.45em"></span>
        <span class="lp-tick" style="bottom:.45em"></span><span class="lp-tick r" style="bottom:.45em"></span>
        <span class="lp-knob"></span></div>
      <div class="lp-name">${c.label}</div>
      <div class="lp-word"></div>`;
    return {
      root: el,
      lamp: el.querySelector<HTMLElement>('.lp-lamp')!,
      knob: el.querySelector<HTMLElement>('.lp-knob')!,
      word: el.querySelector<HTMLElement>('.lp-word')!,
      last: '',
    };
  }

  let shownKey = '';
  let lastMsg = '';

  return {
    update(view) {
      root.hidden = view.controls.length === 0;
      if (root.hidden) return;

      // Rebuild the bank only when the set of controls on show changes.
      const key = view.controls.map((c) => c.control).join();
      if (key !== shownKey) {
        shownKey = key;
        bank.replaceChildren();
        for (const c of view.controls) {
          let els = controls.get(c.control);
          if (!els) controls.set(c.control, (els = make(c)));
          bank.appendChild(els.root);
        }
        title.textContent = view.controls.length === 1 ? 'MARINEVILLE' : 'PEN 3 · LAUNCH';
      }

      for (const c of view.controls) {
        const els = controls.get(c.control)!;
        // Levers the player throws snap over with a little spring; the cradle and door levers follow the travel.
        const snap = c.control === 'engines' || c.control === 'clamps';
        const state = `${c.lamp}|${c.moving}|${c.word}|${c.pressable}|${c.next}`;
        if (state !== els.last) {
          els.last = state;
          els.root.className = `lp-ctl${c.pressable ? ' pressable' : ''}${c.next ? ' next' : ''}${snap ? ' snap' : ''}`;
          els.lamp.className = `lp-lamp ${c.lamp}${c.moving ? ' moving' : ''}`;
          els.word.textContent = c.word;
          els.word.className = `lp-word${c.lamp === 'green' ? ' green' : c.lamp === 'dark' ? ' dark' : ''}`;
        }
        els.knob.style.transform = `translateY(${(c.lever * TRAVEL).toFixed(3)}em)`;
      }

      const text = view.refusal ? view.refusal.reason.toUpperCase() : (view.prompt ?? '');
      // At sea the panel is one control wide: widen it while it carries a line, so the line is not cut short.
      root.classList.toggle('lp-solo-msg', text !== '' && view.controls.length === 1);
      const message = `${view.refusal ? 'r' : 'p'}${text}`;
      if (message !== lastMsg) {
        lastMsg = message;
        msg.textContent = text;
        title.hidden = text !== '';
        msg.className = `lp-msg${view.refusal ? ' refused' : ''}`;
        // Restart the blink for a fresh refusal.
        if (view.refusal) { void msg.offsetWidth; }
      }
    },
  };
}
