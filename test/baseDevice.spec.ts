import { vi } from 'vitest';
import type { AccessoryContext } from '../src/baseDevice.js';
import { BaseDevice, mergeSnapshot } from '../src/baseDevice.js';
import type { LGThinQHomebridgePlatform } from '../src/platform.js';
import type { Logger, PlatformAccessory } from 'homebridge';
import type { DeviceData } from '../src/models/Device.js';
import { Device } from '../src/models/Device.js';

// Mock dependencies
vi.mock('homebridge', () => ({
  HAPStatus: { SUCCESS: 0 },
  Categories: {},
}));
vi.mock('../src/platform.js');
vi.mock('../src/models/Device');

// Test suite for BaseDevice class
describe('BaseDevice', () => {
  let platform: LGThinQHomebridgePlatform;
  let accessory: PlatformAccessory<AccessoryContext>;
  let logger: Logger;
  let device: Device;
  let baseDevice: BaseDevice;
  const mockDeviceData: DeviceData = {
    deviceId: '12345',
    alias: 'Smart Fridge',
    deviceType: 101,
    modelName: 'FR123-US',
    modelJsonUri: 'https://example.com/model.json',
    manufacture: {
      macAddress: '00:1A:2B:3C:4D:5E',
      salesModel: 'FR123',
      serialNo: 'SN123456789',
      manufactureModel: 'FR123-M',
    },
    online: true,
    modemInfo: {
      appVersion: '1.0.0',
      modelName: 'FR123-MODEM',
    },
    snapshot: {
      online: true,
    },
    platformType: 'ThinQ2',
  };

  beforeEach(() => {



    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    platform = {
      Service: {
        AccessoryInformation: function AccessoryInformation() {},
      },
      Characteristic: {
        Manufacturer: 'Manufacturer',
        Model: 'Model',
        SerialNumber: 'SerialNumber',
      },
      config: {
        devices: [
          { id: '12345', customConfig: true },
        ],
      },
      log: logger,
    } as unknown as LGThinQHomebridgePlatform;

    accessory = {
      context: {
        device: new Device(mockDeviceData),
      },
      getService: vi.fn().mockReturnValue(null),
      addService: vi.fn().mockImplementation(() => ({
        setCharacteristic: vi.fn().mockReturnThis(),
      })),
    } as unknown as PlatformAccessory<AccessoryContext>;

    device = accessory.context.device;
  });

  it('should set accessory information on initialization', () => {
    baseDevice = new BaseDevice(platform, accessory, logger);
    expect(accessory.addService).toHaveBeenCalled();
    const calledArg = (accessory.addService as ReturnType<typeof vi.fn>).mock.calls[0][0] as any;
    if (typeof calledArg === 'function') {
      expect(calledArg.name).toBe('AccessoryInformation');
    } else {
      expect(calledArg.displayName).toBe('AccessoryInformation');
    }
  });

  it('should update accessory characteristics', () => {
    baseDevice = new BaseDevice(platform, accessory, logger);
    const newDevice = { ...device, name: 'Updated Device' } as Device;
    baseDevice.updateAccessoryCharacteristic(newDevice);
    expect(accessory.context.device).toEqual(newDevice);
  });

  it('should return an empty object if no configuration is found for the device', () => {
    baseDevice = new BaseDevice(platform, accessory, logger);
    platform.config.devices = [];
    expect(baseDevice.config).toEqual({});
  });

  it('should return an empty string for the static model method', () => {
    expect(BaseDevice.model()).toBe('');
  });

  describe('getStatus caching', () => {
    class TestStatus {
      constructor(public readonly data: Record<string, unknown> | undefined, public readonly model: unknown) {}
    }

    type GetStatusFn = (StatusClass: typeof TestStatus, snapshotKey?: string) => TestStatus;
    class TestDevice extends BaseDevice {
      public callStatus() {
        return (this['getStatus' as keyof BaseDevice] as unknown as GetStatusFn).call(this, TestStatus, 'state');
      }
    }

    function makeStubDevice(initialSnapshot: Record<string, unknown>): Device {
      // Build a Device-shaped stub without invoking the (mocked) constructor,
      // so the data field is actually populated.
      return {
        get snapshot() {
          return this.data.snapshot;
        },
        data: { snapshot: initialSnapshot } as unknown as DeviceData,
        deviceModel: {},
      } as unknown as Device;
    }

    it('reuses the cached status when the snapshot version has not changed', () => {
      accessory.context.device = makeStubDevice({ state: { running: false } });
      const testDevice = new TestDevice(platform, accessory, logger);

      const first = testDevice.callStatus();
      const second = testDevice.callStatus();

      expect(second).toBe(first);
    });

    it('rebuilds the cached status after updateAccessoryCharacteristic', () => {
      accessory.context.device = makeStubDevice({ state: { running: false } });
      const testDevice = new TestDevice(platform, accessory, logger);

      const first = testDevice.callStatus();
      expect(first.data).toEqual({ running: false });

      // Simulate a new snapshot arriving (e.g. via MQTT) followed by the
      // standard updateAccessoryCharacteristic call that bumps the version.
      accessory.context.device.data.snapshot = { state: { running: true } };
      testDevice.updateAccessoryCharacteristic(accessory.context.device);

      const second = testDevice.callStatus();
      expect(second).not.toBe(first);
      expect(second.data).toEqual({ running: true });
    });
  });

  // Regression for #9: subclasses that redeclared `public readonly accessory`
  // as a parameter property had their `this.accessory` clobbered to `undefined`
  // by ES2022 class-field semantics — field initializers running after super()
  // but before the constructor body's parameter-property assignment saw an
  // undefined accessory. Only manifested in Microwave because it was the only
  // class with a field initializer reading `this.Status` (-> `this.accessory`).
  describe('subclass field-initializer access to accessory (issue #9)', () => {
    class TestStatus {
      constructor(public readonly data: Record<string, unknown> | undefined, public readonly model: unknown) {}
    }

    function makeStubDevice(snapshot: Record<string, unknown>): Device {
      return {
        get snapshot() {
          return this.data.snapshot;
        },
        data: { snapshot } as unknown as DeviceData,
        deviceModel: {},
        type: 'TEST',
      } as unknown as Device;
    }

    type GetStatusFn = (StatusClass: typeof TestStatus, snapshotKey?: string) => TestStatus;

    // Mirrors the Microwave shape: a derived class with a field initializer
    // that reads through this.Status -> this.accessory.context.device.
    class MicrowaveLike extends BaseDevice {
      get Status() {
        return (this['getStatus' as keyof BaseDevice] as unknown as GetStatusFn).call(this, TestStatus, 'state');
      }
      // The exact pattern that crashed in Microwave.ts before the fix.
      public commandList = { tempUnits: this.Status.data?.temperatureUnit };
    }

    it('does not throw when a field initializer reads this.Status', () => {
      accessory.context.device = makeStubDevice({ state: { temperatureUnit: 'F' } });
      expect(() => new MicrowaveLike(platform, accessory, logger)).not.toThrow();
    });

    it('field initializer sees the real snapshot value', () => {
      accessory.context.device = makeStubDevice({ state: { temperatureUnit: 'F' } });
      const m = new MicrowaveLike(platform, accessory, logger);
      expect(m.commandList.tempUnits).toBe('F');
    });
  });
});

