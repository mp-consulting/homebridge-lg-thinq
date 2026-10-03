/**
 * Pure helpers shared by the cooking/cleaning appliances (Oven, Microwave, Dishwasher).
 *
 * Everything in this module is side-effect free so it can be unit tested in isolation.
 */
import {
  ISO_TIME_LENGTH,
  ISO_TIME_START_INDEX,
  MAX_NAME_LENGTH,
  ONE_HOUR_IN_SECONDS,
  ONE_SECOND_MS,
  TRUNCATED_NAME_LENGTH,
} from '../../lib/constants.js';

export const SECONDS_PER_MINUTE = 60;
const NAME_ELLIPSIS = '...';

/** Raw ThinQ snapshot data as reported by the device (fields are optional and loosely typed). */
export type SnapshotData = Record<string, unknown>;

/**
 * Truncate a HomeKit ConfiguredName so it stays under HomeKit's 64-character limit.
 */
export function truncateName(name: string): string {
  if (name.length >= MAX_NAME_LENGTH) {
    return name.slice(0, TRUNCATED_NAME_LENGTH) + NAME_ELLIPSIS;
  }
  return name;
}

/**
 * Coerce a snapshot value into a finite number. Missing/invalid values become 0.
 */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** True when the value is a finite number other than 0. */
export function isNonZeroNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value !== 0;
}

/** Null-safe `String.prototype.includes` for loosely typed snapshot fields. */
export function textIncludes(value: unknown, needle: string): boolean {
  return typeof value === 'string' && value.includes(needle);
}

/** True when the value is a reported string that does NOT contain `needle` (missing values yield false). */
export function textExcludes(value: unknown, needle: string): boolean {
  return typeof value === 'string' && !value.includes(needle);
}

/**
 * Sum hour/minute/second fields into a number of seconds. Missing or invalid parts count as 0.
 */
export function sumTimeFields(hours: unknown, minutes: unknown, seconds?: unknown): number {
  return toNumber(hours) * ONE_HOUR_IN_SECONDS + toNumber(minutes) * SECONDS_PER_MINUTE + toNumber(seconds);
}

/**
 * Sum the `${prefix}Hour`, `${prefix}Minute` and `${prefix}Second` fields of a snapshot.
 */
export function sumTimeFieldsByPrefix(data: SnapshotData | undefined, prefix: string): number {
  return sumTimeFields(data?.[prefix + 'Hour'], data?.[prefix + 'Minute'], data?.[prefix + 'Second']);
}

/**
 * Format seconds as `H:MM:SS` (UTC-based, so independent of the host time zone).
 * A single leading zero on the hour is stripped (`01:30:00` -> `1:30:00`).
 */
export function formatClock(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(toNumber(seconds)));
  const clock = new Date(safeSeconds * ONE_SECOND_MS).toISOString()
    .substring(ISO_TIME_START_INDEX, ISO_TIME_START_INDEX + ISO_TIME_LENGTH);
  return clock.startsWith('0') ? clock.substring(1) : clock;
}

/** Unit label used next to a formatted duration. */
export function durationUnit(seconds: number): 'Hours' | 'Hour' | 'Minutes' {
  if (seconds > ONE_HOUR_IN_SECONDS) {
    return 'Hours';
  }
  if (seconds === ONE_HOUR_IN_SECONDS) {
    return 'Hour';
  }
  return 'Minutes';
}

/** Format seconds as e.g. `1:30:00 Hours` / `0:05:00 Minutes`. */
export function formatDuration(seconds: number): string {
  return formatClock(seconds) + ' ' + durationUnit(seconds);
}

/**
 * Human readable date/time, e.g. `Monday, January 1, 2024 at 13:05:00 UTC`.
 */
export function formatDateTime(date: Date, style: 'long' | 'short' = 'long'): string {
  return date.toLocaleString('en-US', {
    weekday: style,
    year: 'numeric',
    month: style,
    day: 'numeric',
    hour12: false,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    timeZoneName: 'short',
  });
}

