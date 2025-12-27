import { DeviceModel } from '../lib/DeviceModel.js';
import { Logger } from 'homebridge';

/**
 * Convert Celsius to Fahrenheit
 */
export function cToF(celsius: number): number {
  return Math.round(celsius * 9 / 5 + 32);
}

/**
 * Convert Fahrenheit to Celsius
 */
export function fToC(fahrenheit: number): number {
  return Math.round((fahrenheit - 32) * 5 / 9 * 100) / 100;
}

/**
 * Utility class for handling temperature conversions between HomeKit and LG devices.
 * Supports both Celsius and Fahrenheit units with device model mapping lookups.
 */
export class TemperatureConverter {
  constructor(
    private isFahrenheit: boolean,
    private deviceModel?: DeviceModel,
    private logger?: Logger,
  ) {}

  /**
   * Convert temperature from HomeKit (Celsius) to LG device format.
   * For Fahrenheit devices, attempts to use device model mapping first.
   *
   * @param temperatureInCelsius - Temperature value from HomeKit (always Celsius)
   * @returns Temperature value in device's expected format
   */
  public fromHomeKit(temperatureInCelsius: number): number {
    if (!this.isFahrenheit) {
      return temperatureInCelsius;
    }

    const temperatureInFahrenheit = cToF(temperatureInCelsius);

    // Try device model mapping for accurate conversion
    if (this.deviceModel?.lookupMonitorValue) {
      try {
        const mapped = this.deviceModel.lookupMonitorValue('TempFahToCel', String(temperatureInFahrenheit));
        if (mapped !== undefined && mapped !== null) {
          const n = Number(mapped);
          if (!isNaN(n)) {
            return n;
          }
        }
      } catch (e) {
        this.logger?.warn('Temperature mapping lookup failed, using direct conversion.', e);
      }
    }

    return temperatureInFahrenheit;
  }

  /**
   * Convert temperature from LG device format to HomeKit (Celsius).
   * For Fahrenheit devices, attempts to use device model mapping first.
   *
   * @param temperature - Temperature value from LG device
   * @returns Temperature value in Celsius for HomeKit
   */
  public toHomeKit(temperature: number): number {
    if (!this.isFahrenheit) {
      return temperature;
    }

    // Try device model mapping for accurate conversion
    if (this.deviceModel?.lookupMonitorValue) {
      try {
        const mapped = this.deviceModel.lookupMonitorValue('TempCelToFah', String(temperature));
        if (mapped !== undefined && mapped !== null) {
          const n = Number(mapped);
          if (!isNaN(n)) {
            return fToC(n);
          }
        }
      } catch (e) {
        this.logger?.warn('Temperature mapping lookup failed, using direct conversion.', e);
      }
    }

    return fToC(temperature);
  }

  /**
   * Check if the converter is using Fahrenheit mode
   */
  public get useFahrenheit(): boolean {
    return this.isFahrenheit;
  }
}
