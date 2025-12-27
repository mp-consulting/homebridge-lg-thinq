import { Categories } from 'homebridge';
import { Device } from './Device.js';
import { PlatformType } from './constants.js';
import type { BaseDevice } from '../baseDevice.js';

/**
 * Device descriptor containing all metadata for a device type
 */
export interface DeviceDescriptor {
  /** Device type identifier (e.g., 'AC', 'WASHER') */
  type: string;
  /** ThinQ2 implementation class (lazy loaded) */
  v2Implementation: () => Promise<typeof BaseDevice> | null;
  /** ThinQ1 implementation class (lazy loaded) */
  v1Implementation: () => Promise<typeof BaseDevice> | null;
  /** HomeKit category for this device */
  homeKitCategory: number;
  /** Snapshot key for status data */
  snapshotKey?: string;
  /** Default configuration values */
  configDefaults?: Record<string, unknown>;
}

/**
 * Centralized device registry for all supported LG ThinQ devices
 */
export class DeviceRegistry {
  private static readonly DEVICES: Map<string, DeviceDescriptor> = new Map([
    ['AERO_TOWER', {
      type: 'AERO_TOWER',
      v2Implementation: () => import('../devices/AeroTower.js').then(m => m.default),
      v1Implementation: () => null,
      homeKitCategory: Categories.AIR_PURIFIER,
      snapshotKey: 'airState',
      configDefaults: { air_fast_mode: false },
    }],
    ['AIR_PURIFIER', {
      type: 'AIR_PURIFIER',
      v2Implementation: () => import('../devices/AirPurifier.js').then(m => m.default),
      v1Implementation: () => import('../v1/devices/AirPurifier.js').then(m => m.default),
      homeKitCategory: Categories.AIR_PURIFIER,
      snapshotKey: 'airState',
      configDefaults: { air_fast_mode: false },
    }],
    ['REFRIGERATOR', {
      type: 'REFRIGERATOR',
      v2Implementation: () => import('../devices/Refrigerator.js').then(m => m.default),
      v1Implementation: () => import('../v1/devices/Refrigerator.js').then(m => m.default),
      homeKitCategory: Categories.OTHER,
      snapshotKey: 'refState',
      configDefaults: {
        ref_express_freezer: false,
        ref_express_fridge: false,
        ref_eco_friendly: false,
      },
    }],
    ['WASHER', {
      type: 'WASHER',
      v2Implementation: () => import('../devices/WasherDryer.js').then(m => m.default),
      v1Implementation: () => import('../v1/devices/Washer.js').then(m => m.default),
      homeKitCategory: Categories.OTHER,
      snapshotKey: 'washerDryer',
      configDefaults: {
        washer_trigger: false,
        washer_door_lock: false,
        washer_tub_clean: false,
      },
    }],
    ['WASHER_NEW', {
      type: 'WASHER_NEW',
      v2Implementation: () => import('../devices/WasherDryer.js').then(m => m.default),
      v1Implementation: () => null,
      homeKitCategory: Categories.OTHER,
      snapshotKey: 'washerDryer',
      configDefaults: {
        washer_trigger: false,
        washer_door_lock: false,
        washer_tub_clean: false,
      },
    }],
    ['WASH_TOWER', {
      type: 'WASH_TOWER',
      v2Implementation: () => import('../devices/WasherDryer.js').then(m => m.default),
      v1Implementation: () => null,
      homeKitCategory: Categories.OTHER,
      snapshotKey: 'washerDryer',
      configDefaults: {
        washer_trigger: false,
        washer_door_lock: false,
        washer_tub_clean: false,
      },
    }],
    ['WASH_TOWER_2', {
      type: 'WASH_TOWER_2',
      v2Implementation: () => import('../devices/WasherDryer2.js').then(m => m.default),
      v1Implementation: () => null,
      homeKitCategory: Categories.OTHER,
      snapshotKey: 'washerDryer',
      configDefaults: {
        washer_trigger: false,
        washer_door_lock: false,
        washer_tub_clean: false,
      },
    }],
    ['DRYER', {
      type: 'DRYER',
      v2Implementation: () => import('../devices/WasherDryer.js').then(m => m.default),
      v1Implementation: () => import('../v1/devices/Washer.js').then(m => m.default),
      homeKitCategory: Categories.OTHER,
      snapshotKey: 'washerDryer',
      configDefaults: {
        washer_trigger: false,
        washer_door_lock: false,
        washer_tub_clean: false,
      },
    }],
    ['DISHWASHER', {
      type: 'DISHWASHER',
      v2Implementation: () => import('../devices/Dishwasher.js').then(m => m.default),
      v1Implementation: () => null,
      homeKitCategory: 1, // Sprinkler
      snapshotKey: 'dishwasher',
      configDefaults: { dishwasher_trigger: false },
    }],
    ['DEHUMIDIFIER', {
      type: 'DEHUMIDIFIER',
      v2Implementation: () => import('../devices/Dehumidifier.js').then(m => m.default),
      v1Implementation: () => null,
      homeKitCategory: Categories.AIR_DEHUMIDIFIER,
      snapshotKey: 'dehumidifierState',
    }],
    ['AC', {
      type: 'AC',
      v2Implementation: () => import('../devices/AirConditioner.js').then(m => m.default),
      v1Implementation: () => import('../v1/devices/AC.js').then(m => m.default),
      homeKitCategory: Categories.AIR_CONDITIONER,
      snapshotKey: 'airState',
      configDefaults: {
        ac_swing_mode: 'BOTH',
        ac_air_quality: false,
        ac_mode: 'BOTH',
        ac_temperature_sensor: false,
        ac_humidity_sensor: false,
        ac_led_control: false,
        ac_fan_control: false,
        ac_jet_control: false,
        ac_temperature_unit: 'C',
        ac_buttons: [],
        ac_air_clean: true,
        ac_energy_save: true,
      },
    }],
    ['STYLER', {
      type: 'STYLER',
      v2Implementation: () => import('../devices/Styler.js').then(m => m.default),
      v1Implementation: () => null,
      homeKitCategory: Categories.OTHER,
      snapshotKey: 'styler',
    }],
    ['HOOD', {
      type: 'HOOD',
      v2Implementation: () => import('../devices/RangeHood.js').then(m => m.default),
      v1Implementation: () => import('../v1/devices/RangeHood.js').then(m => m.default),
      homeKitCategory: Categories.OTHER,
      snapshotKey: 'hoodState',
    }],
    ['MICROWAVE', {
      type: 'MICROWAVE',
      v2Implementation: () => import('../devices/Microwave.js').then(m => m.default),
      v1Implementation: () => null,
      homeKitCategory: 9, // Thermostat (air heater)
      snapshotKey: 'microwaveState',
    }],
    ['OVEN', {
      type: 'OVEN',
      v2Implementation: () => import('../devices/Oven.js').then(m => m.default),
      v1Implementation: () => null,
      homeKitCategory: 9, // Thermostat
      snapshotKey: 'ovenState',
    }],
  ]);

