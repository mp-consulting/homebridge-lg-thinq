import type { CharacteristicValue, Logger } from 'homebridge';
import type { Device } from '../models/Device.js';
import type { EnumValue, RangeValue } from '../models/DeviceModel.js';
import { ValueType } from '../models/DeviceModel.js';
import { safeParseInt } from '../utils/normalize.js';
import { TemperatureConverter } from '../utils/TemperatureConverter.js';
import {
  FAN_SPEED_MIN,
  FAN_SPEED_MAX,
  HUMIDITY_MAX,
  HUMIDITY_DIVISOR,
  ENERGY_CONSUMPTION_DIVISOR,
} from '../lib/constants.js';

export enum ACModelType {
  AWHP = 'AWHP',
  RAC = 'RAC',
}

export const FAN_SPEED_AUTO = 8;

export enum FanSpeed {
  LOW = 2,
  LOW_MEDIUM = 3,
  MEDIUM = 4,
  MEDIUM_HIGH = 5,
  HIGH = 6
}

/** Ordered list of manual fan speeds (lowest → highest). */
export const AC_FAN_SPEEDS: readonly FanSpeed[] = [
  FanSpeed.LOW,
  FanSpeed.LOW_MEDIUM,
  FanSpeed.MEDIUM,
  FanSpeed.MEDIUM_HIGH,
  FanSpeed.HIGH,
];

/** HomeKit RotationSpeed reported when the fan is in AUTO mode or the value is unknown. */
export const AC_FAN_SPEED_DEFAULT_PERCENT = 50;

export enum OpMode {
  AUTO = 6,
  COOL = 0,
  HEAT = 4,
  FAN = 2,
  DRY = 1,
  AIR_CLEAN = 5,
}

export type Config = {
  ac_swing_mode: string,
  ac_air_quality: boolean,
  ac_mode: string,
  ac_temperature_sensor: boolean,
  ac_humidity_sensor: boolean,
  ac_led_control: boolean,
  ac_fan_control: boolean,
  ac_jet_control: boolean,
  ac_temperature_unit: string,
  ac_buttons: { name: string, op_mode: string }[],
  ac_air_clean: boolean,
  ac_energy_save: boolean,
}

/**
 * Convert a HomeKit RotationSpeed percentage (0-100) to an LG wind strength (FAN_SPEED_MIN..FAN_SPEED_MAX).
 * Values are clamped; 0 maps to the lowest speed.
 */
export function percentToWindStrength(percent: number): FanSpeed {
  const p = Number.isFinite(percent) ? Math.max(0, Math.min(HUMIDITY_MAX, percent)) : 0;
  const ws = Math.round((p / HUMIDITY_MAX) * (FAN_SPEED_MAX - FAN_SPEED_MIN) + FAN_SPEED_MIN);
  return Math.max(FAN_SPEED_MIN, Math.min(FAN_SPEED_MAX, ws)) as FanSpeed;
}

/**
 * Convert an LG wind strength to a HomeKit RotationSpeed percentage (1-100).
 * AUTO and unknown values map to AC_FAN_SPEED_DEFAULT_PERCENT.
 */
export function windStrengthToPercent(windStrength: unknown): number {
  const num = Number(windStrength);
  if (Number.isNaN(num) || num === FAN_SPEED_AUTO || num < FAN_SPEED_MIN || num > FAN_SPEED_MAX) {
    return AC_FAN_SPEED_DEFAULT_PERCENT;
  }
  return Math.round(((num - FAN_SPEED_MIN) / (FAN_SPEED_MAX - FAN_SPEED_MIN)) * HUMIDITY_MAX) || 1;
}

/**
 * Status view over a (flat-keyed) AC snapshot, e.g. snapshot['airState.operation'].
 */
