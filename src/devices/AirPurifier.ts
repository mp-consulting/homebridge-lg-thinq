import type { LGThinQHomebridgePlatform } from '../platform.js';
import type { CharacteristicValue, Logger, PlatformAccessory, Service } from 'homebridge';
import type { Device } from '../models/Device.js';
import type { AccessoryContext } from '../baseDevice.js';
import { BaseDevice } from '../baseDevice.js';
import { normalizeBoolean, normalizeNumber } from '../helper.js';
import { FILTER_CHANGE_THRESHOLD_PERCENT, AIR_PURIFIER_NORMAL_MODE, AIR_PURIFIER_AUTO_MODE } from '../lib/constants.js';
import { BaseStatus } from '../status/BaseStatus.js';

export enum RotateSpeed {
  LOW = 2,
  MEDIUM = 4,
  HIGH = 6,
  EXTRA = 7,
}

/** Ordered wind strengths; HomeKit RotationSpeed 1..N maps onto this list. */
export const AIR_PURIFIER_SPEEDS: readonly RotateSpeed[] = [RotateSpeed.LOW, RotateSpeed.MEDIUM, RotateSpeed.HIGH, RotateSpeed.EXTRA];

/**
 * Map a HomeKit RotationSpeed (0..AIR_PURIFIER_SPEEDS.length, step 0.1) to an LG wind strength.
 * Values are rounded and clamped; 0 (and anything below 1) maps to the lowest speed.
 */
export function rotationSpeedToWindStrength(value: number): RotateSpeed {
  const level = Number.isFinite(value) ? Math.round(value) : 1;
  const index = Math.max(1, Math.min(AIR_PURIFIER_SPEEDS.length, level)) - 1;
  return AIR_PURIFIER_SPEEDS[index];
}

/**
 * Map an LG wind strength to a HomeKit RotationSpeed level (1..N). Unknown values map to the middle level.
 */
export function windStrengthToRotationSpeed(windStrength: number): number {
  const index = AIR_PURIFIER_SPEEDS.indexOf(windStrength as RotateSpeed);
  return index !== -1 ? index + 1 : Math.ceil(AIR_PURIFIER_SPEEDS.length / 2);
}

// opMode = 14 => normal mode, can rotate speed
export default class AirPurifier extends BaseDevice {
  protected serviceAirPurifier: Service | undefined;
  protected serviceAirQuality: Service;
  protected serviceLight: Service | undefined;
  protected serviceFilterMaintenance: Service | undefined;
  protected serviceAirFastMode: Service | undefined;

  constructor(
    platform: LGThinQHomebridgePlatform,
    accessory: PlatformAccessory<AccessoryContext>,
    logger: Logger,
  ) {
    super(platform, accessory, logger);

    const {
      Service: {
        AirPurifier,
        AirQualitySensor,
        Lightbulb,
        FilterMaintenance,
        Switch,
      },
      Characteristic,
    } = this.platform;

    const device: Device = accessory.context.device;

    // get the service if it exists, otherwise create a new service
    this.serviceAirPurifier = this.getOrCreateService(AirPurifier, 'Air Purifier');

    /**
     * Required Characteristics: Active, CurrentAirPurifierState, TargetAirPurifierState
     */
    this.serviceAirPurifier.getCharacteristic(Characteristic.Active)
      .onGet(() => {
        return this.Status.isPowerOn ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
      })
      .onSet(this.setActive.bind(this));
    this.serviceAirPurifier.getCharacteristic(Characteristic.TargetAirPurifierState)
      .onSet(this.setTargetAirPurifierState.bind(this));

    /**
     * Optional Characteristics: Name, RotationSpeed, SwingMode
     */
    this.serviceAirPurifier.setCharacteristic(Characteristic.Name, device.name);
    this.serviceAirPurifier.getCharacteristic(Characteristic.SwingMode).onSet(this.setSwingMode.bind(this));
    this.serviceAirPurifier.getCharacteristic(Characteristic.RotationSpeed)
      .onSet(this.setRotationSpeed.bind(this))
      .setProps({ minValue: 0, maxValue: AIR_PURIFIER_SPEEDS.length, minStep: 0.1 });

    this.serviceAirQuality = this.getOrCreateService(AirQualitySensor, 'Air Quality Sensor');

    // check if light is available
    const hasLightControl = 'airState.lightingState.displayControl' in device.snapshot
      || 'airState.lightingState.signal' in device.snapshot;
    this.serviceLight = this.ensureService(Lightbulb, 'Light', hasLightControl, 'Light');
    if (this.serviceLight) {
      this.serviceLight.getCharacteristic(Characteristic.On).onSet(this.setLight.bind(this));
    }

    this.serviceFilterMaintenance = this.ensureService(
      FilterMaintenance, 'Filter Maintenance', !!this.Status.filterMaxTime, 'Filter Maintenance',
    );
    if (this.serviceFilterMaintenance) {
      this.serviceAirPurifier.addLinkedService(this.serviceFilterMaintenance);
    }

    this.serviceAirFastMode = this.ensureService(Switch, 'Air Fast', this.config.air_fast_mode, 'Air Fast');
    if (this.serviceAirFastMode) {
      this.serviceAirFastMode.getCharacteristic(Characteristic.On)
        .onSet(this.setAirFastActive.bind(this));
    }
  }

