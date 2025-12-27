import { Device } from './lib/Device.js';
import { DeviceRegistry } from './lib/DeviceRegistry.js';

/**
 * Platform Accessory Helper
 * Provides device instantiation and category lookup using the centralized DeviceRegistry
 */
export class Helper {
  /**
   * Get the implementation class for a device
   * @param device The device to get implementation for
   * @returns Promise resolving to the device class or null if unsupported
   */
  public static async make(device: Device) {
    return DeviceRegistry.getImplementation(device);
  }

  /**
   * Get the HomeKit category for a device
   * @param device The device to get category for
   * @returns HomeKit category number
   */
  public static category(device: Device) {
    return DeviceRegistry.getCategory(device);
  }
}

export { cToF, fToC, TemperatureConverter } from './utils/TemperatureConverter.js';
export { normalizeBoolean, normalizeNumber, safeParseInt, safeParseFloat, toSeconds } from './utils/normalize.js';
