import { vi } from 'vitest';
import Oven from '../../src/devices/Oven.js';
import Microwave from '../../src/devices/Microwave.js';
import Dishwasher from '../../src/devices/Dishwasher.js';
import { MockAccessory, MockHapStatusError, makeDevice, makePlatform } from './homebridgeMocks.js';

vi.mock('homebridge', () => ({
  HAPStatus: { SUCCESS: 0, SERVICE_COMMUNICATION_FAILURE: -70402 },
  Categories: new Proxy({}, { get: () => 1 }),
}));

function build<T>(
  DeviceClass: new (...args: any[]) => T,
  type: string,
  snapshot: Record<string, unknown>,
  deviceConfig: Record<string, unknown> = {},
  lookupMonitorName?: (k: string, v: string) => string | null,
) {
  const { platform, logger, deviceControl } = makePlatform(deviceConfig);
  const device = makeDevice(type, snapshot, lookupMonitorName);
  const accessory = new MockAccessory({ device });
  const handler = new DeviceClass(platform, accessory, logger);
  return { handler, accessory, device, deviceControl, logger };
}

const OVEN_COOKING = {
  upperState: 'COOKING_IN_PROGRESS',
  upperManualCookName: 'BAKE',
  upperCurrentTemperatureUnit: 'FAHRENHEIT',
  upperCurrentTemperatureValue: 350,
  upperTargetTemperatureValue: 375,
  upperRemoteStart: 'ENABLE',
  upperDoorOpen: 'DISABLE',
  upperTargetTimeHour: 0,
  upperTargetTimeMinute: 30,
  upperRemainTimeHour: 0,
  upperRemainTimeMinute: 5,
  upperRemainTimeSecond: 0,
  burnerOnCounter: 1,
  cooktop2CooktopState: 'ON',
  cooktop2OperationTimeMinute: 5,
};

