import { describe, expect, it } from 'vitest';
import {
  CLOSED, type MenuEvent, type MenuKind, type MenuState, Swallow, itemLabel, menuEventFor, menuItems, menuOn, openMenu, titleOnLoad,
} from './menu';

const UP: MenuEvent = { type: 'up' };
const DOWN: MenuEvent = { type: 'down' };
const CHOOSE: MenuEvent = { type: 'choose' };
const BACK: MenuEvent = { type: 'back' };
const PAUSE: MenuEvent = { type: 'pause' };

const on = (s: MenuState, ...events: MenuEvent[]) => {
  let action = 'none';
  for (const e of events) ({ state: s, action } = menuOn(s, e));
  return { s, action };
};

/** Choose the item named `item` on the main page of `kind`. */
const choose = (kind: MenuKind, item: string) => {
  const index = menuItems(kind, 'main').indexOf(item as never);
  expect(index).toBeGreaterThanOrEqual(0);
  return menuOn({ kind, page: 'main', index }, CHOOSE);
};

describe('the menu items', () => {
  it('the title offers launch (first, the default), ocean, controls and sound', () => {
    expect(menuItems('title', 'main')).toEqual(['launch', 'ocean', 'controls', 'sound']);
    expect(openMenu('title').index).toBe(0);
  });

  it('the pause menu offers resume (first), pen, ocean, controls and sound', () => {
    expect(menuItems('pause', 'main')).toEqual(['resume', 'pen', 'ocean', 'controls', 'sound']);
  });

  it('the sound item reads the mute', () => {
    expect(itemLabel('sound', false)).toBe('Sound: On');
    expect(itemLabel('sound', true)).toBe('Sound: Off');
  });
});

describe('navigation', () => {
  it('down and up move the selection and wrap at both ends', () => {
    const t = openMenu('title');
    expect(on(t, DOWN).s.index).toBe(1);
    expect(on(t, UP).s.index).toBe(3);
    expect(on(t, DOWN, DOWN, DOWN, DOWN).s.index).toBe(0);
    expect(on(openMenu('pause'), UP).s.index).toBe(4);
  });

  it('the pointer selects an item; an index off the page is ignored', () => {
    expect(on(openMenu('pause'), { type: 'select', index: 2 }).s.index).toBe(2);
    expect(on(openMenu('pause'), { type: 'select', index: 9 }).s.index).toBe(0);
  });

  it('nothing but Esc acts while no menu is up', () => {
    for (const e of [UP, DOWN, CHOOSE, BACK]) expect(menuOn(CLOSED, e)).toEqual({ state: CLOSED, action: 'none' });
    expect(menuOn(CLOSED, PAUSE).state).toEqual(openMenu('pause'));
  });

  it('Esc does not stack a second menu', () => {
    expect(menuOn(openMenu('title'), PAUSE).state).toEqual(openMenu('title'));
  });
});

describe('choosing', () => {
  it('title: launch closes the menu (play begins on standby, as the game already stands)', () => {
    expect(choose('title', 'launch')).toEqual({ state: CLOSED, action: 'close' });
  });

  it('title and pause: ocean closes the menu and puts the game at sea', () => {
    expect(choose('title', 'ocean')).toEqual({ state: CLOSED, action: 'ocean' });
    expect(choose('pause', 'ocean')).toEqual({ state: CLOSED, action: 'ocean' });
  });

  it('pause: resume closes; return to Pen 3 goes to standby', () => {
    expect(choose('pause', 'resume')).toEqual({ state: CLOSED, action: 'close' });
    expect(choose('pause', 'pen')).toEqual({ state: CLOSED, action: 'standby' });
  });

  it('sound toggles the mute and keeps the menu where it is', () => {
    for (const kind of ['title', 'pause'] as const) {
      const r = choose(kind, 'sound');
      expect(r.action).toBe('toggleSound');
      expect(r.state.kind).toBe(kind);
      expect(menuItems(kind, 'main')[r.state.index]).toBe('sound');
    }
  });

  it('controls opens the controls page; back (chosen) returns with Controls selected', () => {
    for (const kind of ['title', 'pause'] as const) {
      const r = choose(kind, 'controls');
      expect(r).toEqual({ state: { kind, page: 'controls', index: 0 }, action: 'none' });
      const back = menuOn(r.state, CHOOSE);
      expect(back.action).toBe('none');
      expect(back.state.page).toBe('main');
      expect(menuItems(kind, 'main')[back.state.index]).toBe('controls');
    }
  });
});

describe('Esc (back)', () => {
  it('on the title menu does nothing: there is nothing behind it', () => {
    expect(menuOn(openMenu('title'), BACK)).toEqual({ state: openMenu('title'), action: 'none' });
  });

  it('on the pause menu resumes', () => {
    expect(menuOn({ kind: 'pause', page: 'main', index: 3 }, BACK)).toEqual({ state: CLOSED, action: 'close' });
  });

  it('on the controls page goes back to the menu it came from, not out of it', () => {
    for (const kind of ['title', 'pause'] as const) {
      const r = menuOn({ kind, page: 'controls', index: 0 }, BACK);
      expect(r.action).toBe('none');
      expect(r.state.kind).toBe(kind);
      expect(r.state.page).toBe('main');
    }
  });
});

describe('menu keys', () => {
  it('arrows and W/S move, Enter and Space choose, Esc backs out; game keys do nothing', () => {
    expect(menuEventFor('ArrowUp')).toEqual(UP);
    expect(menuEventFor('KeyW')).toEqual(UP);
    expect(menuEventFor('ArrowDown')).toEqual(DOWN);
    expect(menuEventFor('KeyS')).toEqual(DOWN);
    expect(menuEventFor('Enter')).toEqual(CHOOSE);
    expect(menuEventFor('Space')).toEqual(CHOOSE);
    expect(menuEventFor('Escape')).toEqual(BACK);
    for (const code of ['Digit1', 'KeyR', 'KeyA', 'ShiftLeft', 'KeyH']) expect(menuEventFor(code)).toBeNull();
  });
});

describe('swallowing the key that acted in the menu', () => {
  it('its keydowns (repeats too) are swallowed until it is released, then the game hears it again', () => {
    const s = new Swallow();
    s.add('Space');
    expect(s.down('Space')).toBe(true);
    expect(s.down('Space')).toBe(true); // auto-repeat while still held
    expect(s.down('KeyW')).toBe(false);
    s.up('Space');
    expect(s.down('Space')).toBe(false);
  });

  it('a blur releases everything', () => {
    const s = new Swallow();
    s.add('Enter');
    s.clear();
    expect(s.down('Enter')).toBe(false);
  });
});

describe('the title menu on load (URL rule)', () => {
  const p = (q: string) => new URLSearchParams(q);
  it('is up on a plain load', () => {
    expect(titleOnLoad(p(''))).toBe(true);
    expect(titleOnLoad(p('?seed=7&fps'))).toBe(true);
  });

  it('is skipped by the witness tooling and by ?menu=0', () => {
    for (const q of ['?script=cradle,8', '?at=0,-20,0', '?start=ocean', '?hold', '?view=0,0,0,1,1,1', '?menu=0', '?menu=pause']) {
      expect(titleOnLoad(p(q))).toBe(false);
    }
  });

  it('?menu=1 forces it, even with tooling', () => {
    expect(titleOnLoad(p('?menu=1'))).toBe(true);
    expect(titleOnLoad(p('?menu=1&start=ocean'))).toBe(true);
  });
});
