// The game menu (phase 2, T9): a console plate over the live scene, in the launch panel's hardware language —
// brushed grey enamel, chrome trim, screws, round lamps and cream keycaps — under a 1960s serial title done in CSS.
// DOM and CSS only; every decision comes from the pure state machine in game/menu.ts. The items are plain elements,
// not buttons: nothing takes keyboard focus, so the game's keys are live the moment the menu closes.

import { type MenuEvent, type MenuState, itemLabel, menuItems } from '../game/menu';
import { legendRowsHtml } from './legend';

export interface MenuView {
  update(state: MenuState, muted: boolean): void;
}

const STYLE = `
.mn { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center;
  font-size: clamp(12px, 1.9vh, 22px); font-family: "Futura", "Century Gothic", "Avenir Next", "Trebuchet MS", sans-serif;
  color: #26292a; user-select: none; -webkit-user-select: none; touch-action: manipulation;
  background: radial-gradient(ellipse 75% 70% at 50% 50%, rgba(2,10,18,.18) 0%, rgba(2,10,18,.5) 70%, rgba(1,5,10,.82) 100%);
  opacity: 0; visibility: hidden; pointer-events: none; transition: opacity .25s ease, visibility 0s linear .25s; }
.mn.open { opacity: 1; visibility: visible; pointer-events: auto; transition: opacity .25s ease, visibility 0s; }
.mn.pause { background: radial-gradient(ellipse 75% 70% at 50% 50%, rgba(2,10,18,.35) 0%, rgba(2,10,18,.62) 70%, rgba(1,5,10,.86) 100%); }
.mn-stack { display: flex; flex-direction: column; align-items: center; gap: 1.1em; transform: translateY(.6em) scale(.97);
  transition: transform .25s cubic-bezier(.2,.9,.3,1.2); }
.mn.open .mn-stack { transform: none; }

/* The title: tall condensed capitals, sunburst yellow into red, a deep extruded edge — a 1960s serial's titles. */
.mn-title { margin: 0; font: italic 900 5.6em/0.92 "Impact", "Haettenschweiler", "Arial Narrow Bold", "Futura Condensed ExtraBold", sans-serif;
  letter-spacing: .05em; text-transform: uppercase; transform: skewX(-6deg);
  color: #ffd23a; background: linear-gradient(180deg, #fff6b0 0%, #ffd23a 38%, #ff8a1e 70%, #e0361c 100%);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  -webkit-text-stroke: .025em #4a0c06;
  filter: drop-shadow(.04em .04em 0 #7a1608) drop-shadow(.04em .04em 0 #5a0f05) drop-shadow(.03em .03em 0 #3a0803)
    drop-shadow(0 .12em .25em rgba(0,0,0,.7)); }
.mn.pause .mn-title { font-size: 3.4em; }
.mn-strap { margin-top: -.35em; padding: .3em 1.2em; border-radius: .25em; transform: skewX(-6deg);
  background: linear-gradient(180deg, #0d1f1a, #18302a); color: #f2e6b8; border: 2px solid #5b5f5c;
  box-shadow: inset 0 2px 4px rgba(0,0,0,.8), 0 3px 10px rgba(0,0,0,.55);
  font: 700 1.05em/1 "Futura", "Century Gothic", "Avenir Next", sans-serif; letter-spacing: .32em; text-transform: uppercase;
  text-shadow: 0 0 8px rgba(242,230,184,.4); }

/* The console plate the items sit on. */
.mn-console { position: relative; min-width: 19em; padding: .8em 1em .75em; box-sizing: border-box;
  border-radius: 1.1em .3em 1.1em .3em / 1.1em .3em 1.1em .3em;
  background:
    repeating-linear-gradient(90deg, rgba(255,255,255,.025) 0 2px, rgba(0,0,0,.025) 2px 4px),
    linear-gradient(180deg, #d3d6d1 0%, #b7bbb6 9%, #a9ada8 60%, #8f938e 100%);
  border: 2px solid #5b5f5c;
  box-shadow: inset 0 2px 0 rgba(255,255,255,.75), inset 0 -3px 0 rgba(0,0,0,.25), 0 10px 30px rgba(0,0,0,.6), 0 0 0 4px rgba(20,24,26,.35); }
.mn-console::before { content: ''; position: absolute; left: 1.2em; right: 1.2em; top: -.42em; height: .32em; border-radius: .2em;
  background: linear-gradient(180deg, #f4f6f7, #9aa1a5 55%, #e7ebee); box-shadow: 0 1px 2px rgba(0,0,0,.5); }
.mn-screw { position: absolute; width: .5em; height: .5em; border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #f2f2ee, #8b8d8a 60%, #5d5f5c); box-shadow: inset 0 0 0 1px rgba(0,0,0,.35); }
.mn-screw::after { content: ''; position: absolute; left: 15%; right: 15%; top: 45%; height: 10%; background: rgba(40,40,40,.55); transform: rotate(35deg); }
.mn-head { text-align: center; font-weight: 700; font-size: .78em; letter-spacing: .3em; color: #33383a;
  text-shadow: 0 1px 0 rgba(255,255,255,.55); margin: .1em 0 .55em; }
.mn-list { display: flex; flex-direction: column; gap: .32em; }
.mn-item { display: flex; align-items: center; gap: .7em; padding: .42em .65em; border-radius: .45em; cursor: pointer;
  background: linear-gradient(180deg, #9da19c, #8b8f8a);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.45), inset 0 -1px 0 rgba(0,0,0,.3), 0 1px 0 rgba(255,255,255,.35);
  transition: background .12s ease; }
.mn-item.sel { background: linear-gradient(180deg, #b4b8b2, #a1a59f); }
.mn-item:active { transform: translateY(1px); }
.mn-lamp { flex: none; width: 1.15em; height: 1.15em; border-radius: 50%; position: relative; --lamp: #3a2f27; --glow: 0; --halo: transparent;
  background: radial-gradient(circle at 50% 50%, var(--lamp) 0 52%, transparent 54%),
    radial-gradient(circle at 35% 30%, #fafafa, #8d9195 55%, #4c5054);
  box-shadow: 0 1px 2px rgba(0,0,0,.6), 0 0 var(--glow) var(--halo); transition: box-shadow .15s ease; }
.mn-lamp::after { content: ''; position: absolute; left: 30%; top: 24%; width: 22%; height: 16%; border-radius: 50%; background: rgba(255,255,255,.55); }
.mn-item.sel .mn-lamp { --lamp: #ffb12a; --glow: .7em; --halo: rgba(255,170,30,.85); }
.mn-label { flex: 1; font-weight: 700; font-size: .95em; letter-spacing: .14em; text-transform: uppercase; color: #22272a;
  text-shadow: 0 1px 0 rgba(255,255,255,.45); white-space: nowrap; }
.mn-key { flex: none; min-width: 1.35em; height: 1.35em; padding: 0 .3em; box-sizing: border-box; border-radius: .25em; display: grid; place-items: center;
  font: 700 .72em/1 ui-monospace, Menlo, monospace; color: #2a2a26; letter-spacing: .04em;
  background: linear-gradient(180deg, #fbf5e2, #ddd2b2); box-shadow: 0 2px 0 #9d9378, 0 3px 3px rgba(0,0,0,.35), inset 0 1px 0 #fff; }
.mn-item:not(.sel) .mn-key { visibility: hidden; }
.mn-screen { margin: 0 0 .55em; padding: .6em .9em .7em; border-radius: .35em;
  background: linear-gradient(180deg, #0d1f1a, #18302a); color: #e9e3c8;
  box-shadow: inset 0 2px 4px rgba(0,0,0,.8), 0 1px 0 rgba(255,255,255,.6);
  display: grid; grid-template-columns: auto auto; column-gap: 1.6em; row-gap: .15em;
  font: 500 .82em/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
.mn-screen b { color: #ffe066; display: inline-block; min-width: 4.6em; }
.mn-hints { display: flex; gap: 1.2em; justify-content: center; margin-top: .65em; font-size: .68em; font-weight: 700;
  letter-spacing: .12em; color: #3a3f41; text-transform: uppercase; }
.mn-hints span { display: inline-flex; align-items: center; gap: .4em; }
.mn-hints kbd { font: 700 1em/1 ui-monospace, Menlo, monospace; padding: .18em .35em; border-radius: .22em; color: #2a2a26;
  background: linear-gradient(180deg, #fbf5e2, #ddd2b2); box-shadow: 0 2px 0 #9d9378, inset 0 1px 0 #fff; }

/* Behind the menus: the title hides the play overlays; the pause menu dims them. */
body[data-menu="title"] .hud, body[data-menu="title"] .lp, body[data-menu="title"] .dg { visibility: hidden; }
body[data-menu="pause"] .hud, body[data-menu="pause"] .lp, body[data-menu="pause"] .dg { opacity: .35; filter: saturate(.5); }
`;