describe('Oven', () => {
  it('constructs and refreshes with an empty snapshot', () => {
    const { handler, device } = build(Oven, 'OVEN', {});
    expect(() => handler.updateAccessoryCharacteristic(device as any)).not.toThrow();
    expect(handler.serviceActive()).toBe(0);
    expect(handler.probeTargetTemperature()).toBe(38);
  });

  it('constructs when ovenState is an empty object', () => {
    const { handler, device } = build(Oven, 'OVEN', { ovenState: {} });
    expect(() => handler.updateAccessoryCharacteristic(device as any)).not.toThrow();
    expect(handler.ovenStatus()).toBe('Oven is Unknown');
  });

  it('sets the cook-timer RemainingDuration from the remaining time (not the temperature)', () => {
    const { handler, accessory, device } = build(Oven, 'OVEN', { ovenState: OVEN_COOKING });
    handler.updateAccessoryCharacteristic(device as any);
    const valve = accessory.byId('Valve', 'NicoCataGaTa-OvenT2');
    expect(valve.value('RemainingDuration')).toBe(300);
    expect(valve.value('SetDuration')).toBe(1800);
  });

  it('describes burner 2 from its own cooktop2 fields', () => {
    const { handler, accessory, device } = build(Oven, 'OVEN', { ovenState: OVEN_COOKING });
    handler.updateAccessoryCharacteristic(device as any);
    const burner2 = accessory.byId('InputSource', 'NicoCataGaTa-Oven002');
    expect(burner2.value('ConfiguredName')).toBe('Back Left Burner is On. Cooking for 0:05:00 Minutes');
    expect(burner2.value('CurrentVisibilityState')).toBe(0);
  });

  it('uses the device temperature range for the thermostat', () => {
    const { accessory } = build(Oven, 'OVEN', { ovenState: OVEN_COOKING });
    const thermostat = accessory.byId('Thermostat', 'NicoCataGaTa-OvenTC');
    expect(thermostat.getCharacteristic({ typeName: 'TargetTemperature' }).props.maxValue).toBe(300);
  });

  it('looks up the Television service by subtype so a rename does not duplicate it', () => {
    const { platform, logger } = makePlatform({ name: 'Old name' });
    const device = makeDevice('OVEN', { ovenState: OVEN_COOKING });
    const accessory = new MockAccessory({ device });
    new Oven(platform as any, accessory as any, logger as any);
    platform.config.devices[0] = { id: 'device-1', name: 'New name' };
    expect(() => new Oven(platform as any, accessory as any, logger as any)).not.toThrow();
    expect(accessory.services.filter(s => s.type.UUID === 'Television')).toHaveLength(1);
  });

  it('reports a failed command to HomeKit', async () => {
    const { accessory, deviceControl } = build(Oven, 'OVEN', { ovenState: { ...OVEN_COOKING, upperState: 'INITIAL' } });
    deviceControl.mockResolvedValue(false);
    const monitorSwitch = accessory.byId('Switch', 'CataNicoGaTa-Control7');
    monitorSwitch.getCharacteristic({ typeName: 'On' }).setHandler!(false);
    const television = accessory.byId('Television', 'NicoCataGaTa-OvenOven7');
    await expect(television.getCharacteristic({ typeName: 'Active' }).setHandler!(1)).rejects.toBeInstanceOf(MockHapStatusError);
    expect(deviceControl).toHaveBeenCalledWith('device-1', expect.anything(), 'Set', 'SetCookStart');
  });

  it('keeps the unsent HomeKit selection when idle snapshots arrive', () => {
    vi.useFakeTimers();
    try {
      const { handler, accessory, device } = build(Oven, 'OVEN', { ovenState: { upperState: 'INITIAL', upperManualCookName: 'NONE' } });
      const airFry = accessory.byId('Switch', 'CataNicoGaTa-Control4');
      airFry.getCharacteristic({ typeName: 'On' }).setHandler!(true);
      // the pause ends and the idle snapshot is replayed: the selection must survive
      handler.updateAccessoryCharacteristic(device as any);
      vi.advanceTimersByTime(130000);
      expect(airFry.value('On')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a reported CONVECTION_ROAST as the Convection Roast switch', () => {
    const { handler, accessory, device } = build(Oven, 'OVEN', { ovenState: { ...OVEN_COOKING, upperManualCookName: 'CONVECTION_ROAST' } });
    handler.updateAccessoryCharacteristic(device as any);
    expect(accessory.byId('Switch', 'CataNicoGaTa-Control2').value('On')).toBe(true);
  });
});

describe('Microwave', () => {
  const idle = { LWOState: 'INITIAL', LWOManualCookName: 'STANDBY', mwoVentSpeedLevel: 1, mwoLampLevel: 0, LWOMGTPowerLevel: '7' };

  it('constructs and refreshes with an empty snapshot', () => {
    const { handler, device } = build(Microwave, 'MICROWAVE', {});
    expect(() => handler.updateAccessoryCharacteristic(device as any)).not.toThrow();
  });

  it('exposes microwave power as a 0-100 brightness consistently', () => {
    const { handler, accessory, device } = build(Microwave, 'MICROWAVE', { ovenState: idle });
    handler.updateAccessoryCharacteristic(device as any);
    const power = accessory.byId('Lightbulb', 'YourUniqueIdentifier-59SP');
    expect(power.value('Brightness')).toBe(70);
    expect(power.getCharacteristic({ typeName: 'Brightness' }).getHandler!()).toBe(70);
  });

  it('only sends a stop command when the microwave is cooking', async () => {
    vi.useFakeTimers();
    try {
      const cooking = build(Microwave, 'MICROWAVE', { ovenState: { ...idle, LWOState: 'COOKING_IN_PROGRESS' } });
      const tv = cooking.accessory.byId('Television', 'NicoCataGaTa-OvenOven7');
      const pending = tv.getCharacteristic({ typeName: 'Active' }).setHandler!(0);
      await vi.advanceTimersByTimeAsync(5000);
      await pending;
      const keys = cooking.deviceControl.mock.calls.map(call => call[3]);
      expect(keys).toEqual(['SetCookStop', 'setVentLampLevel']);

      const standby = build(Microwave, 'MICROWAVE', { ovenState: idle });
      const tv2 = standby.accessory.byId('Television', 'NicoCataGaTa-OvenOven7');
      await tv2.getCharacteristic({ typeName: 'Active' }).setHandler!(0);
      expect(standby.deviceControl.mock.calls.map(call => call[3])).toEqual(['setVentLampLevel']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Dishwasher', () => {
  const lookup = (key: string, value: string) => (value === '@DW_STATE_RUNNING_W' ? 'RUNNING' : null);
  const running = { state: 'RUNNING', process: 'RUNNING', course: 'HEAVY', door: 'CLOSE', remainTimeHour: 1, remainTimeMinute: 0 };

  it('constructs and refreshes with an empty snapshot', () => {
    const { handler, device } = build(Dishwasher, 'DISHWASHER', {});
    expect(() => handler.updateAccessoryCharacteristic(device as any)).not.toThrow();
  });

  it('timerStatus honours onStatus() (standby window elapsed -> inactive)', () => {
    const { handler } = build(Dishwasher, 'DISHWASHER', { dishwasher: running }, {}, lookup);
    expect(handler.timerStatus()).toBe(1);
    handler.standbyTimetMS = Date.now() - 7 * 60 * 1000;
    expect(handler.onStatus()).toBe(false);
    expect(handler.timerStatus()).toBe(0);
  });

  it('fixes the "Running" typo', () => {
    const { handler, device } = build(Dishwasher, 'DISHWASHER', { dishwasher: { ...running, course: 'STREAM' } }, {}, lookup);
    handler.updateAccessoryCharacteristic(device as any);
    expect(handler.inputName.startsWith('Running a Stream Cycle')).toBe(true);
  });

  it('switches to the rinse-aid input when rinse aid is low', () => {
    const { handler, accessory, device } = build(Dishwasher, 'DISHWASHER', { dishwasher: { ...running, rinseLevel: 'LEVEL_0' } }, {}, lookup);
    handler.updateAccessoryCharacteristic(device as any);
    expect(handler.inputID).toBe(6);
    expect(accessory.byId('Television', 'CataNicoGaTa-70').value('ActiveIdentifier')).toBe(6);
  });

  it('triggers the finished sensor only on the transition into END, with one timer', () => {
    vi.useFakeTimers();
    try {
      const { handler, accessory } = build(Dishwasher, 'DISHWASHER', { dishwasher: running }, { dishwasher_trigger: true }, lookup);
      const sensor = accessory.services.find(s => s.type.UUID === 'OccupancySensor')!;
      const detections = () => sensor.updates.filter(u => u.name === 'OccupancyDetected' && u.value === 1).length;

      handler.update({ dishwasher: { state: 'END', process: 'END' } });
      handler.update({ dishwasher: { state: 'END', process: 'END' } });
      handler.update({ dishwasher: { state: 'END', process: 'END' } });
      expect(detections()).toBe(1);

      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(sensor.value('OccupancyDetected')).toBe(0);

      handler.update({ dishwasher: { state: 'STANDBY' } });
      handler.update({ dishwasher: { state: 'END' } });
      expect(detections()).toBe(2);
      handler.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
