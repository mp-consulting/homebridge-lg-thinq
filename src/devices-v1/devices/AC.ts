import { default as AirConditioner, FanSpeed, OpMode, FAN_SPEED_AUTO, percentToWindStrength } from '../../devices/AirConditioner.js';
import type { CharacteristicValue } from 'homebridge';
import { ACOperation } from '../transforms/AirState.js';
import type { Device } from '../../models/Device.js';
import type { RangeValue } from '../../models/DeviceModel.js';
import { normalizeBoolean, normalizeNumber } from '../helper.js';
import { HOMEKIT_TEMP_MIN, HOMEKIT_TEMP_MAX } from '../../lib/constants.js';

/** Default ranges used when the v1 model JSON lacks TempCur / TempCfg */
const DEFAULT_CURRENT_TEMP_RANGE = { min: -50, max: 100 };
const DEFAULT_TARGET_TEMP_RANGE = { min: HOMEKIT_TEMP_MIN, max: HOMEKIT_TEMP_MAX };

function rangeOrDefault(value: unknown, fallback: { min: number; max: number }) {
  const range = value as Partial<RangeValue> | null | undefined;
  const min = typeof range?.min === 'number' ? range.min : fallback.min;
  const max = typeof range?.max === 'number' ? range.max : fallback.max;
  return min < max ? { min, max } : fallback;
}

export default class AC extends AirConditioner {

  protected createHeaterCoolerService() {
    const {
      Characteristic,
    } = this.platform;
    const device: Device = this.accessory.context.device;

    super.createHeaterCoolerService();

    const current = rangeOrDefault(device.deviceModel.value('TempCur'), DEFAULT_CURRENT_TEMP_RANGE);
    this.service.getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({ minValue: current.min, maxValue: current.max });

    const target = rangeOrDefault(device.deviceModel.value('TempCfg'), DEFAULT_TARGET_TEMP_RANGE);
    this.service.getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .setProps({ minValue: target.min, maxValue: target.max });
    this.service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
      .setProps({ minValue: target.min, maxValue: target.max });
  }

  /** ThinQ1 devices don't support the v2 `airState.mon.timeout` keep-alive. */
  protected startMonitor() {
    this.stopMonitor();
  }

  async setFanState(value: CharacteristicValue) {
    const { TargetFanState } = this.platform.Characteristic;
    if (!this.Status.isPowerOn) {
      this.logger.debug('Power is off, cannot set fan state');
      return;
    }
    const device: Device = this.accessory.context.device;

    const vNum = normalizeNumber(value);
    const isAuto = (vNum !== null) ? (vNum === TargetFanState.AUTO) : normalizeBoolean(value);
    const windStrength = isAuto ? FAN_SPEED_AUTO : FanSpeed.HIGH;
    await this.platform.ThinQ?.thinq1DeviceControl(device, 'WindStrength', windStrength);
  }

  async setJetModeActive(value: CharacteristicValue) {
    const device: Device = this.accessory.context.device;
    const vNum = normalizeNumber(value);
    const jetModeValue = (vNum !== null) ? vNum : (normalizeBoolean(value) ? 1 : 0);
    if (this.Status.isPowerOn && this.Status.opMode === OpMode.COOL) {
      await this.platform.ThinQ?.thinq1DeviceControl(device, 'Jet', jetModeValue);
    }
  }

  async setActive(value: CharacteristicValue) {
    const device: Device = this.accessory.context.device;
    const vNum = normalizeNumber(value);
    const isOn = (vNum !== null) ? (vNum === 1) : normalizeBoolean(value);
    const op = isOn ? ACOperation.RIGHT_ON : ACOperation.OFF;
    const opValue = device.deviceModel.enumValue('Operation', op);

    await this.platform.ThinQ?.thinq1DeviceControl(device, 'Operation', opValue);
  }

  async setTargetTemperature(value: CharacteristicValue) {
    if (!this.Status.isPowerOn) {
      return;
    }
    const vNum = normalizeNumber(value);
    if (vNum === null) {
      return;
    }

    const device: Device = this.accessory.context.device;
    await this.platform.ThinQ?.thinq1DeviceControl(device, 'TempCfg', `${vNum}`);
    this.setSnapshotValues({ 'airState.tempState.target': vNum });
    this.updateAccessoryCharacteristic(device);
  }

  /**
   * HomeKit sends a 0-100 percentage; map it onto the LG wind strength enum (LOW..HIGH).
   */
  async setFanSpeed(value: CharacteristicValue) {
    if (!this.Status.isPowerOn) {
      return;
    }

    const vNum = normalizeNumber(value);
    if (vNum === null) {
      return;
    }

    const device: Device = this.accessory.context.device;
    const windStrength = percentToWindStrength(vNum);
    await this.platform.ThinQ?.thinq1DeviceControl(device, 'WindStrength', windStrength);
  }

  async setSwingMode(value: CharacteristicValue) {
    if (!this.Status.isPowerOn) {
      return;
    }

    const swingValue = normalizeBoolean(value) ? '100' : '0';

    const device: Device = this.accessory.context.device;

    if (this.config.ac_swing_mode === 'BOTH' || this.config.ac_swing_mode === 'VERTICAL') {
      await this.platform.ThinQ?.thinq1DeviceControl(device, 'WDirVStep', swingValue);
      this.setSnapshotValues({ 'airState.wDir.vStep': swingValue });
    }

    if (this.config.ac_swing_mode === 'BOTH' || this.config.ac_swing_mode === 'HORIZONTAL') {
      await this.platform.ThinQ?.thinq1DeviceControl(device, 'WDirHStep', swingValue);
      this.setSnapshotValues({ 'airState.wDir.hStep': swingValue });
    }

    this.updateAccessoryCharacteristic(device);
  }

  async setOpMode(deviceId: string, opMode: number) {
    void deviceId;
    const device: Device = this.accessory.context.device;
    const result = await this.platform.ThinQ?.thinq1DeviceControl(device, 'OpMode', opMode);
    const success = result !== null && result !== undefined;
    if (success) {
      this.setSnapshotValues({ 'airState.opMode': opMode });
      this.updateAccessoryCharacteristic(device);
    }
    return success;
  }

  async setLight(value: CharacteristicValue) {
    const device: Device = this.accessory.context.device;
    await this.platform.ThinQ?.thinq1DeviceControl(device, 'DisplayControl', value ? '1' : '0');
  }
}
