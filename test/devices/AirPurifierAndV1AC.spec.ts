import AirPurifier from '../../src/devices/AirPurifier.js';
import AirPurifierV1 from '../../src/devices-v1/devices/AirPurifier.js';
import AC from '../../src/devices-v1/devices/AC.js';
import Styler from '../../src/devices/Styler.js';
import { Device } from '../../src/models/Device.js';
import { DeviceModel } from '../../src/models/DeviceModel.js';
import { FakeAccessory, makePlatform, Characteristic, makeACDevice } from './mockHap.js';

function purifier(Cls: typeof AirPurifier, platformType = 'thinq2') {
  const device = new Device({
    deviceId: 'p1', alias: 'Purifier', modelJsonUri: '', deviceType: 402, platformType,
    snapshot: { 'airState.operation': 1, 'airState.opMode': 14, 'airState.windStrength': 4 },
  } as any);
  device.deviceModel = new DeviceModel({ Value: {} } as any);
  const platform = makePlatform({ id: device.id });
  const accessory = new FakeAccessory({ device });
  return { p: new Cls(platform, accessory as any, platform.log), platform, device, accessory };
}

describe('AirPurifier (v2)', () => {
  test('is powered on with flat-key snapshot (registry regression)', () => {
    const { p } = purifier(AirPurifier);
    expect(p.Status.isPowerOn).toBe(true);
  });

  test.each([[0, 2], [1, 2], [4, 7], [9, 7]])('rotation %s -> windStrength %s', async (v, ws) => {
    const { p, platform, device } = purifier(AirPurifier);
    await p.setRotationSpeed(v);
    expect(platform.ThinQ.deviceControl).toHaveBeenCalledWith(device.id, { dataKey: 'airState.windStrength', dataValue: ws });
  });

  test('failed control throws a HAP error', async () => {
    const { p, platform } = purifier(AirPurifier);
    platform.ThinQ.deviceControl.mockResolvedValueOnce(false);
    await expect(p.setSwingMode(true)).rejects.toMatchObject({ hapStatus: -70402 });
  });
});

describe('AirPurifier (v1)', () => {
  test.each([[0, '2'], [2, '4'], [4, '7']])('rotation %s -> WindStrength %s', async (v, ws) => {
    const { p, platform, device } = purifier(AirPurifierV1, 'thinq1');
    await p.setRotationSpeed(v);
    expect(platform.ThinQ.thinq1DeviceControl).toHaveBeenCalledWith(device, 'WindStrength', ws);
  });
});

describe('v1 AC', () => {
  function build() {
    const device = makeACDevice({ platformType: 'thinq1' });
    device.deviceModel = new DeviceModel({ Value: {}, Info: {} } as any); // no TempCur / TempCfg
    const platform = makePlatform({ id: device.id });
    const accessory = new FakeAccessory({ device });
    return { ac: new AC(platform, accessory as any, platform.log), platform, device, accessory };
  }

  test('constructs without TempCur/TempCfg in the model', () => {
    const { accessory, device } = build();
    const props = accessory.getService(device.name)!.getCharacteristic(Characteristic.CoolingThresholdTemperature).props;
    expect(props.minValue).toBe(10);
    expect(props.maxValue).toBe(38);
  });

  test.each([[0, 2], [50, 4], [80, 5], [100, 6]])('fan speed %s%% -> WindStrength %s', async (pct, ws) => {
    const { ac, platform, device } = build();
    await ac.setFanSpeed(pct);
    expect(platform.ThinQ.thinq1DeviceControl).toHaveBeenCalledWith(device, 'WindStrength', ws);
  });

  test('does not start the v2 monitor interval', () => {
    const { ac } = build();
    expect((ac as any).monitorInterval).toBeUndefined();
  });
});

describe('Styler', () => {
  test('setActive reverts the HomeKit toggle to the actual state', async () => {
    vi.useFakeTimers();
    const device = new Device({ deviceId: 's1', alias: 'Styler', modelJsonUri: '', deviceType: 203, snapshot: { styler: { state: 'POWEROFF' } } } as any);
    device.deviceModel = new DeviceModel({ MonitoringValue: {} } as any);
    const platform = makePlatform({ id: device.id });
    const accessory = new FakeAccessory({ device });
    const styler = new Styler(platform, accessory as any, platform.log);
    const active = accessory.getService('Styler')!.getCharacteristic(Characteristic.Active);
    active.updateValue(1);
    await styler.setActive(1);
    vi.advanceTimersByTime(200);
    expect(active.value).toBe(0);
    vi.useRealTimers();
  });
});
