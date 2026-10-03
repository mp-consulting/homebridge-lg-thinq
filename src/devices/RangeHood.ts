import type { AccessoryContext } from '../baseDevice.js';
import { BaseDevice } from '../baseDevice.js';
import type { LGThinQHomebridgePlatform } from '../platform.js';
import type { CharacteristicValue, Logger, PlatformAccessory, Service } from 'homebridge';
import type { Device } from '../models/Device.js';
import { ValueType } from '../models/DeviceModel.js';
import { BaseStatus } from '../status/BaseStatus.js';

export default class RangeHood extends BaseDevice {
  protected serviceHood: Service;
  protected serviceLight: Service;

  constructor(
    platform: LGThinQHomebridgePlatform,
    accessory: PlatformAccessory<AccessoryContext>,
    logger: Logger,
  ) {
    super(platform, accessory, logger);

    const device: Device = this.accessory.context.device;

    const {
      Service: {
        Fan,
        Lightbulb,
      },
      Characteristic,
    } = this.platform;

    this.serviceHood = this.getOrCreateService(Fan, device.name);
    this.serviceHood.getCharacteristic(Characteristic.On)
      .onSet(this.setHoodActive.bind(this));
    this.serviceHood.getCharacteristic(Characteristic.RotationSpeed)
      .onSet(this.setHoodRotationSpeed.bind(this));

    const ventLevelSpec = device.deviceModel.value('VentLevel');
    if (ventLevelSpec?.type === ValueType.Range) {
      this.serviceHood.getCharacteristic(Characteristic.RotationSpeed)
        .setProps({
          minValue: ventLevelSpec.min,
          maxValue: ventLevelSpec.max,
          minStep: ventLevelSpec.step,
        });
    }

    // vent lamp
    this.serviceLight = this.getOrCreateService(Lightbulb, device.name + ' - Light', 'Light');
    this.serviceLight.getCharacteristic(Characteristic.On)
      .onSet(this.setLightActive.bind(this));
    this.serviceLight.getCharacteristic(Characteristic.Brightness)
      .onSet(this.setLightBrightness.bind(this));

    const ventLightSpec = device.deviceModel.value('LampLevel');
    if (ventLightSpec?.type === ValueType.Range) {
      this.serviceLight.getCharacteristic(Characteristic.Brightness)
        .setProps({
          minValue: ventLightSpec.min,
          maxValue: ventLightSpec.max,
          minStep: ventLightSpec.step,
        });
    }
    // initial characteristic update is performed by the platform after construction
  }

  async setHoodActive(value: CharacteristicValue) {
    await this.setHoodRotationSpeed(value ? 1 : 0);
  }

  async setHoodRotationSpeed(value: CharacteristicValue) {
    await this.sendHoodControl({ ventLevel: value }, 'hood rotation speed');
  }

  async setLightActive(value: CharacteristicValue) {
    await this.setLightBrightness(value ? 1 : 0);
  }

  async setLightBrightness(value: CharacteristicValue) {
    await this.sendHoodControl({ lampLevel: value }, 'light brightness');
  }

  /**
   * Send a hoodState control; throws SERVICE_COMMUNICATION_FAILURE on error or rejection.
   */
  protected async sendHoodControl(values: Record<string, unknown>, label: string): Promise<void> {
    const device: Device = this.accessory.context.device;
    let success: boolean;
    try {
      success = !!await this.platform.ThinQ?.deviceControl(device.id, {
        dataKey: null,
        dataValue: null,
        dataSetList: {
          hoodState: values,
        },
        dataGetList: null,
      });
    } catch (error) {
      this.logger.error(`Failed to set ${label}:`, error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    if (!success) {
      this.logger.warn(`[${device.name}] Device did not accept ${label}`);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  public updateAccessoryCharacteristic(device: Device) {
    super.updateAccessoryCharacteristic(device);

    const {
      Characteristic,
    } = this.platform;

    this.serviceHood.updateCharacteristic(Characteristic.On, this.Status.isVentOn);
    this.serviceHood.updateCharacteristic(Characteristic.RotationSpeed, this.Status.ventLevel);

    this.serviceLight.updateCharacteristic(Characteristic.On, this.Status.isLampOn);
    this.serviceLight.updateCharacteristic(Characteristic.Brightness, this.Status.lampLevel);
  }

  public get Status() {
    return this.getStatus(RangeHoodStatus, 'hoodState');
  }
}

export class RangeHoodStatus extends BaseStatus {
  public get isVentOn() {
    return this.getString('ventSet') === this.deviceModel.lookupMonitorName('VentSet', '@CP_ENABLE_W');
  }

  public get isLampOn() {
    return this.getString('lampSet') === this.deviceModel.lookupMonitorName('LampSet', '@CP_ENABLE_W');
  }

  public get ventLevel() {
    return this.getInt('ventLevel');
  }

  public get lampLevel() {
    return this.getInt('lampLevel');
  }
}
