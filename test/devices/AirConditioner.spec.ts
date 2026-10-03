import AirConditioner from '../../src/devices/AirConditioner.js';
import { FakeAccessory, HapStatusError, makeACDevice, makePlatform, Characteristic } from './mockHap.js';

function build(config: Record<string, unknown> = {}, deviceOverrides: Record<string, unknown> = {}) {
  const device = makeACDevice(deviceOverrides);
  const platform = makePlatform({ id: device.id, ...config });
  const accessory = new FakeAccessory({ device });
  const ac = new AirConditioner(platform, accessory as any, platform.log);
  return { ac, device, platform, accessory };
}

const buttons = [
  { name: 'Dry', op_mode: '1' },
  { name: 'Fan', op_mode: '2' },
  { name: 'Clean', op_mode: '5' },
];

afterEach(() => {
  vi.useRealTimers();
});

describe('AirConditioner buttons', () => {
  test('re-setup removes ALL previously linked buttons (no skipping)', () => {
    const { ac, accessory, device, platform } = build({ ac_buttons: buttons });
    const label = accessory.getService('Buttons')!;
    expect(label.linkedServices.map(s => s.displayName)).toEqual(['Dry', 'Fan', 'Clean']);

    accessory.removeService.mockClear();
    ac.setupButton(device);
    // all 3 old buttons removed, then recreated
    expect(accessory.removeService).toHaveBeenCalledTimes(3);
    expect(label.linkedServices.map(s => s.displayName)).toEqual(['Dry', 'Fan', 'Clean']);
    expect(accessory.services.filter(s => ['Dry', 'Fan', 'Clean'].includes(s.displayName))).toHaveLength(3);

    // config now has no buttons -> buttons and label removed
    platform.config.devices[0].ac_buttons = [];
    ac.setupButton(device);
    expect(accessory.getService('Buttons')).toBeUndefined();
    expect(accessory.services.filter(s => ['Dry', 'Fan', 'Clean'].includes(s.displayName))).toHaveLength(0);
  });

  test('button onSet returns the promise and throws when setOpMode fails, without writing the snapshot', async () => {
    const { accessory, device, platform } = build({ ac_buttons: buttons });
    const dry = accessory.getService('Dry')!.getCharacteristic(Characteristic.On);
    platform.ThinQ.deviceControl.mockResolvedValueOnce(false);
    await expect(dry.setHandler!(true)).rejects.toBeInstanceOf(HapStatusError);
    expect(device.snapshot['airState.opMode']).toBe(0);

    await dry.setHandler!(true);
    expect(device.snapshot['airState.opMode']).toBe(1);
  });
});

describe('AirConditioner controls', () => {
  test('setActive throws SERVICE_COMMUNICATION_FAILURE and keeps snapshot on failure', async () => {
    const { ac, device, platform } = build();
    platform.ThinQ.deviceControl.mockRejectedValueOnce(new Error('network'));
    await expect(ac.setActive(0)).rejects.toMatchObject({ hapStatus: -70402 });
    expect(device.snapshot['airState.operation']).toBe(1);

    await ac.setActive(0);
    expect(platform.ThinQ.deviceControl).toHaveBeenLastCalledWith(device.id, { dataKey: 'airState.operation', dataValue: 0 }, 'Operation');
    expect(device.snapshot['airState.operation']).toBe(0);
    expect(ac.Status.isPowerOn).toBe(false);
  });

  test('mode switches share one setter and only write snapshot on success', async () => {
    const { ac, device, platform } = build();
    platform.ThinQ.deviceControl.mockResolvedValueOnce(false);
    await expect(ac.setJetModeActive(true)).rejects.toBeInstanceOf(HapStatusError);
    expect(device.snapshot['airState.wMode.jet']).toBe(0);

    await ac.setJetModeActive(true);
    expect(device.snapshot['airState.wMode.jet']).toBe(1);
    await ac.setLight(false);
    expect(device.snapshot['airState.lightingState.displayControl']).toBe(0);
  });

  test('fan speed percentage maps onto wind strength', async () => {
    const { ac, device, platform } = build();
    await ac.setFanSpeed(0);
    expect(platform.ThinQ.deviceControl).toHaveBeenLastCalledWith(device.id, { dataKey: 'airState.windStrength', dataValue: 2 }, 'Set');
    await ac.setFanSpeed(100);
    expect(device.snapshot['airState.windStrength']).toBe(6);
  });

  test('target temperature dedupe compares device units (Fahrenheit)', async () => {
    const { ac, platform } = build({ ac_temperature_unit: 'F' });
    // device target is 26 °C (= 78 °F); HomeKit shows fToC(78) = 25.56
    await ac.setTargetTemperature(ac.Status.targetTemperature);
    expect(platform.ThinQ.deviceControl).not.toHaveBeenCalled();
    await ac.setTargetTemperature(22.22); // 72 °F -> 22 °C
    expect(platform.ThinQ.deviceControl).toHaveBeenCalledWith(expect.any(String), { dataKey: 'airState.tempState.target', dataValue: 22 }, 'Set');
  });

  test('Status is cached until the snapshot changes', () => {
    const { ac, device } = build();
    const a = ac.Status;
    expect(ac.Status).toBe(a);
    ac.update({ 'airState.operation': 0 });
    expect(ac.Status).not.toBe(a);
    expect(ac.Status.isPowerOn).toBe(false);
    expect(device.snapshot['airState.opMode']).toBe(0);
  });
});

describe('AirConditioner services', () => {
  test('stale air quality / fan services are removed when disabled', () => {
    const device = makeACDevice();
    const platform = makePlatform({ id: device.id });
    const accessory = new FakeAccessory({ device });
    const staleAQ = accessory.addService(platform.Service.AirQualitySensor, 'Air Quality', 'Air Quality');
    const staleFan = accessory.addService(platform.Service.Fanv2, device.name + ' Fan', device.name + ' Fan');
    new AirConditioner(platform, accessory as any, platform.log);
    expect(accessory.services).not.toContain(staleAQ);
    expect(accessory.services).not.toContain(staleFan);
  });
});

describe('AirConditioner monitor interval', () => {
  test('is idempotent and cleared by destroy()', () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    // model not in noMonitorTimeout list
    const { ac, platform } = build({}, { modelName: 'OTHER_MODEL' });
    ac.accessory.context.device.data.online = true;
    (ac as any).startMonitor();
    expect(clearSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60000);
    expect(platform.ThinQ.deviceControl).toHaveBeenCalledTimes(1);

    ac.destroy();
    vi.advanceTimersByTime(180000);
    expect(platform.ThinQ.deviceControl).toHaveBeenCalledTimes(1);
    clearSpy.mockRestore();
  });
});
