import WasherDryer from '../../src/devices/WasherDryer.js';
import WasherDryer2 from '../../src/devices/WasherDryer2.js';
import Refrigerator from '../../src/devices/Refrigerator.js';
import RefrigeratorV1 from '../../src/devices-v1/devices/Refrigerator.js';
import { Device } from '../../src/models/Device.js';
import { DeviceModel } from '../../src/models/DeviceModel.js';
import { FakeAccessory, makePlatform, Characteristic } from './mockHap.js';

function makeDevice(deviceType: number, snapshot: Record<string, unknown>, platformType = 'thinq2') {
  const device = new Device({ deviceId: 'w1', alias: 'Washer', modelJsonUri: '', deviceType, platformType, snapshot } as any);
  device.deviceModel = new DeviceModel({ MonitoringValue: {} } as any);
  return device;
}

function build(Cls: typeof WasherDryer, deviceType: number, snapshot: Record<string, unknown>) {
  const device = makeDevice(deviceType, snapshot);
  const platform = makePlatform({ id: device.id, washer_trigger: true, washer_door_lock: true });
  const accessory = new FakeAccessory({ device });
  const washer = new Cls(platform, accessory as any, platform.log);
  return { washer, accessory, device };
}

describe('WasherDryer program finished', () => {
  test('detects END from a sparse delta using the merged state', () => {
    const { washer, accessory } = build(WasherDryer, 201, { washerDryer: { state: 'RUNNING', doorLock: 'DOORLOCK_ON' } });
    const sensor = accessory.getService('Program Finished')!.getCharacteristic(Characteristic.OccupancyDetected);

    washer.update({ washerDryer: { remainTimeMinute: 3 } });
    expect(sensor.value).toBe(0);
    // delta only contains `state` (no preState) -> still detected
    washer.update({ washerDryer: { state: 'END' } });
    expect(sensor.value).toBe(1);
  });

  test('does not fire on END at startup without a running transition', () => {
    const { washer, accessory } = build(WasherDryer, 201, { washerDryer: { state: 'END' } });
    const sensor = accessory.getService('Program Finished')!.getCharacteristic(Characteristic.OccupancyDetected);
    washer.update({ washerDryer: { state: 'END' } });
    expect(sensor.value).toBe(0);
  });

  test('LockCurrentState has no onSet handler', () => {
    const { accessory } = build(WasherDryer, 201, { washerDryer: { state: 'RUNNING', doorLock: 'DOORLOCK_ON' } });
    const door = accessory.getService('Door')!;
    expect(door.getCharacteristic(Characteristic.LockCurrentState).setHandler).toBeUndefined();
  });
});

describe('WasherDryer2 (WASH_TOWER_2)', () => {
  test('door lock service is created from snapshot.washer and payload is not mutated', () => {
    const { washer, accessory, device } = build(WasherDryer2, 223, { washer: { state: 'RUNNING', doorLock: 'DOORLOCK_ON' } });
    expect(accessory.getService('Door')).toBeDefined();

    const payload = { washer: { state: 'END' } };
    washer.update(payload);
    expect(payload).toEqual({ washer: { state: 'END' } });
    expect(device.snapshot.washerDryer).toBeUndefined();
    expect(washer.Status.state).toBe('END');
    expect(accessory.getService('Program Finished')!.getCharacteristic(Characteristic.OccupancyDetected).value).toBe(1);
  });

  test('payload without washer root does not clobber state', () => {
    const { washer } = build(WasherDryer2, 223, { washer: { state: 'RUNNING' } });
    washer.update({ dryer: { state: 'RUNNING' } });
    expect(washer.Status.isRunning).toBe(true);
  });
});

describe('Refrigerator robustness', () => {
  test('constructor and update do not throw when refState is missing', () => {
    const device = makeDevice(101, {});
    device.deviceModel = new DeviceModel({ MonitoringValue: {}, Config: { visibleItems: [] } } as any);
    const platform = makePlatform({ id: device.id, ref_express_freezer: true, ref_express_fridge: true, ref_eco_friendly: true });
    const accessory = new FakeAccessory({ device });
    const ref = new Refrigerator(platform, accessory as any, platform.log);
    expect(() => ref.updateAccessoryCharacteristic(device)).not.toThrow();
  });

  test('thermostat props fall back to defaults when no numeric mapping exists', () => {
    const device = makeDevice(101, { refState: { fridgeTemp: 3, tempUnit: 'CELSIUS' } });
    device.deviceModel = new DeviceModel({
      MonitoringValue: { fridgeTemp_C: { valueMapping: { IGNORE: { label: 'IGNORE' } } } },
      Config: { visibleItems: [{ Feature: 'fridgeTemp', ControlTitle: 'x' }] },
    } as any);
    const platform = makePlatform({ id: device.id });
    const accessory = new FakeAccessory({ device });
    new Refrigerator(platform, accessory as any, platform.log);
    const props = accessory.getService('Fridge')!.getCharacteristic(Characteristic.TargetTemperature).props;
    expect(Number.isFinite(props.minValue)).toBe(true);
    expect(Number.isFinite(props.maxValue)).toBe(true);
  });

  test('express mode failure surfaces as HAP error', async () => {
    const device = makeDevice(101, { refState: { expressMode: 'OFF', tempUnit: 'CELSIUS' } });
    device.deviceModel = new DeviceModel({ MonitoringValue: {}, Config: { visibleItems: [] } } as any);
    const platform = makePlatform({ id: device.id });
    const ref = new Refrigerator(platform, new FakeAccessory({ device }) as any, platform.log);
    platform.ThinQ.deviceControl.mockRejectedValueOnce(new Error('x'));
    await expect(ref.setExpressMode(true)).rejects.toMatchObject({ hapStatus: -70402 });
  });

  test('v1 toggles await thinq1DeviceControl', async () => {
    const device = makeDevice(101, { refState: { tempUnit: 'CELSIUS' } }, 'thinq1');
    device.deviceModel = new DeviceModel({ Value: {}, Config: { visibleItems: [] } } as any);
    const platform = makePlatform({ id: device.id });
    let resolved = false;
    platform.ThinQ.thinq1DeviceControl.mockImplementation(() => new Promise(r => setTimeout(() => {
      resolved = true; r({});
    }, 5)));
    const ref = new RefrigeratorV1(platform, new FakeAccessory({ device }) as any, platform.log);
    await ref.setExpressMode(true);
    expect(resolved).toBe(true);
    await ref.setEcoFriendly(false);
    expect(platform.ThinQ.thinq1DeviceControl).toHaveBeenLastCalledWith(device, 'EcoFriendly', null);
  });
});
