import type { AccessoryContext, DeviceControlPayload } from '../baseDevice.js';
import { BaseDevice } from '../baseDevice.js';
import type { LGThinQHomebridgePlatform } from '../platform.js';
import type { Characteristic as CharacteristicClass, CharacteristicValue, Logger, PlatformAccessory, Service } from 'homebridge';
import type { Device } from '../models/Device.js';
import { normalizeBoolean, normalizeNumber, safeParseInt } from '../helper.js';
import {
  AC_MODEL_FEATURES,
  ONE_MINUTE_MS,
  HUNDRED_MS,
  HOMEKIT_TEMP_MIN,
  HOMEKIT_TEMP_MAX,
  UNDEFINED_OP_MODE,
  HUMIDITY_MAX,
  SWING_MODE_ON,
  SWING_MODE_OFF,
  AC_MONITOR_TIMEOUT_VALUE,
} from '../lib/constants.js';
import type { Config } from '../status/ACStatus.js';
import { ACStatus, FAN_SPEED_AUTO, FanSpeed, OpMode, percentToWindStrength } from '../status/ACStatus.js';

// Re-exported for backwards compatibility (these used to live in this module)
export {
  ACModelType,
  ACStatus,
  AC_FAN_SPEEDS,
  FAN_SPEED_AUTO,
  FanSpeed,
  OpMode,
  percentToWindStrength,
  windStrengthToPercent,
} from '../status/ACStatus.js';
export type { Config } from '../status/ACStatus.js';

/**
 * Descriptor for a simple on/off mode switch backed by a single flat snapshot key.
 */
interface ModeSwitch {
  dataKey: string;
  label: string;
  /** Only allowed when the unit is powered on and in COOL mode */
  requireCool: boolean;
  service: () => Service | undefined;
  enabled: () => boolean;
}

/**
 * Represents an LG ThinQ Air Conditioner device.
 */
export default class AirConditioner extends BaseDevice {
  protected service: Service;
  protected serviceAirQuality: Service | undefined;
  protected serviceSensor: Service | undefined;
  protected serviceHumiditySensor: Service | undefined;
  protected serviceLight: Service | undefined;
  protected serviceFanV2: Service | undefined;

  // more feature
  protected serviceJetMode: Service | undefined; // jet mode
  protected serviceQuietMode: Service | undefined;
  protected serviceEnergySaveMode: Service | undefined;
  protected serviceAirClean: Service | undefined;
  /** @deprecated Use AC_MODEL_FEATURES from lib/constants.js instead */
  protected jetModeModels = AC_MODEL_FEATURES.jetMode;
  /** @deprecated Use AC_MODEL_FEATURES from lib/constants.js instead */
  protected quietModeModels = AC_MODEL_FEATURES.quietMode;
  /** @deprecated Use AC_MODEL_FEATURES from lib/constants.js instead */
  protected energySaveModeModels = AC_MODEL_FEATURES.energySaveMode;
  /** @deprecated Use hasModelFeature('airClean', model) instead */
  protected airCleanModels = AC_MODEL_FEATURES.airClean;
  protected currentTargetState = 2; // default target: COOL

  protected serviceLabelButtons: Service | undefined;
  protected monitorInterval: ReturnType<typeof setInterval> | undefined;

  /** Cached status; invalidated whenever the snapshot changes */
  private _status: ACStatus | undefined;
  private _statusSnapshot: unknown;