/** `SOME_VALUE` -> `Some_value`. Non-string input yields an empty string. */
export function capitalize(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    return '';
  }
  const lower = value.toLocaleLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Round to the nearest 0.5 (HomeKit temperature step). */
export function roundToHalf(value: number): number {
  return 0.5 * Math.round(2 * value);
}

export function tempCtoF(celsius: number): number {
  return Math.round(celsius * 1.8 + 32);
}

export function tempFtoC(fahrenheit: number): number {
  return roundToHalf((fahrenheit - 32) / 1.8);
}

export function isFahrenheit(unit: unknown): boolean {
  return textIncludes(unit, 'FAH');
}

/** Convert a device temperature in its reported unit to Celsius (rounded to 0.5). */
export function toCelsius(value: number, unit: unknown): number {
  return isFahrenheit(unit) ? tempFtoC(value) : roundToHalf(value);
}

/**
 * Cook temperature limits for a group of cook modes. The first entry whose `modes`
 * contains a substring of the requested mode wins, so order entries from most to least specific.
 */
export interface CookTempLimit {
  modes: readonly string[];
  fahrenheit: readonly [number, number];
  celsius: readonly [number, number];
}

export const OVEN_TEMP_LIMITS: readonly CookTempLimit[] = [
  {
    modes: ['CONVECTION_BAKE', 'CONVECTION_ROST', 'CONVECTION_ROAST', 'FROZEN_MEAL', 'AIR_FRY'],
    fahrenheit: [300, 550],
    celsius: [150, 285],
  },
  { modes: ['BAKE'], fahrenheit: [170, 550], celsius: [80, 285] },
  { modes: ['AIR_SOUSVIDE'], fahrenheit: [100, 205], celsius: [38, 96] },
];

export const MICROWAVE_TEMP_LIMITS: readonly CookTempLimit[] = [
  { modes: ['COMBI_BAKE', 'CONV_BAKE', 'COMBI_ROAST', 'OVEN'], fahrenheit: [250, 450], celsius: [125, 230] },
  { modes: ['DEHYDRATE'], fahrenheit: [100, 200], celsius: [38, 92] },
];

/**
 * Clamp a target cook temperature to the range supported by the given mode.
 * Modes without limits return the temperature unchanged; non-finite input clamps to the minimum.
 */
export function clampCookTemp(limits: readonly CookTempLimit[], mode: string, unit: unknown, temperature: number): number {
  const limit = limits.find(entry => entry.modes.some(m => mode.includes(m)));
  if (!limit) {
    return temperature;
  }
  const [min, max] = isFahrenheit(unit) ? limit.fahrenheit : limit.celsius;
  if (!Number.isFinite(temperature)) {
    return min;
  }
  return Math.min(max, Math.max(min, temperature));
}

/** A cooktop burner position, as reported by `cooktop{index}*` snapshot fields. */
export interface BurnerDefinition {
  index: number;
  label: string;
}

export interface BurnerStatus {
  name: string;
  inUse: boolean;
}

/**
 * Describe a burner from the snapshot, e.g. `Front Left Burner is On. Cooking for 0:05:00 Minutes`.
 */
export function burnerStatus(data: SnapshotData | undefined, burner: BurnerDefinition): BurnerStatus {
  const prefix = 'cooktop' + burner.index;
  const state = data?.[prefix + 'CooktopState'];
  if (state === undefined || state === null || state === 'INIT') {
    return { name: burner.label + ' Burner Not in Use', inUse: false };
  }
  const operationSeconds = sumTimeFieldsByPrefix(data, prefix + 'OperationTime');
  const name = operationSeconds !== 0
    ? burner.label + ' Burner is On. Cooking for ' + formatDuration(operationSeconds)
    : burner.label + ' Burner is On';
  return { name: truncateName(name), inUse: true };
}

/**
 * Edge detection: true only on the transition into `target` (not while staying in it).
 */
export function enteredState(previous: unknown, current: unknown, target: string): boolean {
  return current === target && previous !== target;
}

/** Promise-based sleep. */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
