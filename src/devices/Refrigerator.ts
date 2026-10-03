import type { LGThinQHomebridgePlatform } from '../platform.js';
import type { CharacteristicValue, Logger, PlatformAccessory, Service } from 'homebridge';
import type { Device } from '../models/Device.js';
import type { AccessoryContext } from '../baseDevice.js';
import { BaseDevice } from '../baseDevice.js';
import type { DeviceModel } from '../models/DeviceModel.js';
import { cToF, fToC, normalizeBoolean, normalizeNumber, safeParseInt } from '../helper.js';
import { FILTER_CHANGE_THRESHOLD_PERCENT } from '../lib/constants.js';

/** Default thermostat ranges (Celsius) when the model has no usable value mapping */
export const REF_FRIDGE_DEFAULT_RANGE = { min: 1, max: 7 };
export const REF_FREEZER_DEFAULT_RANGE = { min: -23, max: -15 };

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export default class Refrigerator extends BaseDevice {
  protected serviceFreezer: Service | undefined;
  protected serviceFridge: Service | undefined;
  protected serviceDoorOpened: Service | undefined;
  protected serviceExpressMode: Service | undefined;
  protected serviceExpressFridge: Service | undefined;
  protected serviceEcoFriendly: Service | undefined;
  protected serviceWaterFilter: Service | undefined;

  constructor(
    platform: LGThinQHomebridgePlatform,
    accessory: PlatformAccessory<AccessoryContext>,
    logger: Logger,
  ) {
    super(platform, accessory, logger);

    const {
      Service: {
        ContactSensor,
        Switch,
        ServiceLabel,
        FilterMaintenance,
      },
      Characteristic,
    } = this.platform;

    const serviceLabel = accessory.getService(ServiceLabel);
    if (serviceLabel) {
      accessory.removeService(serviceLabel);
    }

    this.serviceFridge = this.createThermostat('Fridge', 'fridgeTemp');
    if (this.serviceFridge) {
      this.serviceFridge.updateCharacteristic(Characteristic.TargetTemperature, this.Status.fridgeTemperature);
    }

    this.serviceFreezer = this.createThermostat('Freezer', 'freezerTemp');
    if (this.serviceFreezer) {
      this.serviceFreezer.updateCharacteristic(Characteristic.TargetTemperature, this.Status.freezerTemperature);
    }

    // Door open state
    this.serviceDoorOpened = this.getOrCreateService(ContactSensor, 'Refrigerator Door Closed');

    // Express Freezer mode
    const hasExpressFreezer = this.config.ref_express_freezer
      && this.hasRefStateKey('expressMode');
    this.serviceExpressMode = this.ensureService(Switch, 'Express Freezer', hasExpressFreezer, 'Express Freezer');
    if (this.serviceExpressMode) {
      this.serviceExpressMode.getCharacteristic(Characteristic.On).onSet(this.setExpressMode.bind(this));
    }

    // Express Fridge mode
    const hasExpressFridge = this.config.ref_express_fridge
      && this.hasRefStateKey('expressFridge');
    this.serviceExpressFridge = this.ensureService(Switch, 'Express Fridge', hasExpressFridge, 'Express Fridge');
    if (this.serviceExpressFridge) {
      this.serviceExpressFridge.getCharacteristic(Characteristic.On).onSet(this.setExpressFridge.bind(this));
    }

    // Eco Friendly mode
    const hasEcoFriendly = this.config.ref_eco_friendly
      && this.hasRefStateKey('ecoFriendly');
    this.serviceEcoFriendly = this.ensureService(Switch, 'Eco Friendly', hasEcoFriendly, 'Eco Friendly');
    if (this.serviceEcoFriendly) {
      this.serviceEcoFriendly.getCharacteristic(Characteristic.On).onSet(this.setEcoFriendly.bind(this));
    }

    // Water Filter maintenance
    this.serviceWaterFilter = this.ensureService(
      FilterMaintenance, 'Water Filter Maintenance', this.Status.hasFeature('waterFilter'), 'Water Filter Maintenance',
    );
  }

  public get Status() {
    return this.getStatus(RefrigeratorStatus);
  }

  /**
   * update accessory characteristic by device
   */
  public updateAccessoryCharacteristic(device: Device) {
    super.updateAccessoryCharacteristic(device);

    const {
      Characteristic,
      Characteristic: {
        FilterLifeLevel,
        FilterChangeIndication,
      },
    } = this.platform;

    const tempBetween = (props: { minValue?: number; maxValue?: number }, value: number) => {
      return Math.min(Math.max(props.minValue ?? value, value), props.maxValue ?? value);
    };

    if (this.serviceFreezer) {
      const t = tempBetween(this.serviceFreezer.getCharacteristic(Characteristic.TargetTemperature).props, this.Status.freezerTemperature);
      this.serviceFreezer.updateCharacteristic(Characteristic.CurrentTemperature, t);
      this.serviceFreezer.updateCharacteristic(Characteristic.TargetTemperature, t);
    }

    if (this.serviceFridge) {
      const t = tempBetween(this.serviceFridge.getCharacteristic(Characteristic.TargetTemperature).props, this.Status.fridgeTemperature);
      this.serviceFridge.updateCharacteristic(Characteristic.CurrentTemperature, t);
      this.serviceFridge.updateCharacteristic(Characteristic.TargetTemperature, t);
    }

    if (this.serviceDoorOpened) {
      const contactSensorValue = this.Status.isDoorClosed ?
        Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
      this.serviceDoorOpened.updateCharacteristic(Characteristic.ContactSensorState, contactSensorValue);
    }
    if (this.config.ref_express_freezer && this.hasRefStateKey('expressMode') && this.serviceExpressMode) {
      this.serviceExpressMode.updateCharacteristic(Characteristic.On, this.Status.isExpressModeOn);
    }

    if (this.config.ref_express_fridge && this.hasRefStateKey('expressFridge') && this.serviceExpressFridge) {
      this.serviceExpressFridge.updateCharacteristic(Characteristic.On, this.Status.isExpressFridgeOn);
    }

    if (this.config.ref_eco_friendly && this.hasRefStateKey('ecoFriendly') && this.serviceEcoFriendly) {
      this.serviceEcoFriendly.updateCharacteristic(Characteristic.On, this.Status.isEcoFriendlyOn);
    }

    if (this.Status.hasFeature('waterFilter') && this.serviceWaterFilter) {
      this.serviceWaterFilter.updateCharacteristic(FilterLifeLevel, this.Status.waterFilterRemain);
      this.serviceWaterFilter.updateCharacteristic(FilterChangeIndication,
        this.Status.waterFilterRemain < 100 - FILTER_CHANGE_THRESHOLD_PERCENT ? FilterChangeIndication.CHANGE_FILTER : FilterChangeIndication.FILTER_OK);
    }
  }

  /**
   * True when the refState snapshot contains the given key (safe when refState is missing).
   */
  protected hasRefStateKey(key: string): boolean {
    const refState = this.accessory.context.device.snapshot?.refState;
    return !!refState && typeof refState === 'object' && key in refState;
  }

  protected communicationFailure() {
    return new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  /**
   * Send a refState control (dataSetList). Throws SERVICE_COMMUNICATION_FAILURE on error or rejection.
   */
  protected async sendRefStateControl(values: Record<string, unknown>, label: string): Promise<void> {
    const device: Device = this.accessory.context.device;
    let success: boolean;
    try {
      success = !!await this.platform.ThinQ?.deviceControl(device.id, {
        dataKey: null,
        dataValue: null,
        dataSetList: {
          refState: {
            ...values,
            tempUnit: this.Status.tempUnit,
          },
        },
        dataGetList: null,
      });
    } catch (error) {
      this.logger.error(`[${device.name}] Failed to set ${label}:`, error);
      throw this.communicationFailure();
    }
    if (!success) {
      this.logger.warn(`[${device.name}] Device did not accept ${label}`);
      throw this.communicationFailure();
    }
  }

  /**
   * Shared on/off toggle for refState modes (expressMode, expressFridge, ecoFriendly).
   */
  protected async setRefStateToggle(key: string, value: CharacteristicValue) {
    const deviceModel = this.accessory.context.device.deviceModel;
    const On = deviceModel.lookupMonitorName(key, '@CP_ON_EN_W');
    const Off = deviceModel.lookupMonitorName(key, '@CP_OFF_EN_W');
    await this.sendRefStateControl({ [key]: normalizeBoolean(value) ? On : Off }, key);
    this.logger.debug(`Set ${key} ->`, value);
  }

  async setExpressMode(value: CharacteristicValue) {
    await this.setRefStateToggle('expressMode', value);
  }

  async setExpressFridge(value: CharacteristicValue) {
    await this.setRefStateToggle('expressFridge', value);
  }

  async setEcoFriendly(value: CharacteristicValue) {
    await this.setRefStateToggle('ecoFriendly', value);
  }

  async tempUnit() {
    const {
      Characteristic: {
        TemperatureDisplayUnits,
      },
    } = this.platform;
    return this.Status.tempUnit === 'CELSIUS' ? TemperatureDisplayUnits.CELSIUS : TemperatureDisplayUnits.FAHRENHEIT;
  }

  /**
   * create a thermostat service
   */
  protected createThermostat(name: string, key: string): Service | undefined {
    const device: Device = this.accessory.context.device;
    if (!this.Status.hasFeature(key)) {
      return;
    }

    const { Characteristic } = this.platform;
    const isCelsius = this.Status.tempUnit === 'CELSIUS';

    let service = this.accessory.getService(name);
    if (!service) {
      service = this.accessory.addService(this.platform.Service.Thermostat, name, name);
      service.addOptionalCharacteristic(Characteristic.ConfiguredName);
      service.updateCharacteristic(Characteristic.ConfiguredName, name);
    }

    // Restrict to Cool only
    service.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, Characteristic.CurrentHeatingCoolingState.COOL)
      .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .setProps({
        validValues: [Characteristic.CurrentHeatingCoolingState.COOL], // Hide other states
      });

    service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .updateValue(Characteristic.TargetHeatingCoolingState.COOL)
      .setProps({
        validValues: [Characteristic.TargetHeatingCoolingState.COOL], // Hide Heat/Auto/Off
      });

    service.getCharacteristic(Characteristic.TemperatureDisplayUnits).setProps({
      minValue: Characteristic.TemperatureDisplayUnits.CELSIUS,
      maxValue: Characteristic.TemperatureDisplayUnits.FAHRENHEIT,
    }).onGet(this.tempUnit.bind(this));

    const valueMapping = device.deviceModel.monitoringValueMapping(key + '_C') || device.deviceModel.monitoringValueMapping(key);
    if (!valueMapping) {
      this.logger.error(`[Refrigerator] [${this.accessory.context.device.name}] No value mapping found for ${key}`);
      return service;
    }

    const values = Object.values(valueMapping)
      .map(value => {
        if (value && typeof value === 'object' && 'label' in value) {
          return safeParseInt(value.label as string, NaN);
        }

        return safeParseInt(value as string, NaN);
      })
      .filter(value => {
        return !isNaN(value);
      });

    // Fall back to sane defaults if the model has no numeric mapping (Math.min(...[]) === Infinity)
    const fallback = key.toLowerCase().includes('freezer') ? REF_FREEZER_DEFAULT_RANGE : REF_FRIDGE_DEFAULT_RANGE;
    const minValue = values.length ? Math.min(...values) : fallback.min;
    const maxValue = values.length ? Math.max(...values) : fallback.max;

    service.getCharacteristic(Characteristic.TargetTemperature)
      .updateValue(minValue)
      .onSet(async (value: CharacteristicValue) => { // value in celsius
        const vNum = normalizeNumber(value);
        if (vNum === null) {
          throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
        }

        let indexValue;
        if (this.Status.tempUnit === 'FAHRENHEIT') {
          indexValue = device.deviceModel.lookupMonitorName(key + '_F', cToF(vNum).toString())
            || device.deviceModel.lookupMonitorName(key, cToF(vNum).toString());
        } else {
          indexValue = device.deviceModel.lookupMonitorName(key + '_C', vNum.toString())
            || device.deviceModel.lookupMonitorName(key, vNum.toString());
        }

        if (!indexValue) {
          throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
        }

        await this.setTemperature(key, indexValue);
      })
      .setProps({ minValue, maxValue, minStep: isCelsius ? 1 : 0.1 });

    return service;
  }

  async setTemperature(key: string, temp: string) {
    await this.sendRefStateControl({ [key]: safeParseInt(temp) }, 'temperature');
  }
}