export class ACStatus {
  private readonly converter: TemperatureConverter;

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected data: any,
    protected device: Device,
    protected config: Pick<Config, 'ac_temperature_unit'>,
    logger?: Logger,
  ) {
    this.data = data || {};
    this.converter = new TemperatureConverter(this.isFahrenheitUnit, device?.deviceModel, logger);
  }

  /**
   * Fahrenheit display unit configured by the user
   */
  public get isFahrenheitUnit() {
    return (this.config?.ac_temperature_unit || '').toLowerCase() === 'f';
  }

  /**
   * Converts temperature from HomeKit (Celsius) to the LG device value (Celsius, 0.5 steps).
   */
  public convertTemperatureCelsiusFromHomekitToLG(temperatureInCelsius: CharacteristicValue): number {
    return this.converter.fromHomeKit(Number(temperatureInCelsius));
  }

  /**
   * Converts an LG device temperature (Celsius) to the value shown in HomeKit (Celsius).
   */
  public convertTemperatureCelsiusFromLGToHomekit(temperature: number): number {
    return this.converter.toHomeKit(Number(temperature));
  }

  public get opMode() {
    return this.data['airState.opMode'] as number;
  }

  public get isPowerOn() {
    return !!this.data['airState.operation'];
  }

  public get currentRelativeHumidity() {
    const humidity = safeParseInt(this.data['airState.humidity.current']);
    if (humidity > HUMIDITY_MAX) {
      return humidity / HUMIDITY_DIVISOR;
    }

    return humidity;
  }

  public get currentTemperature() {
    return this.convertTemperatureCelsiusFromLGToHomekit(this.data['airState.tempState.current'] as number);
  }

  /** Target temperature as shown in HomeKit (Celsius). */
  public get targetTemperature() {
    return this.convertTemperatureCelsiusFromLGToHomekit(this.data['airState.tempState.target'] as number);
  }

  /** Raw target temperature as stored on the device (LG units). */
  public get targetTemperatureLG(): number {
    return Number(this.data['airState.tempState.target']);
  }

  public get airQuality() {
    // air quality not available
    if (!('airState.quality.overall' in this.data) && !('airState.quality.PM2' in this.data) && !('airState.quality.PM10' in this.data)) {
      return null;
    }

    return {
      isOn: this.isPowerOn || !!this.data['airState.quality.sensorMon'],
      overall: safeParseInt(this.data['airState.quality.overall']),
      PM2: safeParseInt(this.data['airState.quality.PM2']),
      PM10: safeParseInt(this.data['airState.quality.PM10']),
    };
  }

  // Should return 0 - 100 int
  public get windStrength() {
    return windStrengthToPercent(this.data['airState.windStrength']);
  }

  public get isWindStrengthAuto() {
    return Number(this.data['airState.windStrength']) === FAN_SPEED_AUTO;
  }

  public get isSwingOn() {
    const vStep = Math.floor((Number(this.data['airState.wDir.vStep']) || 0) / 100),
      hStep = Math.floor((Number(this.data['airState.wDir.hStep']) || 0) / 100);
    return !!(vStep + hStep);
  }

  public get isLightOn() {
    return !!this.data['airState.lightingState.displayControl'];
  }

  public get currentConsumption() {
    const consumption = Number(this.data['airState.energy.onCurrent']);
    if (isNaN(consumption)) {
      return 0;
    }

    return consumption / ENERGY_CONSUMPTION_DIVISOR;
  }

  public get type() {
    return this.device.deviceModel?.data?.Info?.modelType || ACModelType.RAC;
  }

  /**
   * Retrieves the temperature range based on the provided minimum and maximum range values.
   * Falls back to the model's `airState.tempState.limitMin` / `airState.tempState.target` ranges.
   */
  public getTemperatureRange([minRange, maxRange]: [EnumValue, EnumValue]): RangeValue {
    let temperature: RangeValue = {
      type: ValueType.Range,
      min: 0,
      max: 0,
      step: 0.01,
    };

    if (minRange && maxRange) {
      const minRangeOptions = Object.values(minRange.options ?? {}).filter((v): v is number => typeof v === 'number' && v !== 0);
      const maxRangeOptions = Object.values(maxRange.options ?? {}).filter((v): v is number => typeof v === 'number' && v !== 0);

      if (minRangeOptions.length) {
        temperature.min = Math.min(...minRangeOptions);
      }
      if (maxRangeOptions.length) {
        temperature.max = Math.max(...maxRangeOptions);
      }
    }

    if (!temperature || !temperature.min || !temperature.max) {
      temperature = this.device.deviceModel.value('airState.tempState.limitMin') as RangeValue;
    }

    if (!temperature || !temperature.min || !temperature.max) {
      temperature = this.device.deviceModel.value('airState.tempState.target') as RangeValue;
    }

    return temperature;
  }

  /**
   * Temperature range keys for heating (AWHP uses water temperature limits).
   */
  public getTemperatureRangeForHeating(): [EnumValue, EnumValue] {
    const [low, high] = this.type === ACModelType.AWHP
      ? ['support.airState.tempState.waterTempHeatMin', 'support.airState.tempState.waterTempHeatMax']
      : ['support.heatLowLimit', 'support.heatHighLimit'];
    return [this.device.deviceModel.value(low) as EnumValue, this.device.deviceModel.value(high) as EnumValue];
  }

  /**
   * Temperature range keys for cooling (AWHP uses water temperature limits).
   */
  public getTemperatureRangeForCooling(): [EnumValue, EnumValue] {
    const [low, high] = this.type === ACModelType.AWHP
      ? ['support.airState.tempState.waterTempCoolMin', 'support.airState.tempState.waterTempCoolMax']
      : ['support.coolLowLimit', 'support.coolHighLimit'];
    return [this.device.deviceModel.value(low) as EnumValue, this.device.deviceModel.value(high) as EnumValue];
  }
}