const SCREWS = `<span class="mn-screw" style="left:.4em;top:.4em"></span><span class="mn-screw" style="right:.4em;top:.4em"></span>
  <span class="mn-screw" style="left:.4em;bottom:.4em"></span><span class="mn-screw" style="right:.4em;bottom:.4em"></span>`;

export function createMenu(parent: HTMLElement, onEvent: (e: MenuEvent) => void): MenuView {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'mn';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Menu');
  parent.appendChild(root);

  // A press must not take focus or start a selection: the game's keys stay live the moment the menu closes.
  root.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (e.button !== 0) return;
    const item = (e.target as HTMLElement).closest<HTMLElement>('.mn-item');
    if (!item) return;
    onEvent({ type: 'select', index: Number(item.dataset.i) });
    onEvent({ type: 'choose' });
  });
  root.addEventListener('pointerover', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.mn-item');
    if (item) onEvent({ type: 'select', index: Number(item.dataset.i) });
  });

  let built = '';
  let items: HTMLElement[] = [];

  return {
    update(state, muted) {
      document.body.dataset.menu = state.kind ?? '';
      root.classList.toggle('open', state.kind !== null);
      // Closing: leave the last page in place while it fades.
      if (state.kind === null) return;
      root.classList.toggle('pause', state.kind === 'pause');

      const key = `${state.kind}|${state.page}|${muted}`;
      if (key !== built) {
        built = key;
        const list = menuItems(state.kind, state.page);
        const title = state.kind === 'title'
          ? `<h1 class="mn-title">Stingray</h1><div class="mn-strap">Stand by for action</div>`
          : `<h1 class="mn-title">Paused</h1>`;
        const head = state.page === 'controls' ? 'CONTROLS' : state.kind === 'title' ? 'MARINEVILLE · PEN 3' : 'STINGRAY · STANDING BY';
        const screen = state.page === 'controls' ? `<div class="mn-screen">${legendRowsHtml()}</div>` : '';
        const back = state.kind === 'pause' && state.page === 'main' ? 'resume' : 'back';
        root.innerHTML = `
          <div class="mn-stack">
            ${title}
            <div class="mn-console">${SCREWS}
              <div class="mn-head">${head}</div>
              ${screen}
              <div class="mn-list">${list.map((item, i) => `
                <div class="mn-item" data-i="${i}" data-item="${item}"><span class="mn-lamp"></span>
                  <span class="mn-label">${itemLabel(item, muted)}</span><span class="mn-key">Enter</span></div>`).join('')}
              </div>
              <div class="mn-hints"><span><kbd>↑</kbd><kbd>↓</kbd> select</span><span><kbd>Enter</kbd> choose</span>${
                state.kind === 'title' && state.page === 'main' ? '' : `<span><kbd>Esc</kbd> ${back}</span>`}</div>
            </div>
          </div>`;
        items = [...root.querySelectorAll<HTMLElement>('.mn-item')];
      }
      items.forEach((el, i) => el.classList.toggle('sel', i === state.index));
    },
  };
}
