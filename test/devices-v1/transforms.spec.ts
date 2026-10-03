import AirState, { ACOperation } from '../../src/devices-v1/transforms/AirState.js';
import AirPurifierState from '../../src/devices-v1/transforms/AirPurifierState.js';
import HoodState from '../../src/devices-v1/transforms/HoodState.js';
import RefState from '../../src/devices-v1/transforms/RefState.js';
import WasherDryer from '../../src/devices-v1/transforms/WasherDryer.js';
import { DeviceModel } from '../../src/models/DeviceModel.js';

const enumOf = (options: Record<string, string>) => ({ type: 'Enum', option: options });

const model = new DeviceModel({
  Value: {
    Operation: enumOf({ 0: ACOperation.OFF, 1: ACOperation.RIGHT_ON }),
    TempCur: { type: 'Range', option: { min: 16, max: 30 } },
    TempCfg: { type: 'Range', option: { min: 18, max: 30 } },
    VentMode: enumOf({ 0: '@VENT_MODE_NORMAL', 1: '@VENT_MODE_BOOST' }),
    Error: enumOf({ 0: '@ERROR_NONE', 5: '@ERROR_FAN' }),
    DoorOpenState: { ...enumOf({ 0: 'CLOSE', 1: 'OPEN' }), default: 'CLOSE' },
    TempRefrigerator: { type: 'Range', option: { min: 1, max: 7 }, default: '3' },
    TempFreezer: { type: 'Range', option: { min: -23, max: -15 }, default: '-18' },
    TempUnit: { type: 'Enum', option: { 0: 'F', 1: 'C' }, default: '1' },
    State: enumOf({ 0: '@WM_STATE_POWER_OFF_W', 1: '@WM_STATE_RUNNING_W', 2: '@WM_STATE_END_W' }),
    PreState: enumOf({ 0: '@WM_STATE_POWER_OFF_W', 1: '@WM_STATE_RUNNING_W' }),
  },
} as any);

describe('v1 AirState transform', () => {
  test('produces flat airState keys', () => {
    const s = AirState(model, { Operation: '1', OpMode: '0', TempCur: '25', TempCfg: '22', WindStrength: '4', Jet: '1', SensorHumidity: '45' });
    expect(s['airState.operation']).toBe(true);
    expect(s['airState.opMode']).toBe(0);
    expect(s['airState.tempState.current']).toBe(25);
    expect(s['airState.tempState.target']).toBe(22);
    expect(s['airState.windStrength']).toBe(4);
    expect(s['airState.wMode.jet']).toBe(1);
    expect(s['airState.humidity.current']).toBe(45);
  });

  test('power off and clamps temperatures to model minimum', () => {
    const s = AirState(model, { Operation: '0', TempCur: '5', TempCfg: '10' });
    expect(s['airState.operation']).toBe(false);
    expect(s['airState.tempState.current']).toBe(16);
    expect(s['airState.tempState.target']).toBe(18);
  });

  test('AirPurifierState sets operation and airFast booleans', () => {
    const s = AirPurifierState(model, { Operation: '1', AirFast: '0', SensorPM2: '9' });
    expect(s['airState.operation']).toBe(true);
    expect(s['airState.miscFuncState.airFast']).toBe(false);
    expect(s['airState.quality.PM2']).toBe(9);
  });
});

describe('v1 HoodState transform', () => {
  test('error is decoded from the Error field, not VentMode', () => {
    const s = HoodState(model, { VentMode: '1', Error: '5', VentLevel: '2', LampLevel: '1', HoodState: '1' });
    expect(s.hoodState.ventMode).toBe('@VENT_MODE_BOOST');
    expect(s.hoodState.error).toBe('@ERROR_FAN');
    expect(s.hoodState.ventLevel).toBe(2);
    expect(s.hoodState.lampLevel).toBe(1);
    expect(s.hoodState.hoodState).toBe('USING');
  });
});

describe('v1 RefState transform', () => {
  test('maps temperatures, door, unit and optional modes', () => {
    const s = RefState(model, { TempRefrigerator: '4', TempFreezer: '-20', DoorOpenState: '1', TempUnit: '1', IcePlus: '1' });
    expect(s.refState.fridgeTemp).toBe(4);
    expect(s.refState.freezerTemp).toBe(-20);
    expect(s.refState.atLeastOneDoorOpen).toBe('OPEN');
    expect(s.refState.tempUnit).toBe('CELSIUS');
    expect(s.refState.expressMode).toBe('1');
    expect('expressFridge' in s.refState).toBe(false);
  });

  test('falls back to model defaults', () => {
    const s = RefState(model, {});
    expect(s.refState.fridgeTemp).toBe(3);
    expect(s.refState.freezerTemp).toBe(-18);
    expect(s.refState.atLeastOneDoorOpen).toBe('CLOSE');
  });
});

describe('v1 WasherDryer transform', () => {
  test('maps state and times', () => {
    const s = WasherDryer(model, { State: '1', PreState: '0', Remain_Time_H: '1', Remain_Time_M: '30', TCLCount: 3 });
    expect(s.washerDryer.state).toBe('RUNNING');
    expect(s.washerDryer.preState).toBe('POWEROFF');
    expect(s.washerDryer.remainTimeHour).toBe(1);
    expect(s.washerDryer.remainTimeMinute).toBe(30);
    expect(s.washerDryer.TCLCount).toBe(3);
  });

  test('defaults to POWEROFF when unknown', () => {
    expect(WasherDryer(model, {}).washerDryer.state).toBe('POWEROFF');
  });
});
