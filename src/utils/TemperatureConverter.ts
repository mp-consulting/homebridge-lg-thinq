import type { DeviceModel } from '../models/DeviceModel.js';
import type { Logger } from 'homebridge';

/**
 * Convert Celsius to Fahrenheit (rounded to the nearest whole degree)
 */
export function cToF(celsius: number): number {
  return Math.round(celsius * 9 / 5 + 32);
}

/**
 * Convert Fahrenheit to Celsius (rounded to 2 decimals)
 */
export function fToC(fahrenheit: number): number {
  return Math.round((fahrenheit - 32) * 5 / 9 * 100) / 100;
}

/**
 * Round a Celsius value to the nearest half degree (LG devices use 0.5 °C steps).
 */
export function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

/**
 * Utility class for handling temperature conversions between HomeKit and LG devices.
 *
 * Semantics (verified against LG model JSON `TempCelToFah` / `TempFahToCel` tables):
 * - LG devices ALWAYS report and accept temperatures in Celsius (in 0.5 °C steps),
 *   even when the user-facing unit is Fahrenheit.
 * - HomeKit always works in Celsius.
 * - When the user unit is Fahrenheit, LG maps whole °F values to specific Celsius
 *   values that do not match the arithmetic conversion exactly (e.g. 77 °F → 25 °C).
 *   To show clean whole-°F numbers in HomeKit we round-trip via the device tables:
 *     LG °C --TempCelToFah--> °F --fToC--> HomeKit °C
 *     HomeKit °C --cToF--> °F --TempFahToCel--> LG °C
 * - When the tables are missing, the arithmetic equivalent is used, so both
 *   directions keep treating the LG value as Celsius.
 */
export class TemperatureConverter {
  constructor(
    private isFahrenheit: boolean,
    private deviceModel?: DeviceModel,
    private logger?: Logger,
  ) {}

  private lookup(key: string, name: number): number | null {
    if (!this.deviceModel?.lookupMonitorValue) {
      return null;
    }
    try {
      const mapped = this.deviceModel.lookupMonitorValue(key, String(name));
      if (mapped !== undefined && mapped !== null && mapped !== '') {
        const n = Number(mapped);
        if (!isNaN(n)) {
          return n;
        }
      }
    } catch (e) {
      this.logger?.warn('Temperature mapping lookup failed, using direct conversion.', e);
    }
    return null;
  }

  /**
   * Convert temperature from HomeKit (Celsius) to the LG device value (Celsius, 0.5 steps).
   *
   * @param temperatureInCelsius - Temperature value from HomeKit (always Celsius)
   * @returns Temperature value in the device's expected format (Celsius)
   */
  public fromHomeKit(temperatureInCelsius: number): number {
    const value = Number(temperatureInCelsius);
    if (!this.isFahrenheit || isNaN(value)) {
      return value;
    }

    const temperatureInFahrenheit = cToF(value);
    const mapped = this.lookup('TempFahToCel', temperatureInFahrenheit);
    if (mapped !== null) {
      return mapped;
    }

    return roundToHalf(fToC(temperatureInFahrenheit));
  }

  /**
   * Convert temperature from the LG device value (Celsius) to HomeKit (Celsius).
   * In Fahrenheit mode, the value is snapped so that HomeKit displays the same whole °F as the device.
   *
   * @param temperature - Temperature value from LG device (Celsius)
   * @returns Temperature value in Celsius for HomeKit
   */
  public toHomeKit(temperature: number): number {
    const value = Number(temperature);
    if (!this.isFahrenheit || isNaN(value)) {
      return value;
    }

    const mapped = this.lookup('TempCelToFah', value);
    const fahrenheit = mapped !== null ? mapped : cToF(value);
    return fToC(fahrenheit);
  }

  /**
   * Check if the converter is using Fahrenheit mode
   */
  public get useFahrenheit(): boolean {
    return this.isFahrenheit;
  }
}