  public get Status() {
    return this.getStatus(AirPurifierStatus);
  }

  protected communicationFailure() {
    return new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  /**
   * Send a single dataKey/dataValue control. The snapshot is updated (and characteristics refreshed)
   * only on success; failures surface to HomeKit as SERVICE_COMMUNICATION_FAILURE.
   */
  protected async sendControl(dataKey: string, dataValue: number): Promise<void> {
    if (!await this.setDeviceControl(dataKey, dataValue)) {
      this.logger.warn(`[${this.accessory.context.device.name}] Device did not accept ${dataKey}`);
      throw this.communicationFailure();
    }
  }

  async setAirFastActive(value: CharacteristicValue) {
    if (!this.Status.isPowerOn) {
      return;
    }
    await this.sendControl('airState.miscFuncState.airFast', normalizeBoolean(value) ? 1 : 0);
  }

  async setActive(value: CharacteristicValue) {
    const isOn = normalizeBoolean(value);
    if (this.Status.isPowerOn && isOn) {
      return; // don't send same status
    }

    this.logger.debug('Set Active State ->', value);
    if (!await this.setBooleanControl('airState.operation', isOn)) {
      throw this.communicationFailure();
    }
  }

  async setTargetAirPurifierState(value: CharacteristicValue) {
    if (!this.Status.isPowerOn || (!!value !== this.Status.isNormalMode)) {
      return; // just skip it
    }

    this.logger.debug('Set Target State ->', value);
    await this.sendControl('airState.opMode', value ? AIR_PURIFIER_AUTO_MODE : AIR_PURIFIER_NORMAL_MODE);
  }

  async setRotationSpeed(value: CharacteristicValue) {
    if (!this.Status.isPowerOn || !this.Status.isNormalMode) {
      return;
    }

    const vNum = normalizeNumber(value);
    if (vNum === null) {
      return;
    }

    this.logger.debug('Set Rotation Speed ->', value);
    await this.sendControl('airState.windStrength', rotationSpeedToWindStrength(vNum));
  }

  async setSwingMode(value: CharacteristicValue) {
    if (!this.Status.isPowerOn || !this.Status.isNormalMode) {
      return;
    }
    await this.sendControl('airState.circulate.rotate', normalizeBoolean(value) ? 1 : 0);
  }

  async setLight(value: CharacteristicValue) {
    if (!this.Status.isPowerOn) {
      return;
    }

    const device: Device = this.accessory.context.device;
    let dataKey = '';
    if ('airState.lightingState.signal' in device.snapshot) {
      dataKey = 'airState.lightingState.signal';
    } else if ('airState.lightingState.displayControl' in device.snapshot) {
      dataKey = 'airState.lightingState.displayControl';
    }

    if (!dataKey) {
      return;
    }

    await this.sendControl(dataKey, normalizeBoolean(value) ? 1 : 0);
  }

  public updateAccessoryCharacteristic(device: Device) {
    super.updateAccessoryCharacteristic(device);
    const {
      Characteristic,
      Characteristic: {
        TargetAirPurifierState,
        FilterChangeIndication,
      },
    } = this.platform;

    this.serviceAirPurifier?.updateCharacteristic(Characteristic.Active, this.Status.isPowerOn ? 1 : 0);
    this.serviceAirPurifier?.updateCharacteristic(Characteristic.CurrentAirPurifierState, this.Status.isPowerOn ? 2 : 0);
    this.serviceAirPurifier?.updateCharacteristic(TargetAirPurifierState,
      this.Status.isNormalMode ? TargetAirPurifierState.MANUAL : TargetAirPurifierState.AUTO);
    this.serviceAirPurifier?.updateCharacteristic(Characteristic.SwingMode, this.Status.isSwing ? 1 : 0);
    this.serviceAirPurifier?.updateCharacteristic(Characteristic.RotationSpeed, this.Status.rotationSpeed);

    if (this.Status.filterMaxTime && this.serviceFilterMaintenance) {
      const remaining = this.Status.filterRemainingPercent;
      this.serviceFilterMaintenance.updateCharacteristic(Characteristic.FilterLifeLevel, remaining);
      this.serviceFilterMaintenance.updateCharacteristic(FilterChangeIndication,
        AirPurifierStatus.needsFilterChange(remaining) ? FilterChangeIndication.CHANGE_FILTER : FilterChangeIndication.FILTER_OK);
    }

    // airState.quality.sensorMon = 1 mean sensor always running even device not running
    this.serviceAirQuality.updateCharacteristic(Characteristic.AirQuality, this.Status.airQuality.overall);
    this.serviceAirQuality.updateCharacteristic(Characteristic.PM2_5Density, this.Status.airQuality.PM2);
    this.serviceAirQuality.updateCharacteristic(Characteristic.PM10Density, this.Status.airQuality.PM10);
    this.serviceAirQuality.updateCharacteristic(Characteristic.StatusActive, this.Status.airQuality.isOn);

    if (this.serviceLight) {
      this.serviceLight.updateCharacteristic(Characteristic.On, this.Status.isLightOn);
    }

    if (this.config.air_fast_mode && this.serviceAirFastMode) {
      this.serviceAirFastMode.updateCharacteristic(Characteristic.On, this.Status.isAirFastEnable);
    }
  }
}

export class AirPurifierStatus extends BaseStatus {
  public get isPowerOn() {
    return this.getBoolean('airState.operation');
  }