  /**
   * Get the descriptor for a device type
   */
  public static getDescriptor(type: string): DeviceDescriptor | undefined {
    return this.DEVICES.get(type);
  }

  /**
   * Get the implementation class for a device
   */
  public static async getImplementation(device: Device): Promise<typeof BaseDevice | null> {
    const descriptor = this.DEVICES.get(device.type);
    if (!descriptor) {
      return null;
    }

    if (device.platform === PlatformType.ThinQ1) {
      const impl = descriptor.v1Implementation();
      return impl ? await impl : null;
    }

    const impl = descriptor.v2Implementation();
    return impl ? await impl : null;
  }

  /**
   * Get HomeKit category for a device
   */
  public static getCategory(device: Device): number {
    const descriptor = this.DEVICES.get(device.type);
    return descriptor?.homeKitCategory ?? Categories.OTHER;
  }

  /**
   * Get config defaults for a device type
   */
  public static getConfigDefaults(type: string): Record<string, unknown> {
    const descriptor = this.DEVICES.get(type);
    return descriptor?.configDefaults ?? {};
  }

  /**
   * Get snapshot key for a device type
   */
  public static getSnapshotKey(type: string): string | undefined {
    const descriptor = this.DEVICES.get(type);
    return descriptor?.snapshotKey;
  }

  /**
   * Check if a device type is supported
   */
  public static isSupported(type: string): boolean {
    return this.DEVICES.has(type);
  }

  /**
   * Get all supported device types
   */
  public static getSupportedTypes(): string[] {
    return Array.from(this.DEVICES.keys());
  }
}