  constructor(
    platform: LGThinQHomebridgePlatform,
    accessory: PlatformAccessory<AccessoryContext>,
    logger: Logger,
  ) {
    super(platform, accessory, logger);

    const device: Device = this.accessory.context.device;

    const {
      Service: {
        TemperatureSensor,
        HumiditySensor,
        Switch,
        Lightbulb,
        HeaterCooler,
        AirQualitySensor,
        Fanv2,
      },
    } = this.platform;
    this.service = this.getOrCreateService(HeaterCooler, device.name);

    this.createHeaterCoolerService();
    this.service.addOptionalCharacteristic(this.platform.customCharacteristics.TotalConsumption);

    const enableAirQuality = !!this.config.ac_air_quality && !!this.Status.airQuality;
    if (enableAirQuality) {
      this.createAirQualityService();
    } else {
      // remove a previously cached service
      this.ensureService(AirQualitySensor, 'Air Quality', false, 'Air Quality');
      this.serviceAirQuality = undefined;
    }

    this.serviceSensor = this.ensureService(TemperatureSensor, 'Temperature Sensor', this.config.ac_temperature_sensor as boolean);
    if (this.serviceSensor) {
      this.serviceSensor.updateCharacteristic(platform.Characteristic.StatusActive, false);
      this.serviceSensor.addLinkedService(this.service);
    }

    this.serviceHumiditySensor = this.ensureService(HumiditySensor, 'Humidity Sensor', this.config.ac_humidity_sensor as boolean);
    if (this.serviceHumiditySensor) {
      this.serviceHumiditySensor.updateCharacteristic(platform.Characteristic.StatusActive, false);
      this.serviceHumiditySensor.addLinkedService(this.service);
    }

    this.serviceLight = this.ensureService(Lightbulb, 'Light', this.config.ac_led_control as boolean);
    if (this.serviceLight) {
      this.serviceLight.getCharacteristic(platform.Characteristic.On)
        .onSet(this.setLight.bind(this))
        .updateValue(false); // off as default
      this.serviceLight.addLinkedService(this.service);
    }

    if (this.config.ac_fan_control as boolean) {
      this.createFanService();
    } else {
      // remove a previously cached fan service
      this.ensureService(Fanv2, device.name + ' Fan', false, device.name + ' Fan');
      this.serviceFanV2 = undefined;
    }

    // more feature
    const enableJetMode = this.config.ac_jet_control as boolean && this.isJetModeEnabled(device.model);
    this.serviceJetMode = this.ensureService(Switch, 'Jet Mode', enableJetMode, 'Jet Mode');
    if (this.serviceJetMode) {
      this.serviceJetMode.addOptionalCharacteristic(platform.Characteristic.ConfiguredName);
      this.serviceJetMode.setCharacteristic(platform.Characteristic.ConfiguredName, device.name + ' Jet Mode');
      this.serviceJetMode.getCharacteristic(platform.Characteristic.On)
        .onSet(this.setJetModeActive.bind(this));
    }

    this.serviceQuietMode = this.ensureService(Switch, 'Quiet mode', this.quietModeModels.includes(device.model), 'Quiet mode');
    if (this.serviceQuietMode) {
      this.serviceQuietMode.updateCharacteristic(platform.Characteristic.Name, 'Quiet mode');
      this.serviceQuietMode.getCharacteristic(platform.Characteristic.On)
        .onSet(this.setQuietModeActive.bind(this));
    }

    const enableEnergySave = this.energySaveModeModels.includes(device.model) && this.config.ac_energy_save as boolean;
    this.serviceEnergySaveMode = this.ensureService(Switch, 'Energy save', enableEnergySave, 'Energy save');
    if (this.serviceEnergySaveMode) {
      this.serviceEnergySaveMode.addOptionalCharacteristic(platform.Characteristic.ConfiguredName);
      this.serviceEnergySaveMode.setCharacteristic(platform.Characteristic.ConfiguredName, device.name + ' Energy save');
      this.serviceEnergySaveMode.getCharacteristic(platform.Characteristic.On)
        .onSet(this.setEnergySaveActive.bind(this));
    }

    const enableAirClean = this.hasModelFeature('airClean') && this.config.ac_air_clean as boolean;
    this.serviceAirClean = this.ensureService(Switch, 'Air Purify', enableAirClean, 'Air Purify');
    if (this.serviceAirClean) {
      this.serviceAirClean.addOptionalCharacteristic(platform.Characteristic.ConfiguredName);
      this.serviceAirClean.setCharacteristic(platform.Characteristic.ConfiguredName, device.name + ' Air Purify');
      this.serviceAirClean.getCharacteristic(platform.Characteristic.On)
        .onSet(this.setAirCleanActive.bind(this));
    }

    this.setupButton(device);

    this.startMonitor();
  }

  /**
   * Send `airState.mon.timeout` every minute so the unit keeps pushing temperature updates.
   * https://github.com/mp-consulting/homebridge-lg-thinq/issues/177
   * Idempotent: an existing interval is cleared before a new one is created.
   */
  protected startMonitor() {
    this.stopMonitor();

    const device: Device = this.accessory.context.device;
    // Skip for models that don't support the monitor timeout command
    const supportsMonitorTimeout = !AC_MODEL_FEATURES.noMonitorTimeout.some(m => device.model.includes(m));
    if (!supportsMonitorTimeout) {
      return;
    }

    this.monitorInterval = setInterval(async () => {
      const current: Device = this.accessory.context.device;
      // LG's API rejects airState.mon.timeout with HTTP 400 / resultCode 9006
      // when the unit is powered off, so skip rather than spamming the log.
      // https://github.com/mp-consulting/homebridge-lg-thinq/issues/8
      if (current.online && this.Status.isPowerOn) {
        try {
          await this.platform.ThinQ?.deviceControl(current.id, {
            dataKey: 'airState.mon.timeout',
            dataValue: AC_MONITOR_TIMEOUT_VALUE,
          }, 'Set', 'allEventEnable', 'control', { quiet: true });
        } catch (error) {
          this.logger.debug('Error sending monitor timeout command:', error);
        }
      }
    }, ONE_MINUTE_MS);
    // don't keep the process alive just for this keep-alive
    this.monitorInterval.unref?.();
  }

