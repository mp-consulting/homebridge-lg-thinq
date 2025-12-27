import { DeviceModel } from './DeviceModel.js';
import { safeParseInt, safeParseFloat } from '../utils/normalize.js';

/**
 * Air quality data structure used by air purifiers and air conditioners
 */
export interface AirQualityData {
  isOn: boolean;
  overall: number;
  PM2: number;
  PM10: number;
}

/**
 * Base class for device status with common getter helpers.
 * Provides type-safe access to snapshot data with fallback values.
 */
export abstract class BaseStatus {
  constructor(
    protected data: any,
    protected deviceModel?: DeviceModel,
  ) {}

  /**
   * Safely access a nested value from snapshot data using dot notation.
   * @param path - Dot-notation path (e.g., 'airState.operation')
   * @param defaultValue - Value to return if path doesn't exist
   */
  protected getValue<T>(path: string, defaultValue: T): T {
    if (!this.data) {
      return defaultValue;
    }

    // Handle direct property access (flat keys like 'airState.operation')
    if (path in this.data) {
      const value = this.data[path];
      return value !== undefined && value !== null ? value : defaultValue;
    }

    // Handle nested object access
    const keys = path.split('.');
    let value: any = this.data;
    for (const key of keys) {
      if (value === null || value === undefined || typeof value !== 'object') {
        return defaultValue;
      }
      value = value[key];
    }

    return value !== undefined && value !== null ? value : defaultValue;
  }

  /**
   * Get a boolean value from snapshot data.
   * Handles various truthy representations (1, true, '1', 'true', etc.)
   */
  protected getBoolean(path: string, defaultValue = false): boolean {
    const value = this.getValue<unknown>(path, defaultValue);
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      return value === '1' || value.toLowerCase() === 'true';
    }
    return !!value;
  }

  /**
   * Get an integer value from snapshot data.
   */
  protected getInt(path: string, defaultValue = 0): number {
    const value = this.getValue(path, defaultValue);
    return safeParseInt(value, defaultValue);
  }

  /**
   * Get a float value from snapshot data.
   */
  protected getFloat(path: string, defaultValue = 0): number {
    const value = this.getValue(path, defaultValue);
    return safeParseFloat(value, defaultValue);
  }

  /**
   * Get a string value from snapshot data.
   */
  protected getString(path: string, defaultValue = ''): string {
    const value = this.getValue(path, defaultValue);
    return String(value ?? defaultValue);
  }

  /**
   * Check if a property exists in the snapshot data.
   */
  protected hasProperty(path: string): boolean {
    if (!this.data) {
      return false;
    }

    // Check flat key first
    if (path in this.data) {
      return true;
    }

    // Check nested path
    const keys = path.split('.');
    let value: any = this.data;
    for (const key of keys) {
      if (value === null || value === undefined || typeof value !== 'object') {
        return false;
      }
      if (!(key in value)) {
        return false;
      }
      value = value[key];
    }
    return true;
  }

  /**
   * Get air quality data if available.
   * Common pattern used by air purifiers and air conditioners.
   */
  protected getAirQualityData(isPowerOn: boolean): AirQualityData | null {
    const hasAirQuality = this.hasProperty('airState.quality.overall')
      || this.hasProperty('airState.quality.PM2')
      || this.hasProperty('airState.quality.PM10');

    if (!hasAirQuality) {
      return null;
    }

    return {
      isOn: isPowerOn || this.getBoolean('airState.quality.sensorMon'),
      overall: this.getInt('airState.quality.overall'),
      PM2: this.getInt('airState.quality.PM2'),
      PM10: this.getInt('airState.quality.PM10'),
    };
  }

  /**
   * Calculate filter life percentage.
   * @param currentTimeKey - Path to current usage time
   * @param maxTimeKey - Path to max filter time
   * @returns Percentage of filter life remaining (0-100)
   */
  protected getFilterLifePercent(currentTimeKey: string, maxTimeKey: string): number {
    const maxTime = this.getInt(maxTimeKey);
    if (!maxTime) {
      return 0;
    }
    const currentTime = this.getInt(currentTimeKey);
    return Math.round((1 - (currentTime / maxTime)) * 100);
  }
}