  public get isLightOn() {
    if (this.hasProperty('airState.lightingState.signal')) {
      return this.isPowerOn && this.getBoolean('airState.lightingState.signal');
    }
    if (this.hasProperty('airState.lightingState.displayControl')) {
      return this.isPowerOn && this.getBoolean('airState.lightingState.displayControl');
    }
    return false;
  }

  public get isSwing() {
    return this.getBoolean('airState.circulate.rotate');
  }

  public get airQuality() {
    return this.getAirQualityData(this.isPowerOn) ?? {
      isOn: false,
      overall: 0,
      PM2: 0,
      PM10: 0,
    };
  }

  public get rotationSpeed() {
    return windStrengthToRotationSpeed(this.getInt('airState.windStrength'));
  }

  public get isNormalMode() {
    return this.getInt('airState.opMode') === AIR_PURIFIER_NORMAL_MODE;
  }

  /** Remaining filter life in percent (100 = new, 0 = worn out), clamped 0-100. */
  public get filterRemainingPercent() {
    return this.getFilterRemainingPercent(
      'airState.filterMngStates.useTime',
      'airState.filterMngStates.maxTime',
    );
  }

  /** @deprecated Misnamed: this is the REMAINING life. Use filterRemainingPercent. */
  public get filterUsedTimePercent() {
    return this.filterRemainingPercent;
  }

  /**
   * The filter should be changed once its used life exceeds FILTER_CHANGE_THRESHOLD_PERCENT,
   * i.e. when the remaining life drops below (100 - threshold).
   */
  public static needsFilterChange(remainingPercent: number): boolean {
    return remainingPercent < 100 - FILTER_CHANGE_THRESHOLD_PERCENT;
  }

  public get filterMaxTime() {
    return this.getInt('airState.filterMngStates.maxTime');
  }

  public get filterUseTime() {
    return this.getInt('airState.filterMngStates.useTime');
  }

  public get isAirFastEnable() {
    return this.getBoolean('airState.miscFuncState.airFast');
  }
}