export class RefrigeratorStatus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(protected data: any, protected deviceModel: DeviceModel) {
  }

  public get freezerTemperature() {
    if (this.tempUnit === 'FAHRENHEIT') {
      return fToC(safeParseInt(this.deviceModel.lookupMonitorValue2('freezerTemp_F', this.data?.freezerTemp, '0')));
    }

    return safeParseInt(this.deviceModel.lookupMonitorValue2('freezerTemp_C', this.data?.freezerTemp, '0'));
  }

  public get fridgeTemperature() {
    if (this.tempUnit === 'FAHRENHEIT') {
      return fToC(safeParseInt(this.deviceModel.lookupMonitorValue2('fridgeTemp_F', this.data?.fridgeTemp, '0')));
    }

    return safeParseInt(this.deviceModel.lookupMonitorValue2('fridgeTemp_C', this.data?.fridgeTemp, '0'));
  }

  public get isDoorClosed() {
    return this.data?.atLeastOneDoorOpen === 'CLOSE';
  }

  public get isExpressModeOn() {
    return this.data?.expressMode === this.deviceModel.lookupMonitorName('expressMode', '@CP_ON_EN_W');
  }

  public get isExpressFridgeOn() {
    return this.data?.expressFridge === this.deviceModel.lookupMonitorName('expressFridge', '@CP_ON_EN_W');
  }

  public get isEcoFriendlyOn() {
    return this.data?.ecoFriendly === this.deviceModel.lookupMonitorName('ecoFriendly', '@CP_ON_EN_W');
  }

  public get tempUnit() {
    return this.data?.tempUnit || 'CELSIUS';
  }

  /**
   * Remaining water filter life in percent (0-100).
   * Uses `waterFilter1RemainP` when present, otherwise parses the months used from `waterFilter` (e.g. "12_..").
   */
  public get waterFilterRemain(): number {
    const data = this.data;
    if (!data || typeof data !== 'object') {
      return 0;
    }

    if ('waterFilter1RemainP' in data) {
      return clampPercent(Number(data.waterFilter1RemainP) || 0);
    }

    if (typeof data.waterFilter === 'string') {
      const match = data.waterFilter.match(/(\d+)_/);
      if (!match) {
        return 0;
      }
      const usedInMonth = parseInt(match[1], 10);
      if (isNaN(usedInMonth)) {
        return 0;
      }

      return clampPercent((12 - usedInMonth) / 12 * 100);
    }

    return 0;
  }

  public hasFeature(key: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const visibleItem = this.deviceModel.data.Config?.visibleItems?.find((item: any) => item.Feature === key || item.feature === key);
    if (!visibleItem) {
      return false;
    } else if (visibleItem.ControlTitle === undefined && visibleItem.controlTitle === undefined) {
      return false;
    }

    return true;
  }
}