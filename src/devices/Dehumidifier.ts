import type { AccessoryContext } from '../baseDevice.js';
import { BaseDevice } from '../baseDevice.js';
import type { LGThinQHomebridgePlatform } from '../platform.js';
import type { CharacteristicValue, Logger, PlatformAccessory } from 'homebridge';
import type { Device } from '../models/Device.js';
import { normalizeBoolean, normalizeNumber } from '../helper.js';
import { FAN_SPEED_MIN, FAN_SPEED_MAX, HUMIDITY_MAX } from '../lib/constants.js';
import { BaseStatus } from '../status/BaseStatus.js';

enum RotateSpeed {
  LOW = FAN_SPEED_MIN,
  HIGH = FAN_SPEED_MAX,
}

/** Ordered wind strengths; HomeKit RotationSpeed 1..N maps onto this list. */
export const DEHUMIDIFIER_SPEEDS: readonly number[] = [RotateSpeed.LOW, RotateSpeed.HIGH];

/** Map a HomeKit RotationSpeed level to a wind strength (rounded, clamped; 0 → lowest). */
export function dehumidifierSpeedToWindStrength(value: number): number {
  const level = Number.isFinite(value) ? Math.round(value) : 1;
  return DEHUMIDIFIER_SPEEDS[Math.max(1, Math.min(DEHUMIDIFIER_SPEEDS.length, level)) - 1];
}

/**
 * Dehumidifier operation modes that indicate active dehumidification
 */
const DEHUMIDIFYING_MODES = [17, 18, 19, 21];

export default class Dehumidifier extends BaseDevice {
  protected serviceDehumidifier;
  protected serviceHumiditySensor;
  constructor(
    platform: LGThinQHomebridgePlatform,
    accessory: PlatformAccessory<AccessoryContext>,
    logger: Logger,
  ) {
    super(platform, accessory, logger);

    const {
      Service: {
        HumidifierDehumidifier,
        HumiditySensor,
      },
      Characteristic,
      Characteristic: {
        CurrentHumidifierDehumidifierState,
      },
    } = this.platform;

    const device: Device = accessory.context.device;

    this.serviceDehumidifier = this.getOrCreateService(HumidifierDehumidifier, device.name);
    this.serviceDehumidifier.getCharacteristic(Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .updateValue(Characteristic.Active.INACTIVE);
    this.serviceDehumidifier.getCharacteristic(Characteristic.CurrentHumidifierDehumidifierState)
      .setProps({
        validValues: [
          CurrentHumidifierDehumidifierState.INACTIVE,
          CurrentHumidifierDehumidifierState.IDLE,
          CurrentHumidifierDehumidifierState.DEHUMIDIFYING,
        ],
      })
      .updateValue(Characteristic.CurrentHumidifierDehumidifierState.INACTIVE);
    this.serviceDehumidifier.getCharacteristic(Characteristic.TargetHumidifierDehumidifierState)
      .setProps({
        validValues: [2],
      })
      .updateValue(Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER);

    this.serviceDehumidifier.getCharacteristic(Characteristic.RelativeHumidityDehumidifierThreshold)
      .onSet(this.setHumidityThreshold.bind(this))
      .setProps({
        minValue: 0,
        maxValue: HUMIDITY_MAX,
        minStep: 1,
      });

    this.serviceDehumidifier.getCharacteristic(Characteristic.RotationSpeed)
      .onSet(this.setSpeed.bind(this))
      .setProps({
        minValue: 1,
        maxValue: DEHUMIDIFIER_SPEEDS.length,
        minStep: 1,
      });

    this.serviceHumiditySensor = this.getOrCreateService(HumiditySensor, 'Humidity Sensor');
    this.serviceHumiditySensor.addLinkedService(this.serviceDehumidifier);
  }

  protected communicationFailure() {
    return new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  async setActive(value: CharacteristicValue) {
    this.logger.debug('Set Dehumidifier Active State ->', value);
    const isOn = normalizeBoolean(value);
    if (this.Status.isPowerOn && isOn) {
      return; // don't send same status
    }

    if (!await this.setBooleanControl('airState.operation', isOn)) {
      throw this.communicationFailure();
    }
  }

  async setHumidityThreshold(value: CharacteristicValue) {
    if (!this.Status.isPowerOn) {
      return;
    }

    const vNum = normalizeNumber(value);
    if (vNum === null) {
      return;
    }

    if (!await this.setDeviceControl('airState.humidity.desired', vNum)) {
      throw this.communicationFailure();
    }
  }

  async setSpeed(value: CharacteristicValue) {
    if (!this.Status.isPowerOn) {
      return;
    }

    const vNum = normalizeNumber(value);
    if (vNum === null) {
      return;
    }

    if (!await this.setDeviceControl('airState.windStrength', dehumidifierSpeedToWindStrength(vNum))) {
      throw this.communicationFailure();
    }
  }

  public updateAccessoryCharacteristic(device: Device) {
    super.updateAccessoryCharacteristic(device);

    const {
      Characteristic,
      Characteristic: {
        CurrentHumidifierDehumidifierState: {
          INACTIVE,
          IDLE,
          DEHUMIDIFYING,
        },
      },
    } = this.platform;

    this.serviceDehumidifier.updateCharacteristic(Characteristic.Active, this.Status.isPowerOn ? 1 : 0);
    this.serviceDehumidifier.updateCharacteristic(Characteristic.CurrentRelativeHumidity, this.Status.humidityCurrent);
    this.serviceDehumidifier.updateCharacteristic(Characteristic.RelativeHumidityDehumidifierThreshold, this.Status.humidityTarget);
    const currentState = this.Status.isPowerOn ? (this.Status.isDehumidifying ? DEHUMIDIFYING : IDLE) : INACTIVE;
    this.serviceDehumidifier.updateCharacteristic(Characteristic.CurrentHumidifierDehumidifierState, currentState);
    this.serviceDehumidifier.updateCharacteristic(Characteristic.RotationSpeed, this.Status.rotationSpeed);
    this.serviceDehumidifier.updateCharacteristic(Characteristic.WaterLevel, this.Status.isWaterTankFull ? HUMIDITY_MAX : 0);

    this.serviceHumiditySensor.updateCharacteristic(Characteristic.CurrentRelativeHumidity, this.Status.humidityCurrent);
    this.serviceHumiditySensor.updateCharacteristic(Characteristic.StatusActive, this.Status.isPowerOn);
  }

  public get Status() {
    return this.getStatus(DehumidifierStatus);
  }
}

export class DehumidifierStatus extends BaseStatus {
  public get isPowerOn() {
    return this.getBool('airState.operation');
  }

  public get opMode() {
    return this.getInt('airState.opMode');
  }

  public get windStrength() {
    return this.getInt('airState.windStrength');
  }

  public get isDehumidifying() {
    return DEHUMIDIFYING_MODES.includes(this.opMode) && this.humidityCurrent >= this.humidityTarget;
  }

  public get humidityCurrent() {
    return this.getInt('airState.humidity.current');
  }

  public get humidityTarget() {
    return this.getInt('airState.humidity.desired');
  }

  public get rotationSpeed() {
    const index = DEHUMIDIFIER_SPEEDS.indexOf(this.windStrength);
    return index !== -1 ? index + 1 : Math.ceil(DEHUMIDIFIER_SPEEDS.length / 2);
  }

  public get isWaterTankFull() {
    return this.getBool('airState.notificationExt');
  }
}