  protected stopMonitor() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }
  }

  public destroy(): void {
    this.stopMonitor();
    super.destroy();
  }

  protected createFanService() {
    const {
      Service: {
        Fanv2,
      },
      Characteristic,
    } = this.platform;

    const device: Device = this.accessory.context.device;

    // fan controller
    this.serviceFanV2 = this.getOrCreateService(Fanv2, device.name + ' Fan');
    this.serviceFanV2.addLinkedService(this.service);

    this.serviceFanV2.getCharacteristic(Characteristic.Active)
      .onGet(() => {
        return this.Status.isPowerOn ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
      })
      .onSet((value: CharacteristicValue) => {
        const isOn = normalizeBoolean(value);
        if (this.Status.isPowerOn === isOn) {
          return;
        }

        // do not allow change status via home app, revert to prev status in 0.1s
        setTimeout(() => {
          this.serviceFanV2?.updateCharacteristic(Characteristic.Active, this.Status.isPowerOn ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
          this.serviceFanV2?.updateCharacteristic(Characteristic.RotationSpeed, this.Status.windStrength);
        }, HUNDRED_MS);
      })
      .updateValue(Characteristic.Active.INACTIVE);

    this.serviceFanV2.addOptionalCharacteristic(Characteristic.ConfiguredName);
    this.serviceFanV2.setCharacteristic(Characteristic.ConfiguredName, device.name + ' Fan');
    this.serviceFanV2.getCharacteristic(Characteristic.CurrentFanState)
      .onGet(() => {
        return this.Status.isPowerOn ? Characteristic.CurrentFanState.BLOWING_AIR : Characteristic.CurrentFanState.INACTIVE;
      })
      .setProps({
        validValues: [Characteristic.CurrentFanState.INACTIVE, Characteristic.CurrentFanState.BLOWING_AIR],
      })
      .updateValue(Characteristic.CurrentFanState.INACTIVE);
    this.serviceFanV2.getCharacteristic(Characteristic.TargetFanState)
      .onSet(this.setFanState.bind(this));
    this.serviceFanV2.getCharacteristic(Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: HUMIDITY_MAX,
        minStep: 1,
      })
      .onSet(this.setFanSpeed.bind(this));
    this.serviceFanV2.getCharacteristic(Characteristic.SwingMode)
      .onSet(this.setSwingMode.bind(this))
      .updateValue(this.Status.isSwingOn ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED);
  }

  protected createAirQualityService() {
    const {
      Service: {
        AirQualitySensor,
      },
    } = this.platform;

    this.serviceAirQuality = this.getOrCreateService(AirQualitySensor, 'Air Quality');
  }

  protected createHeaterCoolerService() {
    const device: Device = this.accessory.context.device;
    const { Characteristic } = this.platform;
    this.service.setCharacteristic(Characteristic.Name, device.name);
    this.service.getCharacteristic(Characteristic.Active)
      .onSet(this.setActive.bind(this));
    this.service.getCharacteristic(Characteristic.CurrentHeaterCoolerState);

    const validTargetStates: Record<string, number[]> = {
      BOTH: [
        Characteristic.TargetHeaterCoolerState.AUTO,
        Characteristic.TargetHeaterCoolerState.COOL,
        Characteristic.TargetHeaterCoolerState.HEAT,
      ],
      COOLING: [Characteristic.TargetHeaterCoolerState.COOL],
      HEATING: [Characteristic.TargetHeaterCoolerState.HEAT],
    };
    const validValues = validTargetStates[this.config.ac_mode];
    if (validValues) {
      this.service.getCharacteristic(Characteristic.TargetHeaterCoolerState)
        .setProps({ validValues })
        .updateValue(this.config.ac_mode === 'HEATING' ? Characteristic.TargetHeaterCoolerState.HEAT : Characteristic.TargetHeaterCoolerState.COOL);
    }

    this.service.getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .onSet(this.setTargetState.bind(this));

    const status = this.Status;
    if (status.currentTemperature) {
      this.service.updateCharacteristic(Characteristic.CurrentTemperature, status.currentTemperature);
    }

    this.service.getCharacteristic(Characteristic.CurrentTemperature);

    const setTemperatureProps = (char: CharacteristicClass, range: { min: number; max: number; step?: number }) => {
      const minValue = Math.max(HOMEKIT_TEMP_MIN, range.min || HOMEKIT_TEMP_MIN);
      const maxValue = Math.min(HOMEKIT_TEMP_MAX, range.max || HOMEKIT_TEMP_MAX);
      char.setProps({ minValue, maxValue, minStep: range.step || 0.01 });
      const val = char.value as number;
      if (val < minValue || val > maxValue) {
        char.updateValue(Math.max(minValue, Math.min(maxValue, val)));
      }
    };

    const targetHeatTemperature = status.getTemperatureRange(status.getTemperatureRangeForHeating());
    if (targetHeatTemperature) {
      setTemperatureProps(this.service.getCharacteristic(Characteristic.HeatingThresholdTemperature), {
        min: status.convertTemperatureCelsiusFromLGToHomekit(targetHeatTemperature.min),
        max: status.convertTemperatureCelsiusFromLGToHomekit(targetHeatTemperature.max),
        step: targetHeatTemperature.step,
      });
    }

    const targetCoolTemperature = status.getTemperatureRange(status.getTemperatureRangeForCooling());
    if (targetCoolTemperature) {
      setTemperatureProps(this.service.getCharacteristic(Characteristic.CoolingThresholdTemperature), {
        min: status.convertTemperatureCelsiusFromLGToHomekit(targetCoolTemperature.min),
        max: status.convertTemperatureCelsiusFromLGToHomekit(targetCoolTemperature.max),
        step: targetCoolTemperature.step,
      });
    }

    this.service.getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .onSet(this.setTargetTemperature.bind(this));
    this.service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
      .onSet(this.setTargetTemperature.bind(this));

    // Always normalise RotationSpeed props on the HeaterCooler service to 0-100.
    // Older versions of this plugin persisted maxValue=5 in the accessory cache,
    // which would then clash with the 0-100 windStrength values pushed by
    // updateAccessoryFanStateCharacteristics when ac_fan_control=true.
    this.service.getCharacteristic(Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: HUMIDITY_MAX,
        minStep: 1,
      });
    if (!this.config.ac_fan_control) {
      this.service.getCharacteristic(Characteristic.RotationSpeed)
        .onSet(this.setFanSpeed.bind(this));
    }
    this.service.getCharacteristic(Characteristic.SwingMode)
      .onSet(this.setSwingMode.bind(this));
  }

  public get config(): Config {
    return super.config as Config;
  }

  /**
   * Cached status view; rebuilt only when the snapshot changes.
   */
  public get Status(): ACStatus {
    const snapshot = this.accessory.context.device.snapshot;
    if (!this._status || this._statusSnapshot !== snapshot) {
      this._status = new ACStatus(snapshot, this.accessory.context.device, this.config, this.logger);
      this._statusSnapshot = snapshot;
    }
    return this._status;
  }

  protected invalidateACStatus() {
    this._status = undefined;
  }

  /**
   * Write flat `airState.*` values into the snapshot (AC snapshots use flat dotted keys).
   */
  protected setSnapshotValues(values: Record<string, unknown>) {
    const device = this.accessory.context.device;
    if (!device.data.snapshot) {
      device.data.snapshot = {};
    }
    Object.assign(device.data.snapshot, values);
    this.invalidateACStatus();
    this.invalidateStatusCache();
  }

  protected communicationFailure() {
    return new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  /**
   * Send a control command; throws a HomeKit communication failure if it fails or is rejected.
   */
  protected async sendCommand(
    payload: DeviceControlPayload,
    label: string,
    command: 'Set' | 'Operation' = 'Set',
    ctrlKey?: string,
  ): Promise<void> {
    const device: Device = this.accessory.context.device;
    let success: boolean;
    try {
      success = ctrlKey
        ? !!(await this.platform.ThinQ?.deviceControl(device.id, payload, command, ctrlKey))
        : !!(await this.platform.ThinQ?.deviceControl(device.id, payload, command));
    } catch (error) {
      this.logger.error(`[${device.name}] Error setting ${label}:`, error);
      throw this.communicationFailure();
    }

    if (!success) {
      this.logger.warn(`[${device.name}] Device did not accept ${label} command`);
      throw this.communicationFailure();
    }
  }

  /**
   * Table of simple on/off mode switches (jet, quiet, energy save, air clean, light).
   */
  protected get modeSwitches(): Record<string, ModeSwitch> {
    const model = this.accessory.context.device.model;
    return {
      jet: {
        dataKey: 'airState.wMode.jet',
        label: 'jet mode',
        requireCool: true,
        service: () => this.serviceJetMode,
        enabled: () => this.isJetModeEnabled(model),
      },
      quiet: {
        dataKey: 'airState.miscFuncState.silentAWHP',
        label: 'quiet mode',
        requireCool: true,
        service: () => this.serviceQuietMode,
        enabled: () => this.quietModeModels.includes(model),
      },
      energySave: {
        dataKey: 'airState.powerSave.basic',
        label: 'energy save mode',
        requireCool: true,
        service: () => this.serviceEnergySaveMode,
        enabled: () => this.energySaveModeModels.includes(model) && !!this.config.ac_energy_save,
      },
      airClean: {
        dataKey: 'airState.wMode.airClean',
        label: 'air clean mode',
        requireCool: true,
        service: () => this.serviceAirClean,
        enabled: () => this.hasModelFeature('airClean') && !!this.config.ac_air_clean,
      },
      light: {
        dataKey: 'airState.lightingState.displayControl',
        label: 'light',
        requireCool: false,
        service: () => this.serviceLight,
        enabled: () => !!this.config.ac_led_control,
      },
    };
  }

  protected updateModeSwitch(sw: ModeSwitch) {
    const service = sw.service();
    if (service && sw.enabled()) {
      service.updateCharacteristic(this.platform.Characteristic.On, !!this.accessory.context.device.snapshot?.[sw.dataKey]);
    }
  }

  /**
   * Shared setter for on/off mode switches.
   */
  protected async setModeSwitch(sw: ModeSwitch, value: CharacteristicValue) {
    const status = this.Status;
    const allowed = status.isPowerOn && (!sw.requireCool || status.opMode === OpMode.COOL);
    if (!allowed) {
      this.logger.debug(`${sw.label} is not supported in the current state. Power: ${status.isPowerOn}, Mode: ${status.opMode}`);
      // revert the HomeKit toggle to the actual state
      setTimeout(() => this.updateModeSwitch(sw), HUNDRED_MS);
      return;
    }

    const dataValue = normalizeBoolean(value) ? 1 : 0;
    await this.sendCommand({ dataKey: sw.dataKey, dataValue }, sw.label);
    this.setSnapshotValues({ [sw.dataKey]: dataValue });
    this.updateModeSwitch(sw);
  }

  async setEnergySaveActive(value: CharacteristicValue) {
    await this.setModeSwitch(this.modeSwitches.energySave, value);
  }

  async setAirCleanActive(value: CharacteristicValue) {
    await this.setModeSwitch(this.modeSwitches.airClean, value);
  }

  async setQuietModeActive(value: CharacteristicValue) {
    await this.setModeSwitch(this.modeSwitches.quiet, value);
  }

  async setJetModeActive(value: CharacteristicValue) {
    await this.setModeSwitch(this.modeSwitches.jet, value);
  }

  async setLight(value: CharacteristicValue) {
    await this.setModeSwitch(this.modeSwitches.light, value);
  }

  /**
   * Sets the fan state of the air conditioner to either AUTO or MANUAL (high) mode.
   */
  async setFanState(value: CharacteristicValue) {
    if (!this.Status.isPowerOn) {
      this.logger.debug('Power is off, cannot set fan state');
      return;
    }
    const { TargetFanState } = this.platform.Characteristic;
    const vNum = normalizeNumber(value);
    const isAuto = (vNum !== null) ? (vNum === TargetFanState.AUTO) : normalizeBoolean(value);
    const windStrength = isAuto ? FAN_SPEED_AUTO : FanSpeed.HIGH;
    await this.sendCommand({ dataKey: 'airState.windStrength', dataValue: windStrength }, 'fan state');
    this.setSnapshotValues({ 'airState.windStrength': windStrength });
    this.updateAccessoryFanStateCharacteristics();
    this.updateAccessoryFanV2Characteristic();
  }

  /**
   * Updates the accessory characteristics based on the current device state.
   */
  public updateAccessoryCharacteristic(device: Device) {
    this.invalidateACStatus();
    super.updateAccessoryCharacteristic(device);
    this.updateAccessoryActiveCharacteristic();
    this.updateAccessoryCurrentTemperatureCharacteristic();
    this.updateAccessoryStateCharacteristics();
    this.updateAccessoryTemperatureCharacteristics();
    this.updateAccessoryFanStateCharacteristics();
    this.updateAccessoryTotalConsumptionCharacteristic();
    this.updateAccessoryAirQualityCharacteristic();
    this.updateAccessoryTemperatureSensorCharacteristic();
    this.updateAccessoryHumiditySensorCharacteristic();
    this.updateAccessoryFanV2Characteristic();
    for (const sw of Object.values(this.modeSwitches)) {
      this.updateModeSwitch(sw);
    }
  }

  public updateAccessoryActiveCharacteristic() {
    this.service.updateCharacteristic(this.platform.Characteristic.Active,
      this.Status.isPowerOn ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE);
  }

  public updateAccessoryCurrentTemperatureCharacteristic() {
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.Status.currentTemperature);
  }

  /**
   * Synchronise CurrentHeaterCoolerState / TargetHeaterCoolerState with power + opMode.
   * AUTO / undefined modes are resolved by comparing current and target temperature.
   */
  public updateAccessoryStateCharacteristics() {
    const { CurrentHeaterCoolerState, TargetHeaterCoolerState } = this.platform.Characteristic;
    const status = this.Status;
    const setState = (current: number, target: number) => {
      this.service.updateCharacteristic(CurrentHeaterCoolerState, current);
      this.service.updateCharacteristic(TargetHeaterCoolerState, target);
    };

    if (!status.isPowerOn) {
      this.service.updateCharacteristic(CurrentHeaterCoolerState, CurrentHeaterCoolerState.INACTIVE);
    } else if (status.opMode === OpMode.COOL) {
      setState(CurrentHeaterCoolerState.COOLING, TargetHeaterCoolerState.COOL);
    } else if (status.opMode === OpMode.HEAT) {
      setState(CurrentHeaterCoolerState.HEATING, TargetHeaterCoolerState.HEAT);
    } else if ([OpMode.AUTO, UNDEFINED_OP_MODE].includes(status.opMode)) {
      // auto mode, detect based on current & target temperature
      if (status.currentTemperature < status.targetTemperature) {
        setState(CurrentHeaterCoolerState.HEATING, TargetHeaterCoolerState.HEAT);
      } else {
        setState(CurrentHeaterCoolerState.COOLING, TargetHeaterCoolerState.COOL);
      }
    }
  }

  /**
   * Update the threshold temperature matching the current heating/cooling state (clamped to props).
   */
  public updateAccessoryTemperatureCharacteristics() {
    const { Characteristic } = this.platform;
    const temperature = this.Status.targetTemperature;
    const currentState = this.service.getCharacteristic(Characteristic.CurrentHeaterCoolerState).value;

    const update = (charType: typeof Characteristic.HeatingThresholdTemperature) => {
      const char = this.service.getCharacteristic(charType);
      const minValue = (char.props.minValue ?? HOMEKIT_TEMP_MIN);
      const maxValue = (char.props.maxValue ?? HOMEKIT_TEMP_MAX);
      const clampedTemp = Math.max(minValue, Math.min(maxValue, temperature));
      if (char.value !== clampedTemp) {
        this.service.updateCharacteristic(charType, clampedTemp);
      }
    };

    if (currentState === Characteristic.CurrentHeaterCoolerState.HEATING) {
      update(Characteristic.HeatingThresholdTemperature);
    }

    if (currentState === Characteristic.CurrentHeaterCoolerState.COOLING) {
      update(Characteristic.CoolingThresholdTemperature);
    }
  }

  public updateAccessoryFanStateCharacteristics() {
    const { Characteristic } = this.platform;
    this.service.updateCharacteristic(Characteristic.RotationSpeed, this.Status.windStrength);
    this.service.updateCharacteristic(Characteristic.SwingMode,
      this.Status.isSwingOn ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED);
  }

  public updateAccessoryTotalConsumptionCharacteristic() {
    this.service.updateCharacteristic(this.platform.customCharacteristics.TotalConsumption, this.Status.currentConsumption);
  }

  public updateAccessoryAirQualityCharacteristic() {
    const airQuality = this.Status.airQuality;
    if (this.config.ac_air_quality && this.serviceAirQuality && airQuality && airQuality.isOn) {
      this.serviceAirQuality.updateCharacteristic(this.platform.Characteristic.AirQuality, airQuality.overall);
      if (airQuality.PM2) {
        this.serviceAirQuality.updateCharacteristic(this.platform.Characteristic.PM2_5Density, airQuality.PM2);
      }

      if (airQuality.PM10) {
        this.serviceAirQuality.updateCharacteristic(this.platform.Characteristic.PM10Density, airQuality.PM10);
      }
    }
  }

  public updateAccessoryTemperatureSensorCharacteristic() {
    if (this.config.ac_temperature_sensor as boolean && this.serviceSensor) {
      this.serviceSensor.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.Status.currentTemperature);
      this.serviceSensor.updateCharacteristic(this.platform.Characteristic.StatusActive, this.Status.isPowerOn);
    }
  }

  public updateAccessoryHumiditySensorCharacteristic() {
    if (this.config.ac_humidity_sensor as boolean && this.serviceHumiditySensor) {
      this.serviceHumiditySensor.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, this.Status.currentRelativeHumidity);
      this.serviceHumiditySensor.updateCharacteristic(this.platform.Characteristic.StatusActive, this.Status.isPowerOn);
    }
  }

  public updateAccessoryFanV2Characteristic() {
    if (!this.config.ac_fan_control || !this.serviceFanV2) {
      return;
    }
    const { Characteristic } = this.platform;
    const status = this.Status;
    this.serviceFanV2.updateCharacteristic(Characteristic.Active,
      status.isPowerOn ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
    if (status.isWindStrengthAuto) {
      this.serviceFanV2.updateCharacteristic(Characteristic.TargetFanState, Characteristic.TargetFanState.AUTO);
    } else {
      this.serviceFanV2.updateCharacteristic(Characteristic.TargetFanState, Characteristic.TargetFanState.MANUAL);
      this.serviceFanV2.updateCharacteristic(Characteristic.RotationSpeed, status.windStrength);
    }
    this.serviceFanV2.updateCharacteristic(Characteristic.SwingMode,
      status.isSwingOn ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED);
  }

  public updateAccessoryLedControlCharacteristic() {
    this.updateModeSwitch(this.modeSwitches.light);
  }

  public updateAccessoryJetModeCharacteristic() {
    this.updateModeSwitch(this.modeSwitches.jet);
  }

  public updateAccessoryquietModeModelsCharacteristic() {
    this.updateModeSwitch(this.modeSwitches.quiet);
  }

  public updateAccessoryenergySaveModeModelsCharacteristic() {
    this.updateModeSwitch(this.modeSwitches.energySave);
  }

  public updateAccessoryairCleanModelsCharacteristic() {
    this.updateModeSwitch(this.modeSwitches.airClean);
  }

  /**
   * Map HomeKit TargetHeaterCoolerState to the LG opMode and apply it.
   */
  async setTargetState(value: CharacteristicValue) {
    this.logger.debug('Set target AC mode = ', value);
    const vNum = normalizeNumber(value);
    if (vNum === null) {
      return;
    }
    this.currentTargetState = vNum;
    const { TargetHeaterCoolerState } = this.platform.Characteristic;

    const opModeMap: Record<number, OpMode> = {
      [TargetHeaterCoolerState.AUTO]: OpMode.AUTO,
      [TargetHeaterCoolerState.HEAT]: OpMode.HEAT,
      [TargetHeaterCoolerState.COOL]: OpMode.COOL,
    };
    const opMode = opModeMap[vNum] ?? this.Status.opMode;

    if (opMode === this.Status.opMode) {
      return;
    }

    if (!await this.setOpMode(this.accessory.context.device.id, opMode)) {
      throw this.communicationFailure();
    }
    this.setSnapshotValues({ 'airState.opMode': opMode });
  }

  async setActive(value: CharacteristicValue) {
    const isOn = normalizeBoolean(value);
    const isOnNumeric = isOn ? 1 : 0;
    this.logger.debug('Set power on = ', isOnNumeric, ' current status = ', this.Status.isPowerOn);
    if (this.Status.isPowerOn === isOn) {
      this.logger.debug('Power state already matches incoming value; skipping deviceControl.');
      return;
    }
    await this.sendCommand({ dataKey: 'airState.operation', dataValue: isOnNumeric }, 'active state', 'Operation');
    this.setSnapshotValues({ 'airState.operation': isOnNumeric });
    this.updateAccessoryActiveCharacteristic();
  }

  /**
   * Sets the target temperature (HomeKit Celsius → LG device value).
   */
  async setTargetTemperature(value: CharacteristicValue) {
    const status = this.Status;
    if (!status.isPowerOn) {
      this.logger.error('Power is off, cannot set target temperature');
      return;
    }
    const vNum = normalizeNumber(value);
    if (vNum === null) {
      this.logger.error('Invalid temperature value: ', value);
      return;
    }
    const temperatureLG = status.convertTemperatureCelsiusFromHomekitToLG(vNum);
    if (typeof temperatureLG !== 'number' || isNaN(temperatureLG)) {
      this.logger.error('Converted temperature is not a valid number:', temperatureLG);
      return;
    }

    // compare in device units
    if (temperatureLG === status.targetTemperatureLG) {
      this.logger.debug('Target temperature is identical to current setting; skipping.');
      return;
    }

    await this.sendCommand({ dataKey: 'airState.tempState.target', dataValue: temperatureLG }, 'target temperature');
    this.setSnapshotValues({ 'airState.tempState.target': temperatureLG });
    this.updateAccessoryTemperatureCharacteristics();
  }

  /**
   * Sets the fan speed from a HomeKit percentage (0-100).
   */
  async setFanSpeed(value: CharacteristicValue) {
    if (!this.Status.isPowerOn) {
      return;
    }
    const vNum = normalizeNumber(value);
    if (vNum === null) {
      return;
    }
    const windStrength = percentToWindStrength(vNum);
    this.logger.debug('Set fan speed = ', vNum, '% -> windStrength =', windStrength);
    await this.sendCommand({ dataKey: 'airState.windStrength', dataValue: windStrength }, 'fan speed');
    this.setSnapshotValues({ 'airState.windStrength': windStrength });
  }

  async setSwingMode(value: CharacteristicValue) {
    if (!this.Status.isPowerOn) {
      this.logger.debug('Power is off, cannot set swing mode');
      return;
    }

    const swingValue = normalizeBoolean(value) ? SWING_MODE_ON : SWING_MODE_OFF;

    if (this.config.ac_swing_mode === 'BOTH') {
      await this.sendCommand({
        dataKey: null,
        dataValue: null,
        dataSetList: {
          'airState.wDir.vStep': swingValue,
          'airState.wDir.hStep': swingValue,
        },
        dataGetList: null,
      }, 'swing mode', 'Set', 'favoriteCtrl');
      this.setSnapshotValues({ 'airState.wDir.vStep': swingValue, 'airState.wDir.hStep': swingValue });
    } else if (this.config.ac_swing_mode === 'VERTICAL') {
      await this.sendCommand({ dataKey: 'airState.wDir.vStep', dataValue: swingValue }, 'swing mode');
      this.setSnapshotValues({ 'airState.wDir.vStep': swingValue });
    } else if (this.config.ac_swing_mode === 'HORIZONTAL') {
      await this.sendCommand({ dataKey: 'airState.wDir.hStep', dataValue: swingValue }, 'swing mode');
      this.setSnapshotValues({ 'airState.wDir.hStep': swingValue });
    }
    this.updateAccessoryFanStateCharacteristics();
    this.updateAccessoryFanV2Characteristic();
  }

  /**
   * Set the LG operation mode. Returns false (and logs) on failure.
   */
  async setOpMode(deviceId: string, opMode: number): Promise<boolean> {
    try {
      const result = await this.platform.ThinQ?.deviceControl(deviceId, {
        dataKey: 'airState.opMode',
        dataValue: opMode,
      });
      return !!result;
    } catch (error) {
      this.logger.error('Error setting operation mode:', error);
      return false;
    }
  }

  protected isJetModeEnabled(model: string) {
    return this.jetModeModels.includes(model); // cool mode only
  }

  /**
   * (Re)create the op-mode buttons configured in `ac_buttons`.
   * Stale buttons (and the label service when no buttons are configured) are removed.
   */
  public setupButton(device: Device) {
    const existingLabel = this.accessory.getService('Buttons');
    const removeLinkedButtons = (label: Service) => {
      // copy first: removeService() mutates label.linkedServices
      for (const linked of [...label.linkedServices]) {
        this.accessory.removeService(linked);
      }
    };

    const buttons = this.config.ac_buttons || [];
    if (!buttons.length) {
      if (existingLabel) {
        removeLinkedButtons(existingLabel);
        this.accessory.removeService(existingLabel);
      }
      this.serviceLabelButtons = undefined;
      return;
    }

    this.serviceLabelButtons = existingLabel
      || this.accessory.addService(this.platform.Service.ServiceLabel, 'Buttons', 'Buttons');

    // remove all buttons before
    removeLinkedButtons(this.serviceLabelButtons);

    for (const button of buttons) {
      this.setupButtonOpmode(device, button.name, safeParseInt(button.op_mode));
    }
  }

  protected setupButtonOpmode(device: Device, name: string, opMode: number) {
    const {
      Service: {
        Switch,
      },
      Characteristic,
    } = this.platform;

    if (!this.serviceLabelButtons) {
      this.logger.error('ServiceLabelButtons not found cant setup button');
      return;
    }

    const serviceButton = this.accessory.getService(name) || this.accessory.addService(Switch, name, name);
    serviceButton.addOptionalCharacteristic(Characteristic.ConfiguredName);
    serviceButton.setCharacteristic(Characteristic.ConfiguredName, name);
    serviceButton.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => {
        return this.Status.opMode === opMode;
      })
      .onSet((value: CharacteristicValue) => {
        return this.handleButtonOpmode(value, opMode);
      });

    this.serviceLabelButtons.addLinkedService(serviceButton);
  }

  /**
   * Handles an op-mode button: ON switches to `opMode`, OFF restores COOL and the last HomeKit target state.
   * The snapshot is only updated when the device accepted the command.
   */
  async handleButtonOpmode(value: CharacteristicValue, opMode: number) {
    const deviceId = this.accessory.context.device.id;
    if (normalizeBoolean(value)) {
      if (this.Status.opMode !== opMode) {
        if (!await this.setOpMode(deviceId, opMode)) {
          throw this.communicationFailure();
        }
        this.setSnapshotValues({ 'airState.opMode': opMode });
      }
    } else {
      if (!await this.setOpMode(deviceId, OpMode.COOL)) {
        throw this.communicationFailure();
      }
      this.setSnapshotValues({ 'airState.opMode': OpMode.COOL });
      await this.setTargetState(this.currentTargetState);
    }
  }
}
