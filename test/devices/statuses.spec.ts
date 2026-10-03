import { AirPurifierStatus, AIR_PURIFIER_SPEEDS, RotateSpeed, rotationSpeedToWindStrength, windStrengthToRotationSpeed } from '../../src/devices/AirPurifier.js';
import { DehumidifierStatus, DEHUMIDIFIER_SPEEDS, dehumidifierSpeedToWindStrength } from '../../src/devices/Dehumidifier.js';
import { RefrigeratorStatus } from '../../src/devices/Refrigerator.js';
import { WasherDryerStatus } from '../../src/devices/WasherDryer.js';
import { DeviceRegistry } from '../../src/models/DeviceRegistry.js';
import type { DeviceModel } from '../../src/models/DeviceModel.js';
import { FILTER_CHANGE_THRESHOLD_PERCENT } from '../../src/lib/constants.js';

const model = {
  lookupMonitorName: () => null,
} as unknown as DeviceModel;

/** Mimic BaseDevice.getStatus: pass the registry sub-key or the whole snapshot */
function statusFor<T>(type: string, Cls: new (data: any, model: DeviceModel) => T, snapshot: Record<string, any>): T {
  const key = DeviceRegistry.getSnapshotKey(type);
  return new Cls(key ? snapshot[key] : snapshot, model);
}

describe('DeviceRegistry snapshot keys', () => {
  test.each(['AC', 'AIR_PURIFIER', 'AERO_TOWER', 'DEHUMIDIFIER'])('%s uses the whole (flat-keyed) snapshot', (type) => {
    expect(DeviceRegistry.getSnapshotKey(type)).toBeUndefined();
  });

  test.each([
    ['REFRIGERATOR', 'refState'],
    ['WASHER', 'washerDryer'],
    ['WASH_TOWER_2', 'washer'],
    ['HOOD', 'hoodState'],
    ['STYLER', 'styler'],
  ])('%s -> %s', (type, key) => {
    expect(DeviceRegistry.getSnapshotKey(type)).toBe(key);
  });
});

describe('AirPurifierStatus with flat keys', () => {
  const snapshot = {
    'airState.operation': 1,
    'airState.opMode': 14,
    'airState.windStrength': 6,
    'airState.circulate.rotate': 1,
    'airState.lightingState.signal': 1,
    'airState.quality.overall': 2,
    'airState.quality.PM2': 12,
    'airState.quality.PM10': 20,
    'airState.miscFuncState.airFast': 1,
    'airState.filterMngStates.useTime': 100,
    'airState.filterMngStates.maxTime': 1000,
  };

  test('reads power and state through the registry (regression: isPowerOn always false)', () => {
    const s = statusFor('AIR_PURIFIER', AirPurifierStatus, snapshot);
    expect(s.isPowerOn).toBe(true);
    expect(s.isNormalMode).toBe(true);
    expect(s.isSwing).toBe(true);
    expect(s.isLightOn).toBe(true);
    expect(s.isAirFastEnable).toBe(true);
    expect(s.rotationSpeed).toBe(3);
    expect(s.airQuality).toEqual({ isOn: true, overall: 2, PM2: 12, PM10: 20 });
    expect(s.filterRemainingPercent).toBe(90);
    expect(s.filterUsedTimePercent).toBe(90);
  });

  test('AERO_TOWER and v1 boolean operation values', () => {
    expect(statusFor('AERO_TOWER', AirPurifierStatus, { 'airState.operation': true }).isPowerOn).toBe(true);
    expect(statusFor('AIR_PURIFIER', AirPurifierStatus, { 'airState.operation': 0 }).isPowerOn).toBe(false);
  });

  test.each([
    [100, false], // new
    [50, false],
    [100 - FILTER_CHANGE_THRESHOLD_PERCENT, false],
    [4, true], // worn
    [0, true], // over max (clamped to 0)
  ])('needsFilterChange(remaining=%s) = %s', (remaining, expected) => {
    expect(AirPurifierStatus.needsFilterChange(remaining)).toBe(expected);
  });

  test('filter over max is clamped to 0', () => {
    const s = new AirPurifierStatus({ 'airState.filterMngStates.useTime': 2000, 'airState.filterMngStates.maxTime': 1000 }, model);
    expect(s.filterRemainingPercent).toBe(0);
  });
});

