import { DeviceModel } from '../models/DeviceModel.js';
import { safeParseInt } from '../helper.js';

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
 * Base class for device status implementations.
 * Provides common utility methods for parsing and accessing device data.
 */
export abstract class BaseStatus {
  constructor(
    protected readonly _data: Record<string, unknown> | undefined,
    protected readonly deviceModel: DeviceModel,
  ) {}

  /** Raw data access for subclasses that need direct field access */
  public get data(): Record<string, any> {
    return (this._data as Record<string, any>) || {};
  }

  /**
   * Safely get an integer value from the data with a fallback.
   */
  protected getInt(key: string, fallback = 0): number {
    return safeParseInt(this._data?.[key], fallback);
  }

  /**
   * Safely get a string value from the data with a fallback.
   */
  protected getString(key: string, fallback = ''): string {
    const value = this._data?.[key];
    return typeof value === 'string' ? value : fallback;
  }

  /**
   * Safely get a boolean value from the data.
   */
  protected getBool(key: string): boolean {
    return !!this._data?.[key];
  }

  /**
   * Get a boolean value with more flexible parsing.
   * Handles 1, true, '1', 'true' as true values.
   */
  protected getBoolean(key: string, defaultValue = false): boolean {
    const value = this._data?.[key];
    if (value === undefined || value === null) {
      return defaultValue;
    }
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
   * Check if a key exists in the data.
   */
  protected has(key: string): boolean {
    return this._data !== undefined && key in this._data;
  }

  /**
   * Check if a property exists in the snapshot data.
   * Alias for has() for compatibility.
   */
  protected hasProperty(key: string): boolean {
    return this.has(key);
  }

  /**
   * Get the raw value for a key.
   */
  protected getRaw<T>(key: string): T | undefined {
    return this._data?.[key] as T | undefined;
  }

  /**
   * Get air quality data if available.
   * Common pattern used by air purifiers and air conditioners.
   */
  protected getAirQualityData(isPowerOn: boolean): AirQualityData | null {
    const hasAirQuality = this.has('airState.quality.overall')
      || this.has('airState.quality.PM2')
      || this.has('airState.quality.PM10');

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
   * @param currentTimeKey - Key for current usage time
   * @param maxTimeKey - Key for max filter time
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

/**
 * Base class for appliance status (washer, dryer, styler, dishwasher).
 * Provides common time-related properties.
 */
export abstract class ApplianceStatus extends BaseStatus {
  /**
   * Get the remaining duration in seconds.
   */
  public get remainDuration(): number {
    const hours = this.getInt('remainTimeHour');
    const minutes = this.getInt('remainTimeMinute');
    return this.isRunning ? (hours * 3600 + minutes * 60) : 0;
  }

  /**
   * Check if the device is powered on.
   */
  public abstract get isPowerOn(): boolean;

  /**
   * Check if the device is actively running.
   */
  public abstract get isRunning(): boolean;
}