describe('mergeSnapshot', () => {
  it('preserves washer siblings when MQTT publishes a partial remainTimeMinute delta', () => {
    // Captured from a real Viva (WASHER F_V7_F___W.B_2QEUK) log: every minute
    // the MQTT stream pushes only the field that changed, with the rest of the
    // washerDryer subtree omitted. Shallow spread used to replace the whole
    // subtree with this one-key object, dropping doorLock for an instant.
    const current = {
      online: true,
      washerDryer: {
        state: 'RUNNING',
        doorLock: 'DOOR_LOCK_ON',
        remainTimeMinute: 52,
        TCLCount: 36,
      },
    };
    const delta = {
      online: true,
      washerDryer: { remainTimeMinute: 51 },
    };

    const merged = mergeSnapshot(current, delta);

    expect(merged).toEqual({
      online: true,
      washerDryer: {
        state: 'RUNNING',
        doorLock: 'DOOR_LOCK_ON',
        remainTimeMinute: 51,
        TCLCount: 36,
      },
    });
  });

  it('replaces arrays rather than concatenating', () => {
    const merged = mergeSnapshot({ values: [1, 2, 3] }, { values: [4] });
    expect(merged).toEqual({ values: [4] });
  });

  it('replaces primitives at top level', () => {
    const merged = mergeSnapshot({ online: false, mid: 1 }, { online: true, mid: 2 });
    expect(merged).toEqual({ online: true, mid: 2 });
  });

  it('returns a copy when the current snapshot is null or undefined', () => {
    const incoming = { washerDryer: { state: 'RUNNING' } };
    expect(mergeSnapshot(null, incoming)).toEqual(incoming);
    expect(mergeSnapshot(undefined, incoming)).toEqual(incoming);
    expect(mergeSnapshot(null, incoming)).not.toBe(incoming);
  });

  it('handles AC-style flat dotted keys identically to shallow spread', () => {
    const current = {
      'airState.opMode': 0,
      'airState.windStrength': 2,
      'airState.tempState.target': 24,
    };
    const delta = { 'airState.windStrength': 6 };

    expect(mergeSnapshot(current, delta)).toEqual({
      'airState.opMode': 0,
      'airState.windStrength': 6,
      'airState.tempState.target': 24,
    });
  });
});
