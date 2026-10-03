import { vi } from 'vitest';
import os from 'os';
import * as hap from '@homebridge/hap-nodejs';
import type { API, Logging, PlatformConfig } from 'homebridge';
import { LGThinQHomebridgePlatform } from '../src/platform.js';
import { Device } from '../src/models/Device.js';
import type { DeviceData } from '../src/models/Device.js';

const instances: FakeDevice[] = [];

class FakeDevice {
  public update = vi.fn();
  public updateAccessoryCharacteristic = vi.fn();
  public destroy = vi.fn();
  constructor() {
    instances.push(this);
  }
}

vi.mock('../src/helper.js', () => ({
  Helper: {
    make: vi.fn(async () => FakeDevice),
    category: vi.fn(() => 1),
    isExternalAccessory: vi.fn(() => false),
  },
}));

const DEVICE_ID = '11111111-2222-3333-4444-555555555555';

function makeDevice(): Device {
  return new Device({
    deviceId: DEVICE_ID,
    alias: 'Living room AC',
    deviceType: 401,
    modelName: 'AC-1',
    modelJsonUri: 'https://example.invalid/model.json',
    platformType: 'thinq2',
    snapshot: {},
  } as unknown as DeviceData);
}

function makePlatform() {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn(), success: vi.fn() } as unknown as Logging;
  const api = {
    hap,
    on: vi.fn(),
    user: { storagePath: () => os.tmpdir() },
    platformAccessory: class {
      public context: Record<string, unknown> = {};
      constructor(public displayName: string, public UUID: string) {}
    },
    registerPlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
    publishExternalAccessories: vi.fn(),
  } as unknown as API;
  const config = { platform: 'LGThinQ', country: 'US', language: 'en-US', refresh_token: 'token' } as PlatformConfig;

  const platform = new LGThinQHomebridgePlatform(log, config, api);
  const thinq = {
    devices: vi.fn(async () => [makeDevice()]),
    setup: vi.fn(async () => true),
    unregister: vi.fn(async () => undefined),
  };
  (platform as unknown as { ThinQ: unknown }).ThinQ = thinq;
  return { platform, api };
}

describe('LGThinQHomebridgePlatform.discoverDevices', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  test('registers a new accessory and binds one update listener', async () => {
    const { platform, api } = makePlatform();

    await platform.discoverDevices();

    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    expect(platform.events.listenerCount(DEVICE_ID)).toBe(1);
    expect(instances[0].updateAccessoryCharacteristic).toHaveBeenCalledTimes(1);
  });

  test('a discovery retry replaces the previous handler instead of stacking a second one', async () => {
    const { platform, api } = makePlatform();

    await platform.discoverDevices();
    await platform.discoverDevices();

    expect(instances).toHaveLength(2);
    expect(instances[0].destroy).toHaveBeenCalledTimes(1);
    expect(platform.events.listenerCount(DEVICE_ID)).toBe(1);
    // the second run restores the cached accessory rather than registering a duplicate
    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);

    platform.events.emit(DEVICE_ID, { foo: 1 });
    expect(instances[0].update).not.toHaveBeenCalled();
    expect(instances[1].update).toHaveBeenCalledWith({ foo: 1 });
  });

  test('removing a vanished device tears down its handler and listener', async () => {
    const { platform, api } = makePlatform();
    await platform.discoverDevices();

    (platform.ThinQ.devices as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    await platform.discoverDevices();

    expect(api.unregisterPlatformAccessories).toHaveBeenCalledTimes(1);
    expect(instances[0].destroy).toHaveBeenCalledTimes(1);
    expect(platform.events.listenerCount(DEVICE_ID)).toBe(0);
    expect(platform.accessories).toHaveLength(0);
  });
});
