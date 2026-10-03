import { vi } from 'vitest';
import { CommandGate, CookTimeTracker, UpdatePauser } from '../../src/devices/cooking/controls.js';

describe('UpdatePauser', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('replays an update that arrived during the pause when it ends', () => {
    const onResume = vi.fn();
    const pauser = new UpdatePauser(onResume, 120000);
    pauser.pause(10000);
    expect(pauser.isPaused).toBe(true);
    pauser.markPending();
    pauser.markPending();
    vi.advanceTimersByTime(9999);
    expect(onResume).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(pauser.isPaused).toBe(false);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('does not replay when nothing arrived', () => {
    const onResume = vi.fn();
    const pauser = new UpdatePauser(onResume);
    pauser.pause(1000);
    vi.advanceTimersByTime(1000);
    expect(onResume).not.toHaveBeenCalled();
  });

  it('keeps a single timer when re-pausing', () => {
    const onResume = vi.fn();
    const pauser = new UpdatePauser(onResume);
    pauser.pause(120000);
    pauser.pause(10000);
    expect(vi.getTimerCount()).toBe(1);
    pauser.markPending();
    vi.advanceTimersByTime(10000);
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('dispose clears the timer without replaying', () => {
    const onResume = vi.fn();
    const pauser = new UpdatePauser(onResume);
    pauser.pause(1000);
    pauser.markPending();
    pauser.dispose();
    vi.advanceTimersByTime(5000);
    expect(onResume).not.toHaveBeenCalled();
    expect(pauser.isPaused).toBe(false);
  });
});

describe('CommandGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('locks synchronously so a concurrent call is dropped', async () => {
    const gate = new CommandGate(1000);
    let release!: () => void;
    const first = gate.run(() => new Promise<void>(resolve => {
      release = resolve;
    }));
    expect(gate.isBusy).toBe(true);
    const second = vi.fn().mockResolvedValue(undefined);
    await expect(gate.run(second)).resolves.toBe(false);
    expect(second).not.toHaveBeenCalled();
    release();
    await expect(first).resolves.toBe(true);
    expect(gate.isBusy).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(gate.isBusy).toBe(false);
  });

  it('propagates command errors and still releases the lock', async () => {
    const gate = new CommandGate(500);
    await expect(gate.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    vi.advanceTimersByTime(500);
    expect(gate.isBusy).toBe(false);
    await expect(gate.run(() => Promise.resolve())).resolves.toBe(true);
  });
});

describe('CookTimeTracker', () => {
  const defaults = { start: 'start?', cookTime: 'cook?', end: 'end?', timer: 'timer?' };

  it('starts with defaults and hidden inputs', () => {
    const tracker = new CookTimeTracker(defaults);
    expect(tracker.startString).toBe('start?');
    expect(tracker.showTime).toBe(false);
    expect(tracker.showTimer).toBe(false);
  });

  it('captures the start time once and formats duration/timer', () => {
    const tracker = new CookTimeTracker(defaults);
    const t0 = new Date(Date.UTC(2024, 0, 1, 12, 0, 0));
    tracker.update(true, 1800, 300, t0);
    const start = tracker.startString;
    expect(start.startsWith('Start: ')).toBe(true);
    expect(tracker.cookTimeString).toBe('Duration: 0:30:00 Minutes');
    expect(tracker.timerString).toBe('Timer: 0:05:00 Minutes');
    expect(tracker.showTime).toBe(true);
    expect(tracker.showTimer).toBe(true);

    tracker.update(true, 1800, 300, new Date(t0.getTime() + 3600000));
    expect(tracker.startString).toBe(start);

    tracker.update(false, 0, 0, t0);
    expect(tracker.startString).toBe('start?');
    expect(tracker.cookTimeString).toBe('cook?');
    expect(tracker.endString).toBe('end?');
    expect(tracker.timerString).toBe('timer?');
    expect(tracker.showTime).toBe(false);
    expect(tracker.showTimer).toBe(false);
  });
});
