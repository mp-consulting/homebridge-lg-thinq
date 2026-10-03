import { readFileSync } from 'fs';
import {
  ACStatus, AC_FAN_SPEEDS, AC_FAN_SPEED_DEFAULT_PERCENT, FAN_SPEED_AUTO, FanSpeed, OpMode,
  percentToWindStrength, windStrengthToPercent,
} from '../../src/status/ACStatus.js';
import { DeviceModel } from '../../src/models/DeviceModel.js';
import { Device } from '../../src/models/Device.js';
import { fToC } from '../../src/utils/TemperatureConverter.js';

const load = (name: string) => JSON.parse(readFileSync(new URL(`../../sample/${name}`, import.meta.url), 'utf8'));

function makeDevice(snapshot: Record<string, unknown>) {
  const device = new Device({ ...load('airconditioner.json'), snapshot });
  device.deviceModel = new DeviceModel(load('airconditioner-model.json'));
  return device;
}

describe('ACStatus (sample/airconditioner-snapshot.json)', () => {
  const snapshot = load('airconditioner-snapshot.json');
  const device = makeDevice(snapshot);
  const status = new ACStatus(device.snapshot, device, { ac_temperature_unit: 'C' });

  test('reads flat airState.* keys from the root snapshot', () => {
    expect(status.isPowerOn).toBe(true);
    expect(status.opMode).toBe(OpMode.COOL);
    expect(status.currentTemperature).toBe(26.5);
    expect(status.targetTemperature).toBe(26);
    expect(status.targetTemperatureLG).toBe(26);
    expect(status.isLightOn).toBe(true);
    expect(status.isSwingOn).toBe(true);
    expect(status.currentConsumption).toBe(5.64);
    expect(status.isWindStrengthAuto).toBe(true);
    expect(status.windStrength).toBe(AC_FAN_SPEED_DEFAULT_PERCENT);
    expect(status.airQuality).toEqual({ isOn: true, overall: 0, PM2: 0, PM10: 0 });
    expect(status.type).toBe('RAC');
  });

  test('reports power off', () => {
    const off = new ACStatus({ ...snapshot, 'airState.operation': 0 }, device, { ac_temperature_unit: 'C' });
    expect(off.isPowerOn).toBe(false);
  });

  test('handles a missing snapshot', () => {
    const empty = new ACStatus(undefined, device, { ac_temperature_unit: 'C' });
    expect(empty.isPowerOn).toBe(false);
    expect(empty.airQuality).toBeNull();
    expect(empty.currentConsumption).toBe(0);
  });

  test('cooling temperature range comes from the model', () => {
    const range = status.getTemperatureRange(status.getTemperatureRangeForCooling());
    expect(range.min).toBeGreaterThan(0);
    expect(range.max).toBeGreaterThan(range.min);
  });

  test('Fahrenheit unit uses the model tables consistently in both directions', () => {
    const f = new ACStatus(snapshot, device, { ac_temperature_unit: 'F' });
    expect(f.isFahrenheitUnit).toBe(true);
    expect(f.targetTemperature).toBe(fToC(78)); // 26 °C -> 78 °F on LG table
    expect(f.convertTemperatureCelsiusFromHomekitToLG(f.targetTemperature)).toBe(26);
    expect(f.convertTemperatureCelsiusFromLGToHomekit(22.5)).toBe(fToC(73));
  });

  test('humidity above 100 is scaled', () => {
    const s = new ACStatus({ 'airState.humidity.current': 455 }, device, { ac_temperature_unit: 'C' });
    expect(s.currentRelativeHumidity).toBe(45.5);
  });
});

describe('AC fan speed mapping', () => {
  test('explicit speed list', () => {
    expect(AC_FAN_SPEEDS).toEqual([2, 3, 4, 5, 6]);
  });

  test.each([
    [0, FanSpeed.LOW],
    [-10, FanSpeed.LOW],
    [10, FanSpeed.LOW],
    [25, FanSpeed.LOW_MEDIUM],
    [50, FanSpeed.MEDIUM],
    [75, FanSpeed.MEDIUM_HIGH],
    [100, FanSpeed.HIGH],
    [150, FanSpeed.HIGH],
    [NaN, FanSpeed.LOW],
  ])('percentToWindStrength(%s) = %s', (percent, expected) => {
    expect(percentToWindStrength(percent)).toBe(expected);
  });

  test.each([
    [FanSpeed.LOW, 1],
    [FanSpeed.LOW_MEDIUM, 25],
    [FanSpeed.MEDIUM, 50],
    [FanSpeed.MEDIUM_HIGH, 75],
    [FanSpeed.HIGH, 100],
    [FAN_SPEED_AUTO, AC_FAN_SPEED_DEFAULT_PERCENT],
    [undefined, AC_FAN_SPEED_DEFAULT_PERCENT],
    [99, AC_FAN_SPEED_DEFAULT_PERCENT],
  ])('windStrengthToPercent(%s) = %s', (ws, expected) => {
    expect(windStrengthToPercent(ws)).toBe(expected);
  });

  test('round-trips every manual speed', () => {
    for (const ws of AC_FAN_SPEEDS) {
      expect(percentToWindStrength(windStrengthToPercent(ws))).toBe(ws);
    }
  });
});