describe('Air purifier rotation speed mapping', () => {
  test('explicit list', () => {
    expect(AIR_PURIFIER_SPEEDS).toEqual([2, 4, 6, 7]);
  });

  test.each([
    [0, RotateSpeed.LOW], // regression: values[-1] -> fell back to EXTRA
    [0.3, RotateSpeed.LOW],
    [1, RotateSpeed.LOW],
    [2, RotateSpeed.MEDIUM],
    [2.6, RotateSpeed.HIGH],
    [4, RotateSpeed.EXTRA],
    [100, RotateSpeed.EXTRA],
    [NaN, RotateSpeed.LOW],
  ])('rotationSpeedToWindStrength(%s) = %s', (v, expected) => {
    expect(rotationSpeedToWindStrength(v)).toBe(expected);
  });

  test.each([
    [2, 1], [4, 2], [6, 3], [7, 4], [99, 2],
  ])('windStrengthToRotationSpeed(%s) = %s', (ws, expected) => {
    expect(windStrengthToRotationSpeed(ws)).toBe(expected);
  });
});

describe('DehumidifierStatus with flat keys', () => {
  test('reads root-level airState keys', () => {
    const s = statusFor('DEHUMIDIFIER', DehumidifierStatus, {
      'airState.operation': 1,
      'airState.opMode': 17,
      'airState.windStrength': 6,
      'airState.humidity.current': 60,
      'airState.humidity.desired': 50,
      'airState.notificationExt': 1,
    });
    expect(s.isPowerOn).toBe(true);
    expect(s.isDehumidifying).toBe(true);
    expect(s.rotationSpeed).toBe(2);
    expect(s.humidityCurrent).toBe(60);
    expect(s.humidityTarget).toBe(50);
    expect(s.isWaterTankFull).toBe(true);
  });

  test.each([
    [0, 2], [1, 2], [1.6, 6], [2, 6], [10, 6],
  ])('dehumidifierSpeedToWindStrength(%s) = %s', (v, expected) => {
    expect(DEHUMIDIFIER_SPEEDS).toEqual([2, 6]);
    expect(dehumidifierSpeedToWindStrength(v)).toBe(expected);
  });
});

describe('RefrigeratorStatus.waterFilterRemain', () => {
  test.each([
    [{ waterFilter1RemainP: 80 }, 80],
    [{ waterFilter1RemainP: 150 }, 100],
    [{ waterFilter: '3_MONTH' }, 75],
    [{ waterFilter: '12_' }, 0], // regression: /(\d)_/ captured only "2"
    [{ waterFilter: '6_' }, 50],
    [{ waterFilter: 'NO_FILTER' }, 0], // regression: .match() null -> TypeError
    [{}, 0],
  ])('%j -> %s', (data, expected) => {
    expect(new RefrigeratorStatus(data, model).waterFilterRemain).toBe(expected);
  });

  test('handles missing refState', () => {
    expect(new RefrigeratorStatus(undefined, model).waterFilterRemain).toBe(0);
    expect(new RefrigeratorStatus(undefined, model).tempUnit).toBe('CELSIUS');
  });
});

describe('WasherDryerStatus', () => {
  test('state transitions', () => {
    expect(new WasherDryerStatus({ state: 'RUNNING' }, model).isRunning).toBe(true);
    expect(new WasherDryerStatus({ state: 'END' }, model).isRunning).toBe(false);
    expect(new WasherDryerStatus({ state: 'POWEROFF' }, model).isPowerOn).toBe(false);
    expect(new WasherDryerStatus({ state: 'RUNNING', remainTimeHour: 1, remainTimeMinute: 5 }, model).remainDuration).toBe(3900);
  });

  test('WASH_TOWER_2 status is read from snapshot.washer', () => {
    const s = statusFor('WASH_TOWER_2', WasherDryerStatus, { washer: { state: 'RUNNING' } });
    expect(s.state).toBe('RUNNING');
  });
});
