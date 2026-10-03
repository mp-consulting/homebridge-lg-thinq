/**
 * Small stateful utilities shared by the cooking appliances: an update pause controller that
 * replays a deferred refresh, and a command gate that de-duplicates concurrent commands.
 */
import { ONE_SECOND_MS, TWO_MINUTES_MS } from '../../lib/constants.js';
import { formatDateTime, formatDuration } from './helpers.js';

/**
 * Temporarily suspends characteristic refreshes (e.g. while the user is composing a command in
 * HomeKit, or right after a command was sent). Snapshots arriving during the pause are not lost:
 * the pause remembers that an update arrived and invokes `onResume` once it ends.
 */
export class UpdatePauser {
  private paused = false;
  private pending = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly onResume: () => void,
    private readonly fallbackMs: number = TWO_MINUTES_MS,
  ) {}

  public get isPaused(): boolean {
    return this.paused;
  }

  /** Pause (or extend/shorten the current pause) for `ms` milliseconds. */
  public pause(ms: number = this.fallbackMs): void {
    this.paused = true;
    this.clearTimer();
    this.timer = setTimeout(() => this.resume(), ms);
  }

  /** Record that an update arrived while paused; it is replayed when the pause ends. */
  public markPending(): void {
    this.pending = true;
    if (!this.timer) {
      this.timer = setTimeout(() => this.resume(), this.fallbackMs);
    }
  }

  /** End the pause now, replaying any update that arrived meanwhile. */
  public resume(): void {
    this.clearTimer();
    this.paused = false;
    if (this.pending) {
      this.pending = false;
      this.onResume();
    }
  }

  public dispose(): void {
    this.clearTimer();
    this.paused = false;
    this.pending = false;
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

/**
 * Serialises device commands: while one command is in flight (and for a short cool-down after
 * it settles) further commands are dropped. The busy flag is set synchronously before awaiting,
 * and a single tracked timer releases it, so overlapping calls cannot clear each other's lock.
 */
export class CommandGate {
  private busy = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly cooldownMs: number = ONE_SECOND_MS) {}

  public get isBusy(): boolean {
    return this.busy;
  }

  /** Run `command` unless another command is in flight. Returns false when the call was dropped. */
  public async run(command: () => Promise<void>): Promise<boolean> {
    if (this.busy) {
      return false;
    }
    this.busy = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    try {
      await command();
      return true;
    } finally {
      this.timer = setTimeout(() => {
        this.busy = false;
        this.timer = undefined;
      }, this.cooldownMs);
    }
  }

  public dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.busy = false;
  }
}

export interface CookTimeLabels {
  start: string;
  cookTime: string;
  end: string;
  timer: string;
}

/**
 * Tracks the "Start / Duration / End / Timer" strings shown as Television inputs. The start time
 * is captured once when cooking begins, and duration/end/timer strings are only recomputed when
 * the underlying value changes.
 */
export class CookTimeTracker {
  public startString: string;
  public cookTimeString: string;
  public endString: string;
  public timerString: string;
  public showTime = false;
  public showTimer = false;
  private startPending = true;
  private lastDuration = 0;
  private lastTimer = 0;

  constructor(private readonly defaults: CookTimeLabels) {
    this.startString = defaults.start;
    this.cookTimeString = defaults.cookTime;
    this.endString = defaults.end;
    this.timerString = defaults.timer;
  }

  public update(cooking: boolean, targetSeconds: number, timerSeconds: number, now: Date = new Date()): void {
    if (cooking) {
      if (this.startPending) {
        this.startString = 'Start: ' + formatDateTime(now);
        this.startPending = false;
      }
      this.showTime = true;
    } else {
      this.startPending = true;
      this.showTime = false;
      this.startString = this.defaults.start;
    }

    if (targetSeconds !== 0) {
      if (targetSeconds !== this.lastDuration) {
        this.lastDuration = targetSeconds;
        this.cookTimeString = 'Duration: ' + formatDuration(targetSeconds);
        this.endString = 'End: ' + formatDateTime(new Date(now.getTime() + targetSeconds * ONE_SECOND_MS));
      }
      this.showTime = true;
    } else {
      this.lastDuration = 0;
      this.cookTimeString = this.defaults.cookTime;
      this.endString = this.defaults.end;
    }

    if (timerSeconds !== 0) {
      if (timerSeconds !== this.lastTimer) {
        this.lastTimer = timerSeconds;
        this.timerString = 'Timer: ' + formatDuration(timerSeconds);
      }
      this.showTimer = true;
    } else {
      this.lastTimer = 0;
      this.showTimer = false;
      this.timerString = this.defaults.timer;
    }
  }
}
