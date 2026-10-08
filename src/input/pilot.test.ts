import { describe, expect, it } from 'vitest';
import { pressFor, toSubInput } from './pilot';

const keys = (...codes: string[]) => new Set(codes);

describe('toSubInput', () => {
  it('is neutral with nothing held', () => {
    expect(toSubInput(keys())).toEqual({ throttle: 0, yaw: 0, pitch: 0, boost: false, fire: false });
  });

  it('maps W/S to throttle forward/reverse', () => {
    expect(toSubInput(keys('KeyW')).throttle).toBe(1);
    expect(toSubInput(keys('KeyS')).throttle).toBe(-1);
  });

  it('maps A to a left turn (positive yaw) and D to a right turn', () => {
    expect(toSubInput(keys('KeyA')).yaw).toBe(1);
    expect(toSubInput(keys('KeyD')).yaw).toBe(-1);
  });

  it('maps ArrowDown / E to climb and ArrowUp / Q to dive', () => {
    expect(toSubInput(keys('ArrowDown')).pitch).toBe(1);
    expect(toSubInput(keys('KeyE')).pitch).toBe(1);
    expect(toSubInput(keys('ArrowUp')).pitch).toBe(-1);
    expect(toSubInput(keys('KeyQ')).pitch).toBe(-1);
  });

  it('cancels opposing keys', () => {
    expect(toSubInput(keys('KeyW', 'KeyS')).throttle).toBe(0);
    expect(toSubInput(keys('KeyA', 'KeyD')).yaw).toBe(0);
  });

  it('maps either Shift to boost and Space to fire', () => {
    expect(toSubInput(keys('ShiftLeft')).boost).toBe(true);
    expect(toSubInput(keys('ShiftRight')).boost).toBe(true);
    expect(toSubInput(keys('Space')).fire).toBe(true);
  });

  it('maps 1–4 to the launch controls (L5), and nothing else to a press', () => {
    expect(['Digit1', 'Digit2', 'Digit3', 'Digit4'].map(pressFor)).toEqual(['cradle', 'engines', 'clamps', 'door']);
    expect(pressFor('Digit5')).toBe('leave'); // phase 3 (M3, M6b): leave the seat
    expect(pressFor('KeyW')).toBeNull();
    expect(pressFor('Numpad1')).toBeNull();
    expect(pressFor('constructor')).toBeNull();
  });
});
