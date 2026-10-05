import { describe, expect, it } from 'vitest';
import { depthText } from './hud';

describe('the depth readout', () => {
  it('reads height above water on the raised cradle (not "0 m"), AIR in a leap, depth below', () => {
    expect(depthText({ depthMetres: -7, airborne: false, clamped: true })).toEqual({ value: '+7 m', note: 'ABOVE WATER' });
    expect(depthText({ depthMetres: -12, airborne: true, clamped: false })).toEqual({ value: '+12 m', note: 'AIR' });
    expect(depthText({ depthMetres: 14, airborne: false, clamped: true })).toEqual({ value: '14 m', note: '' });
    expect(depthText({ depthMetres: -0.2, airborne: false, clamped: false })).toEqual({ value: '0 m', note: '' });
  });
});
