/**
 * Special thank to carlosgamezvillegas (https://github.com/carlosgamezvillegas) for the initial work on the Oven device.
 */
import type { AccessoryContext } from '../baseDevice.js';
import { BaseDevice } from '../baseDevice.js';
import type { LGThinQHomebridgePlatform } from '../platform.js';
import type { Logger, PlatformAccessory, Service } from 'homebridge';
import type { DeviceModel } from '../models/DeviceModel.js';
import type { Device } from '../models/Device.js';
import { normalizeBoolean, normalizeNumber } from '../helper.js';
import {
  ONE_HOUR_IN_SECONDS,
  ONE_SECOND_MS,
  TEN_SECONDS_MS,
  THIRTY_MINUTES_IN_SECONDS,
  TWELVE_HOURS_IN_SECONDS,
  TWO_MINUTES_MS,
} from '../lib/constants.js';
import type { BurnerDefinition, SnapshotData } from './cooking/helpers.js';
import {
  OVEN_TEMP_LIMITS,
  SECONDS_PER_MINUTE,
  burnerStatus,
  capitalize,
  clampCookTemp,
  formatDuration,
  isFahrenheit,
  isNonZeroNumber,
  sumTimeFieldsByPrefix,
  tempCtoF,
  tempFtoC,
  textExcludes,
  textIncludes,
  toCelsius,
  toNumber,
  truncateName,
} from './cooking/helpers.js';
import { CommandGate, CookTimeTracker, UpdatePauser } from './cooking/controls.js';
import {
  createDurationValve,
  createInputSource,
  createModeSwitch,
  createSwitch,
  createTelevision,
  ensureService,
  resetMomentarySwitch,
  sendControlCommand,
  setConfiguredName,
  setVisibility,
  updateIfChanged,
} from './cooking/services.js';

const INPUT_ID_MIN = 1;
const INPUT_ID_MAX = 14;
const DEFAULT_TARGET_TEMP_F = 350;
const MIN_TARGET_TEMP_C = 38;
/** Highest oven temperature exposed to HomeKit (command clamp tops out at 285°C). */
const OVEN_MAX_TEMP_C = 300;
const PROBE_MAX_TEMP_C = 285;
const OVEN_TEMP_STEP = 0.5;
const PROBE_TEMP_STEP = 0.1;
const AMBIENT_TEMP_C = 22;
const AMBIENT_HUMIDITY = 50;
/** HomeKit's minimum CurrentAmbientLightLevel; used to represent "no burner in use". */
const MIN_LUX = 0.0001;
const COOK_TIME_MAX_SECONDS = TWELVE_HOURS_IN_SECONDS - 1;
/** Updates are held back this long after a command so the device can report the new state. */
const COMMAND_SETTLE_MS = TEN_SECONDS_MS;
/** Updates are held back this long while the user is composing a command in HomeKit. */
const USER_EDIT_PAUSE_MS = TWO_MINUTES_MS;

interface OvenCommandList {
  ovenMode: string;
  ovenSetTemperature: number;
  tempUnits: string;
  ovenSetDuration: number;
  probeTemperature: number;
  ovenKeepWarm: 'ENABLE' | 'DISABLE';
}

function defaultOvenCommand(): OvenCommandList {
  return {
    ovenMode: 'NONE',
    ovenSetTemperature: DEFAULT_TARGET_TEMP_F,
    tempUnits: 'FAHRENHEIT',
    ovenSetDuration: THIRTY_MINUTES_IN_SECONDS,
    probeTemperature: 0,
    ovenKeepWarm: 'DISABLE',
  };
}

interface OvenBurner extends BurnerDefinition {
  subtype: string;
  identifier: number;
}

export const OVEN_BURNERS: readonly OvenBurner[] = [
  { index: 1, label: 'Front Left', subtype: 'NicoCataGaTa-Oven001', identifier: 10 },
  { index: 2, label: 'Back Left', subtype: 'NicoCataGaTa-Oven002', identifier: 11 },
  { index: 3, label: 'Center', subtype: 'NicoCataGaTa-Oven003', identifier: 12 },
  { index: 4, label: 'Front Right', subtype: 'NicoCataGaTa-Oven004', identifier: 13 },
  { index: 5, label: 'Back Right', subtype: 'NicoCataGaTa-Oven005', identifier: 14 },
];

interface ModeSwitchDefinition {
  name: string;
  subtype: string;
  /** Cook name sent to the device. */
  mode: string;
  /** Other cook names the device may report for the same mode. */
  aliases?: readonly string[];
}

const OVEN_MODE_SWITCHES: readonly ModeSwitchDefinition[] = [
  { name: 'Bake Mode', subtype: 'CataNicoGaTa-80', mode: 'BAKE' },
  { name: 'Convection Bake Mode', subtype: 'CataNicoGaTa-Control1', mode: 'CONVECTION_BAKE' },
  // The command historically sends 'CONVECTION_ROST'; devices report 'CONVECTION_ROAST'.
  { name: 'Convection Roast Mode', subtype: 'CataNicoGaTa-Control2', mode: 'CONVECTION_ROST', aliases: ['CONVECTION_ROAST'] },
  { name: 'Frozen Meal Mode', subtype: 'CataNicoGaTa-Control3', mode: 'FROZEN_MEAL' },
  { name: 'Air Fry Mode', subtype: 'CataNicoGaTa-Control4', mode: 'AIR_FRY' },
  { name: 'Air Sousvide Mode', subtype: 'CataNicoGaTa-Control5', mode: 'AIR_SOUSVIDE' },
  { name: 'Proof-Warm Mode', subtype: 'CataNicoGaTa-Control5W', mode: 'WARM' },
];

const OVEN_MODE_LABELS: Readonly<Record<string, string>> = {
  NONE: 'None',
  BAKE: 'Bake',
  ROAST: 'Roast',
  CONVECTION_BAKE: 'Convection Bake',
  CONVECTION_ROAST: 'Convection Roast',
  CONVECTION_ROST: 'Convection Roast',
  CRISP_CONVECTION: 'Crisp Convection',
  FAVORITE: 'Favorite',
  BROIL: 'Broil',
  WARM: 'Warm',
  PROOF: 'Proof',
  FROZEN_MEAL: 'Frozen Meal',
  SLOW_COOK: 'Slow Cook',
  PROBE_SET: 'Probe Set',
  EASY_CLEAN: 'Easy Clean',
  SPEED_BROIL: 'Speed Broil',
  SELF_CLEAN: 'Self Clean',
  SPEED_ROAST: 'Speed Roast',
  AIR_FRY: 'Air Fry',
  PIZZA: 'Pizza',
  AIR_SOUSVIDE: 'Air Sousvide',
};

const OVEN_STATE_LABELS: Readonly<Record<string, string>> = {
  PREHEATING: 'Preheating',
  COOKING_IN_PROGRESS: 'Baking',
  DONE: 'Done Baking',
  COOLING: 'Cooling Down',
  CLEANING: 'Cleaning Itself',
  CLEANING_DONE: 'Done Cleaning Itself',
};

function clampTemp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default class Oven extends BaseDevice {
  protected readonly cookTimes = new CookTimeTracker({
    start: 'Oven Start Time Not Set',
    cookTime: 'Oven Cook Time Not Set',
    end: 'Oven End Time Not Set',
    timer: 'Oven Timer Not Set',
  });
  protected inputID = INPUT_ID_MIN;
  protected timerAlarmSec = 0;
  protected ovenCommandList: OvenCommandList = defaultOvenCommand();
  /** True while the user has an unsent selection (mode/temperature/duration...) in HomeKit. */
  protected userSelectionPending = false;
  /** Target temperature (°C) chosen in HomeKit and not yet sent. */
  protected userTargetTemperature: number | undefined;
  protected homekitMonitorOnly = true;
  protected wasOn = false;

  protected readonly pauser = new UpdatePauser(() => this.refreshCharacteristics(), USER_EDIT_PAUSE_MS);
  protected readonly commandGate = new CommandGate(ONE_SECOND_MS);

  /** service */
  protected ovenService: Service;
  protected ovenState: Service;
  protected ovenMode: Service;
  protected ovenTemp: Service;
  protected probeService: Service;
  protected ovenOptions: Service;
  protected ovenStart: Service;
  protected ovenTimer: Service;
  protected ovenTime: Service;
  protected ovenEndTime: Service;
  protected burners: { definition: OvenBurner; service: Service }[];
  protected ovenTimerService: Service;
  protected ovenAlarmService: Service;
  protected modeSwitches: { definition: ModeSwitchDefinition; service: Service }[];
  protected cancelSwitch: Service;
  protected monitorOnlySwitch: Service;
  protected startOvenSwitch: Service;
  protected keepWarmSwitch: Service | undefined;
  protected ovenDoorOpened: Service;
  protected rangeOn: Service;
  protected remoteEnabled: Service;
  protected burnersOnNumber: Service;
  protected ovenTempControl: Service;
  protected probeTempControl: Service;

  constructor(
    platform: LGThinQHomebridgePlatform,
    accessory: PlatformAccessory<AccessoryContext>,
    logger: Logger,
  ) {
    super(platform, accessory, logger);

    const { Characteristic, Service: Services } = this.platform;
    const data = this.Status.data;

    this.ovenService = createTelevision(platform, accessory, this.config.name || accessory.context.device.name,
      'NicoCataGaTa-OvenOven7', 'LG Range');
    this.ovenService.getCharacteristic(Characteristic.Active)
      .onGet(() => this.serviceActive())
      .onSet(async (value) => {
        if (normalizeBoolean(value)) {
          await this.sendOvenCommand();
        } else {
          await this.stopOven();
        }
      });
    this.ovenService.setCharacteristic(Characteristic.ActiveIdentifier, this.inputID);
    this.ovenService.getCharacteristic(Characteristic.ActiveIdentifier)
      .onSet((value) => {
        const vNum = normalizeNumber(value);
        if (vNum === null) {
          this.logger.error('ActiveIdentifier is not a number');
          return;
        }
        this.inputID = vNum > INPUT_ID_MAX || vNum < INPUT_ID_MIN ? INPUT_ID_MIN : vNum;
      })
      .onGet(() => this.inputID);

    const input = (name: string, subtype: string, identifier: number, shown: boolean, getName: () => string) =>
      createInputSource(platform, accessory, this.ovenService, { name, subtype, identifier, shown, getName });
    const ovenOn = this.isOvenOn();
    this.ovenState = input('Oven Status', 'NicoCataGaTa-Oven1003', 1, true, () => this.ovenStatus());
    this.ovenMode = input('Oven Mode', 'NicoCataGaTa-Oven1004', 2, ovenOn, () => this.ovenModeName());
    this.ovenTemp = input('Oven Temperature', 'NicoCataGaTa-Oven1004T', 3, ovenOn, () => this.ovenTemperature());
    this.probeService = input('Probe Status', 'NicoCata-Always15', 4, this.probeStatus().shown, () => this.probeStatus().name);
    this.ovenOptions = input('Oven Options', 'NicoCata-Always4', 5, ovenOn, () => this.ovenOptionsName());
    this.ovenStart = input('Oven Start Time', 'NicoCata-Always1', 6, this.cookTimes.showTime, () => truncateName(this.cookTimes.startString));
    this.ovenTimer = input('Oven Timer Status', 'NicoCata-Always2', 7, this.cookTimes.showTimer, () => truncateName(this.cookTimes.timerString));
    this.ovenTime = input('Oven Cook Time Status', 'NicoCata-Always2T', 8, this.cookTimes.showTime, () => truncateName(this.cookTimes.cookTimeString));
    this.ovenEndTime = input('Oven End Time', 'NicoCata-Always3', 9, this.cookTimes.showTime, () => truncateName(this.cookTimes.endString));
    this.burners = OVEN_BURNERS.map(definition => ({
      definition,
      service: input(definition.label + ' Burner Status', definition.subtype, definition.identifier,
        burnerStatus(data, definition).inUse, () => burnerStatus(this.Status.data, definition).name),
    }));

    //////////Timers
    this.ovenTimerService = createDurationValve(platform, accessory, logger, {
      name: 'Oven Cook Time',
      subtype: 'NicoCataGaTa-OvenT2',
      primary: true,
      maxRemaining: COOK_TIME_MAX_SECONDS,
      remaining: () => this.remainTime(),
      setDuration: () => this.ovenTargetTime(),
      onActiveSet: async (active) => {
        if (active) {
          await this.sendOvenCommand();
          return;
        }
        await this.stopOven();
        this.ovenTimerService.updateCharacteristic(Characteristic.Active, Characteristic.Active.INACTIVE);
        this.ovenTimerService.updateCharacteristic(Characteristic.RemainingDuration, 0);
        this.ovenTimerService.updateCharacteristic(Characteristic.InUse, Characteristic.InUse.NOT_IN_USE);
      },
      onSetDuration: (seconds) => {
        this.logger.debug('Cooking Duration set to: ' + formatDuration(seconds));
        this.ovenCommandList.ovenSetDuration = seconds;
        this.markUserSelection();
      },
    });
    this.ovenAlarmService = createDurationValve(platform, accessory, logger, {
      name: 'Oven Timer',
      subtype: 'NicoCataGaTa-OvenT32',
      maxRemaining: TWELVE_HOURS_IN_SECONDS,
      remaining: () => this.ovenTimerTime(),
      setDuration: () => this.timerAlarmSec,
      onActiveSet: async (active) => {
        const seconds = active ? this.timerAlarmSec : 0;
        await this.sendTimerCommand(seconds);
        if (!active) {
          this.timerAlarmSec = 0;
        }
        this.ovenAlarmService.updateCharacteristic(Characteristic.Active, active ? 1 : 0);
        this.ovenAlarmService.updateCharacteristic(Characteristic.RemainingDuration, seconds);
        this.ovenAlarmService.updateCharacteristic(Characteristic.InUse, active ? 1 : 0);
      },
      onSetDuration: (seconds) => {
        this.timerAlarmSec = Math.min(seconds, TWELVE_HOURS_IN_SECONDS - 1);
      },
    });

    ////////////Buttons
    this.modeSwitches = OVEN_MODE_SWITCHES.map(definition => ({
      definition,
      service: createModeSwitch(platform, accessory, definition.name, definition.subtype,
        () => this.isModeSelected(definition),
        (on) => {
          if (on) {
            this.ovenCommandList.ovenMode = definition.mode;
            this.markUserSelection();
          }
          this.syncModeSwitches();
        }),
    }));

    this.cancelSwitch = createSwitch(platform, accessory, 'Stop Oven', 'CataNicoGaTa-Control6');
    this.cancelSwitch.getCharacteristic(Characteristic.On)
      .onGet(() => false)
      .onSet(async (value) => {
        try {
          if (normalizeBoolean(value)) {
            await this.stopOven();
          }
        } finally {
          resetMomentarySwitch(platform, this.cancelSwitch);
          this.syncModeSwitches();
        }
      });

    this.monitorOnlySwitch = createSwitch(platform, accessory, 'Monitor Only Mode', 'CataNicoGaTa-Control7');
    this.monitorOnlySwitch.getCharacteristic(Characteristic.On)
      .onGet(() => this.isMonitorOnly())
      .onSet((value) => {
        this.homekitMonitorOnly = normalizeBoolean(value);
      });

    this.startOvenSwitch = createSwitch(platform, accessory, 'Start Oven', 'CataNicoGaTa-Control8');
    this.startOvenSwitch.getCharacteristic(Characteristic.On)
      .onGet(() => false)
      .onSet(async (value) => {
        if (!normalizeBoolean(value)) {
          return;
        }
        try {
          await this.sendOvenCommand();
        } finally {
          resetMomentarySwitch(platform, this.startOvenSwitch);
        }
      });

    if (data.upperCookAndWarmStatus !== undefined) {
      this.keepWarmSwitch = createSwitch(platform, accessory, 'Keep Warm', 'CataNicoGaTa-Control9');
      this.keepWarmSwitch.getCharacteristic(Characteristic.On)
        .onGet(() => this.isKeepWarmOn())
        .onSet((value) => {
          this.ovenCommandList.ovenKeepWarm = normalizeBoolean(value) ? 'ENABLE' : 'DISABLE';
          this.markUserSelection();
        });
    }

    ////////Door sensor
    this.ovenDoorOpened = ensureService(accessory, Services.ContactSensor, 'Oven Door', 'NicoCataGaTa-OvenTCBCS');
    setConfiguredName(platform, this.ovenDoorOpened, 'Oven Door');
    this.ovenDoorOpened.setCharacteristic(Characteristic.StatusActive, this.onStatus());
    this.ovenDoorOpened.setCharacteristic(Characteristic.ContactSensorState, this.doorContactState());

    ///Range Cooking
    this.rangeOn = ensureService(accessory, Services.MotionSensor, 'Range is Cooking', 'NicoCataGaTa-OvenTCBCSMotion');
    setConfiguredName(platform, this.rangeOn, 'Range is Cooking');
    this.rangeOn.setCharacteristic(Characteristic.StatusActive, this.onStatus());
    this.rangeOn.setCharacteristic(Characteristic.MotionDetected, this.onStatus());

    ////Remote Enabled
    this.remoteEnabled = ensureService(accessory, Services.ContactSensor, 'Remote Control Enabled', 'NicoCataGaTa-OvenTCRCS');
    setConfiguredName(platform, this.remoteEnabled, 'Remote Control Enabled');
    this.remoteEnabled.setCharacteristic(Characteristic.StatusActive, this.onStatus());
    this.remoteEnabled.setCharacteristic(Characteristic.ContactSensorState, this.remoteContactState());

    /////////Burners On
    this.burnersOnNumber = ensureService(accessory, Services.LightSensor, 'Number of Burners in Use', 'NicoCataGaTa-OvenTCB');
    setConfiguredName(platform, this.burnersOnNumber, 'Number of Burners in Use');
    this.burnersOnNumber.setCharacteristic(Characteristic.CurrentAmbientLightLevel, this.burnerLux());
    this.burnersOnNumber.setCharacteristic(Characteristic.StatusActive, this.burnerCount() > 0);

    ///////Oven Temperature Control
    const heatingValidValues = [Characteristic.TargetHeatingCoolingState.OFF, Characteristic.TargetHeatingCoolingState.HEAT];
    this.ovenTempControl = ensureService(accessory, Services.Thermostat, 'Oven Temperature Control', 'NicoCataGaTa-OvenTC');
    this.ovenTempControl.setCharacteristic(Characteristic.Name, 'Oven Temperature Control');
    this.ovenTempControl.setCharacteristic(Characteristic.CurrentHeatingCoolingState, this.currentHeatingState());
    setConfiguredName(platform, this.ovenTempControl, 'Oven Temperature Control');
    this.ovenTempControl.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({ validValues: heatingValidValues })
      .onGet(() => this.targetHeatingState())
      .onSet(async (value) => {
        if (normalizeBoolean(value)) {
          this.pauser.pause(USER_EDIT_PAUSE_MS);
        } else {
          await this.stopOven();
        }
      });
    this.ovenTempControl.getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({ minValue: 0, maxValue: OVEN_MAX_TEMP_C, minStep: OVEN_TEMP_STEP })
      .onGet(() => this.ovenCurrentTemperature());
    this.ovenTempControl.getCharacteristic(Characteristic.CurrentRelativeHumidity)
      .onGet(() => AMBIENT_HUMIDITY);
    this.ovenTempControl.getCharacteristic(Characteristic.TargetTemperature)
      .setProps({ minValue: MIN_TARGET_TEMP_C, maxValue: OVEN_MAX_TEMP_C, minStep: OVEN_TEMP_STEP })
      .onGet(() => this.ovenTargetTemperature())
      .onSet((value) => {
        const vNum = normalizeNumber(value);
        if (vNum === null) {
          this.logger.error('TargetTemperature is not a number');
          return;
        }
        this.ovenCommandList.ovenSetTemperature = isFahrenheit(this.Status.data.upperCurrentTemperatureUnit) ? tempCtoF(vNum) : Math.round(vNum);
        this.userTargetTemperature = vNum;
        this.markUserSelection();
      });

    this.probeTempControl = ensureService(accessory, Services.Thermostat, 'Probe Temperature Control', 'NicoCataGaTa-OvenTCP2');
    this.probeTempControl.setCharacteristic(Characteristic.Name, 'Probe Temperature Control');
    this.probeTempControl.setCharacteristic(Characteristic.CurrentHeatingCoolingState, this.probeCurrentState());
    setConfiguredName(platform, this.probeTempControl, 'Probe Temperature Control');
    this.probeTempControl.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({ validValues: heatingValidValues })
      .onGet(() => this.probeTargetState())
      .onSet(() => {
        this.pauser.pause(USER_EDIT_PAUSE_MS);
      });
    this.probeTempControl.getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({ minValue: 0, maxValue: PROBE_MAX_TEMP_C, minStep: PROBE_TEMP_STEP })
      .onGet(() => this.probeCurrentTemperature());
    this.probeTempControl.getCharacteristic(Characteristic.CurrentRelativeHumidity)
      .onGet(() => AMBIENT_HUMIDITY);
    this.probeTempControl.getCharacteristic(Characteristic.TargetTemperature)
      .setProps({ minValue: MIN_TARGET_TEMP_C, maxValue: PROBE_MAX_TEMP_C, minStep: PROBE_TEMP_STEP })
      .onGet(() => this.probeTargetTemperature())
      .onSet((value) => {
        const vNum = normalizeNumber(value);
        if (vNum === null) {
          this.logger.error('Probe TargetTemperature is not a valid number');
          return;
        }
        this.ovenCommandList.probeTemperature = isFahrenheit(this.Status.data.upperCurrentTemperatureUnit) ? tempCtoF(vNum) : Math.round(vNum);
        this.markUserSelection();
      });
  }

  public get Status() {
    return this.getStatus(OvenStatus);
  }

  get config() {
    return Object.assign({}, {
      oven_trigger: false,
    }, super.config);
  }

  public destroy(): void {
    this.pauser.dispose();
    this.commandGate.dispose();
    super.destroy();
  }

  /////////////////////////// Commands

  protected markUserSelection(): void {
    this.userSelectionPending = true;
    this.pauser.pause(USER_EDIT_PAUSE_MS);
  }

  protected clearUserSelection(): void {
    this.userSelectionPending = false;
    this.userTargetTemperature = undefined;
  }

  protected sendOvenState(ctrlKey: string, ovenState: Record<string, unknown>): Promise<void> {
    return sendControlCommand(this.platform, this.accessory.context.device, this.logger, ctrlKey, { ovenState });
  }

  async sendTimerCommand(time: number): Promise<void> {
    await this.commandGate.run(async () => {
      this.logger.debug('Alarm Set to: ' + formatDuration(time));
      try {
        await this.sendOvenState('SetTimer', {
          'cmdOptionContentsType': 'TIMER',
          'cmdOptionDataLength': 'TIMER',
          'lowerTimerHour': 128,
          'lowerTimerMinute': 128,
          'lowerTimerSecond': 128,
          'upperTimerHour': Math.floor(time / ONE_HOUR_IN_SECONDS),
          'upperTimerMinute': Math.floor(time % ONE_HOUR_IN_SECONDS / SECONDS_PER_MINUTE),
          'upperTimerSecond': Math.floor(time % SECONDS_PER_MINUTE),
        });
      } finally {
        this.pauser.pause(COMMAND_SETTLE_MS);
      }
    });
  }

  /** Build the cook-start command from the pending selection, applying defaults and per-mode limits. */
  protected prepareOvenCommand(): OvenCommandList {
    const reportedUnit = this.Status.data.upperCurrentTemperatureUnit;
    const unit = typeof reportedUnit === 'string' ? reportedUnit : this.ovenCommandList.tempUnits;
    const command: OvenCommandList = { ...this.ovenCommandList, tempUnits: unit };
    if (command.ovenSetDuration === 0) {
      command.ovenSetDuration = THIRTY_MINUTES_IN_SECONDS;
    }
    if (command.ovenMode === 'NONE') {
      command.ovenMode = 'BAKE';
    }
    if (command.ovenMode.includes('WARM')) {
      return {
        ovenMode: 'WARM',
        ovenSetTemperature: 0,
        tempUnits: isFahrenheit(unit) ? 'FAHRENHEIT' : 'CELSIUS',
        ovenSetDuration: 0,
        probeTemperature: 0,
        ovenKeepWarm: 'DISABLE',
      };
    }
    command.ovenSetTemperature = clampCookTemp(OVEN_TEMP_LIMITS, command.ovenMode, unit, command.ovenSetTemperature);
    return command;
  }

  async sendOvenCommand(): Promise<void> {
    if (this.isMonitorOnly()) {
      this.logger.info(`[${this.accessory.context.device.name}] Monitor Only Mode is on; oven command not sent`);
      return;
    }
    await this.commandGate.run(async () => {
      this.pauser.pause(USER_EDIT_PAUSE_MS);
      try {
        const command = this.prepareOvenCommand();
        this.ovenCommandList = command;
        this.logger.debug('Sending the following commands: ' + JSON.stringify(command));
        await this.sendOvenState('SetCookStart', {
          'cmdOptionContentsType': 'REMOTE_COOK_START',
          'cmdOptionDataLength': 'REMOTE_COOK_START',
          'cmdOptionSetCookAndWarm': command.ovenKeepWarm,
          'cmdOptionSetCookName': command.ovenMode,
          'cmdOptionSetMyRecipeCookNumber': 0,
          'cmdOptionSetSteamLevel': '',
          'cmdOptionSetSubCookNumber': 0,
          'cmdOptionSetTargetTemperatureUnit': command.tempUnits,
          'cmdOptionSetTargetTimeHour': Math.floor(command.ovenSetDuration / ONE_HOUR_IN_SECONDS),
          'cmdOptionSetTargetTimeMinute': Math.floor(command.ovenSetDuration % ONE_HOUR_IN_SECONDS / SECONDS_PER_MINUTE),
          'cmdOptionSetRapidPreheat': 'OFF',
          'setTargetProveTemperature': command.probeTemperature,
          'setTargetTemperature': command.ovenSetTemperature,
        });
        this.clearUserSelection();
      } finally {
        this.pauser.pause(COMMAND_SETTLE_MS);
      }
    });
  }

  async stopOven(): Promise<void> {
    if (this.isMonitorOnly()) {
      this.logger.info(`[${this.accessory.context.device.name}] Monitor Only Mode is on; stop command not sent`);
      return;
    }
    await this.commandGate.run(async () => {
      this.pauser.pause(USER_EDIT_PAUSE_MS);
      try {
        this.logger.debug('Stop Command Sent to Oven');
        await this.sendOvenState('SetCookStop', { 'cmdOptionCookStop': 'UPPER' });
        this.clearUserSelection();
      } finally {
        this.pauser.pause(COMMAND_SETTLE_MS);
      }
    });
  }

  /////////////////////////// State (pure getters)

  isMonitorOnly(): boolean {
    return textIncludes(this.Status.data.upperRemoteStart, 'DIS') || this.homekitMonitorOnly;
  }

  /** The oven cavity is active (state known and not INITIAL). */
  isOvenOn(): boolean {
    return textExcludes(this.Status.data.upperState, 'INITIAL');
  }

  burnerCount(): number {
    return toNumber(this.Status.data.burnerOnCounter);
  }

  burnerLux(): number {
    const count = this.burnerCount();
    return count < 1 ? MIN_LUX : count;
  }

  /** The range (oven or any burner) is in use. */
  onStatus(): boolean {
    return this.isOvenOn() || this.burnerCount() > 0;
  }

  serviceActive(): 0 | 1 {
    return this.onStatus() ? 1 : 0;
  }

  isKeepWarmOn(): boolean {
    return textExcludes(this.Status.data.upperCookAndWarmStatus, 'DIS');
  }

  /** 0 = contact (door closed), 1 = no contact (door open). */
  doorContactState(): 0 | 1 {
    return textExcludes(this.Status.data.upperDoorOpen, 'DIS') ? 1 : 0;
  }

  /** 1 when remote start is enabled. */
  remoteContactState(): 0 | 1 {
    return textExcludes(this.Status.data.upperRemoteStart, 'DIS') ? 1 : 0;
  }

  isModeSelected(definition: ModeSwitchDefinition): boolean {
    const mode = this.ovenCommandList.ovenMode;
    return mode === definition.mode || (definition.aliases ?? []).includes(mode);
  }

  remainTime(): number {
    return sumTimeFieldsByPrefix(this.Status.data, 'upperRemainTime');
  }

  ovenTargetTime(): number {
    return sumTimeFieldsByPrefix(this.Status.data, 'upperTargetTime');
  }

  ovenTimerTime(): number {
    return sumTimeFieldsByPrefix(this.Status.data, 'upperTimer');
  }

  ovenModeName(): string {
    const data = this.Status.data;
    const cookName = data.upperManualCookName;
    const label = typeof cookName === 'string' ? (OVEN_MODE_LABELS[cookName] ?? capitalize(cookName)) : OVEN_MODE_LABELS.NONE;
    let name = 'Oven Mode: ' + label;
    if (label !== OVEN_MODE_LABELS.NONE) {
      name = this.withSubCookMenu(name);
    }
    if (this.isKeepWarmOn()) {
      name += ' (Keep Warm On)';
    }
    return truncateName(name);
  }

  withSubCookMenu(name: string): string {
    const subCook = this.Status.data.upperSubCookMenu;
    if (typeof subCook === 'string' && subCook !== 'NONE') {
      return name + ' (' + capitalize(subCook) + ')';
    }
    return name;
  }

  ovenStatus(): string {
    const data = this.Status.data;
    const state = data.upperState;
    let status = 'Oven is ';
    if (state === 'INITIAL') {
      status += 'in Standby';
      if (textIncludes(data.upperRemoteStart, 'DIS')) {
        status += ' (Remote Start Disabled)';
      } else if (this.homekitMonitorOnly) {
        status += ' (Homekit Monitor Only Mode)';
      }
    } else if (typeof state === 'string') {
      status += OVEN_STATE_LABELS[state] ?? capitalize(state);
    } else {
      status += 'Unknown';
    }
    if (textExcludes(data.commonControlLock, 'DIS')) {
      status += ' - Controls Locked';
    }
    return truncateName(status);
  }

  ovenTemperature(): string {
    const data = this.Status.data;
    let temperature = 'Oven Temperature Information';
    if (isNonZeroNumber(data.upperCurrentTemperatureValue)) {
      temperature = 'Current Temp is ' + data.upperCurrentTemperatureValue + '°';
    }
    if (isNonZeroNumber(data.upperTargetTemperatureValue)) {
      temperature += ' With Set Temp ' + data.upperTargetTemperatureValue + '°';
    }
    return truncateName(temperature);
  }

  ovenCurrentTemperature(): number {
    const data = this.Status.data;
    const unit = data.upperCurrentTemperatureUnit;
    if (isNonZeroNumber(data.upperCurrentTemperatureValue)) {
      return clampTemp(toCelsius(data.upperCurrentTemperatureValue, unit), 0, OVEN_MAX_TEMP_C);
    }
    if (isNonZeroNumber(data.upperTargetTemperatureValue)) {
      return clampTemp(toCelsius(data.upperTargetTemperatureValue, unit), 0, OVEN_MAX_TEMP_C);
    }
    return AMBIENT_TEMP_C;
  }

  ovenTargetTemperature(): number {
    if (this.userTargetTemperature !== undefined) {
      return clampTemp(this.userTargetTemperature, MIN_TARGET_TEMP_C, OVEN_MAX_TEMP_C);
    }
    const data = this.Status.data;
    if (isNonZeroNumber(data.upperTargetTemperatureValue)) {
      return clampTemp(toCelsius(data.upperTargetTemperatureValue, data.upperCurrentTemperatureUnit), MIN_TARGET_TEMP_C, OVEN_MAX_TEMP_C);
    }
    return MIN_TARGET_TEMP_C;
  }

  probeCurrentTemperature(): number {
    const current = this.Status.data.upperCurrentProveTemperatureF;
    return isNonZeroNumber(current) ? clampTemp(tempFtoC(current), 0, PROBE_MAX_TEMP_C) : AMBIENT_TEMP_C;
  }

  probeTargetTemperature(): number {
    const target = this.Status.data.upperTargetProveTemperatureF;
    return isNonZeroNumber(target) ? clampTemp(tempFtoC(target), MIN_TARGET_TEMP_C, PROBE_MAX_TEMP_C) : MIN_TARGET_TEMP_C;
  }

  probeStatus(): { name: string; shown: boolean } {
    const data = this.Status.data;
    const current = data.upperCurrentProveTemperatureF;
    const target = data.upperTargetProveTemperatureF;
    if (!isNonZeroNumber(current)) {
      return { name: 'Probe Settings Not Available', shown: false };
    }
    const fahrenheit = isFahrenheit(data.upperCurrentTemperatureUnit);
    const display = (value: number) => (fahrenheit ? value : tempFtoC(value));
    let name = '';
    if (isNonZeroNumber(target)) {
      name += 'Food is ' + Math.round(100 * current / target) + '% Done, ';
    }
    name += 'Current Probe Temp ' + display(current) + '°';
    if (isNonZeroNumber(target)) {
      name += ' With Set Temp ' + display(target) + '°';
    }
    return { name: truncateName(name), shown: true };
  }

  ovenOptionsName(): string {
    const data = this.Status.data;
    let options = 'Settings: ' + (isFahrenheit(data.upperCurrentTemperatureUnit) ? 'Temp in °F' : 'Temp in °C');
    if (textExcludes(data.upperSabbath, 'DIS')) {
      options += ', Sabbath On';
    }
    if (textIncludes(data.settingConvAutoConversion, 'ENA')) {
      options += ', Auto Conversion';
    }
    if (textIncludes(data.settingPreheatAlarm, 'ON')) {
      options += ', Preheat Alarm';
    }
    return truncateName(options);
  }

  probeCurrentState(): 0 | 1 {
    return isNonZeroNumber(this.Status.data.upperCurrentProveTemperatureF) ? 1 : 0;
  }

  probeTargetState(): 0 | 1 {
    return isNonZeroNumber(this.Status.data.upperTargetProveTemperatureF) ? 1 : 0;
  }

  currentHeatingState(): 0 | 1 {
    return isNonZeroNumber(this.Status.data.upperCurrentTemperatureValue) ? 1 : 0;
  }

  targetHeatingState(): 0 | 1 {
    return isNonZeroNumber(this.Status.data.upperTargetTemperatureValue) ? 1 : 0;
  }

  /////////////////////////// Updates

  syncModeSwitches(): void {
    for (const { definition, service } of this.modeSwitches) {
      updateIfChanged(service, this.platform.Characteristic.On, this.isModeSelected(definition));
    }
  }

  /**
   * Keep the pending command list in sync with the device. While the user has an unsent selection
   * it is left untouched; otherwise it mirrors the running cook, or resets to defaults when idle.
   */
  protected syncCommandList(ovenOn: boolean): void {
    if (ovenOn && !this.wasOn) {
      // Cooking started (from HomeKit or the panel): any pending selection has been consumed.
      this.clearUserSelection();
    }
    this.wasOn = ovenOn;
    if (!this.userSelectionPending) {
      const data = this.Status.data;
      if (ovenOn) {
        const unit = data.upperCurrentTemperatureUnit;
        this.ovenCommandList = {
          ovenMode: typeof data.upperManualCookName === 'string' ? data.upperManualCookName : 'NONE',
          ovenSetTemperature: toNumber(data.upperTargetTemperatureValue),
          tempUnits: typeof unit === 'string' ? unit : this.ovenCommandList.tempUnits,
          ovenSetDuration: this.ovenTargetTime(),
          probeTemperature: toNumber(data.upperTargetProveTemperatureF),
          ovenKeepWarm: this.isKeepWarmOn() ? 'ENABLE' : 'DISABLE',
        };
      } else {
        this.ovenCommandList = defaultOvenCommand();
      }
    }
    this.syncModeSwitches();
  }

  updateAccessoryCharacteristic(device: Device) {
    super.updateAccessoryCharacteristic(device);
    if (this.pauser.isPaused) {
      // Replayed by the pauser once the pause ends.
      this.pauser.markPending();
      return;
    }
    this.refreshCharacteristics();
  }

  protected refreshCharacteristics(): void {
    const { Characteristic } = this.platform;
    const data: SnapshotData = this.Status.data;
    const ovenOn = this.isOvenOn();
    const rangeOn = this.onStatus();
    const targetTime = this.ovenTargetTime();
    const timerTime = this.ovenTimerTime();
    const remaining = this.remainTime();

    updateIfChanged(this.ovenService, Characteristic.Active, rangeOn ? 1 : 0);
    this.syncCommandList(ovenOn);
    this.cookTimes.update(textExcludes(this.Status.data.upperManualCookName, 'NONE'), targetTime, timerTime);

    /////////// Names
    const probe = this.probeStatus();
    updateIfChanged(this.ovenState, Characteristic.ConfiguredName, this.ovenStatus());
    updateIfChanged(this.ovenMode, Characteristic.ConfiguredName, this.ovenModeName());
    updateIfChanged(this.probeService, Characteristic.ConfiguredName, probe.name);
    updateIfChanged(this.ovenTemp, Characteristic.ConfiguredName, this.ovenTemperature());
    updateIfChanged(this.ovenStart, Characteristic.ConfiguredName, truncateName(this.cookTimes.startString));
    updateIfChanged(this.ovenTimer, Characteristic.ConfiguredName, truncateName(this.cookTimes.timerString));
    updateIfChanged(this.ovenTime, Characteristic.ConfiguredName, truncateName(this.cookTimes.cookTimeString));
    updateIfChanged(this.ovenEndTime, Characteristic.ConfiguredName, truncateName(this.cookTimes.endString));
    updateIfChanged(this.ovenOptions, Characteristic.ConfiguredName, this.ovenOptionsName());
    for (const { definition, service } of this.burners) {
      const status = burnerStatus(data, definition);
      updateIfChanged(service, Characteristic.ConfiguredName, status.name);
      setVisibility(this.platform, service, status.inUse);
    }

    /////////// Visibility
    setVisibility(this.platform, this.ovenMode, ovenOn);
    setVisibility(this.platform, this.ovenTemp, ovenOn);
    setVisibility(this.platform, this.probeService, probe.shown);
    setVisibility(this.platform, this.ovenOptions, ovenOn);
    setVisibility(this.platform, this.ovenStart, this.cookTimes.showTime);
    setVisibility(this.platform, this.ovenTime, this.cookTimes.showTime);
    setVisibility(this.platform, this.ovenEndTime, this.cookTimes.showTime);
    setVisibility(this.platform, this.ovenTimer, this.cookTimes.showTimer);

    /////////// Temperature
    const displayUnits = isFahrenheit(data.upperCurrentTemperatureUnit)
      ? Characteristic.TemperatureDisplayUnits.FAHRENHEIT
      : Characteristic.TemperatureDisplayUnits.CELSIUS;
    updateIfChanged(this.ovenTempControl, Characteristic.TemperatureDisplayUnits, displayUnits);
    updateIfChanged(this.probeTempControl, Characteristic.TemperatureDisplayUnits, displayUnits);
    updateIfChanged(this.ovenTempControl, Characteristic.CurrentTemperature, this.ovenCurrentTemperature());
    if (isNonZeroNumber(data.upperTargetTemperatureValue) || this.userTargetTemperature !== undefined) {
      updateIfChanged(this.ovenTempControl, Characteristic.TargetTemperature, this.ovenTargetTemperature());
    }
    updateIfChanged(this.ovenTempControl, Characteristic.TargetHeatingCoolingState, this.targetHeatingState());
    updateIfChanged(this.ovenTempControl, Characteristic.CurrentHeatingCoolingState, this.currentHeatingState());
    updateIfChanged(this.ovenTempControl, Characteristic.CurrentRelativeHumidity, AMBIENT_HUMIDITY);
    updateIfChanged(this.probeTempControl, Characteristic.CurrentRelativeHumidity, AMBIENT_HUMIDITY);
    if (isNonZeroNumber(data.upperCurrentProveTemperatureF)) {
      updateIfChanged(this.probeTempControl, Characteristic.CurrentTemperature, this.probeCurrentTemperature());
    }
    if (isNonZeroNumber(data.upperTargetProveTemperatureF)) {
      updateIfChanged(this.probeTempControl, Characteristic.TargetTemperature, this.probeTargetTemperature());
    }
    updateIfChanged(this.probeTempControl, Characteristic.TargetHeatingCoolingState, this.probeTargetState());
    updateIfChanged(this.probeTempControl, Characteristic.CurrentHeatingCoolingState, this.probeCurrentState());

    /////////// Cook timer
    updateIfChanged(this.ovenTimerService, Characteristic.Active, remaining > 0 ? 1 : 0);
    if (targetTime === 0) {
      updateIfChanged(this.ovenTimerService, Characteristic.InUse, Characteristic.InUse.NOT_IN_USE);
    } else if (ovenOn) {
      updateIfChanged(this.ovenTimerService, Characteristic.InUse, Characteristic.InUse.IN_USE);
    }
    updateIfChanged(this.ovenTimerService, Characteristic.RemainingDuration, remaining);
    if (!this.userSelectionPending) {
      updateIfChanged(this.ovenTimerService, Characteristic.SetDuration, targetTime);
    }

    /////////// Switches & sensors
    updateIfChanged(this.monitorOnlySwitch, Characteristic.On, this.isMonitorOnly());
    updateIfChanged(this.ovenDoorOpened, Characteristic.StatusActive, rangeOn);
    updateIfChanged(this.ovenDoorOpened, Characteristic.ContactSensorState, this.doorContactState());
    updateIfChanged(this.rangeOn, Characteristic.StatusActive, rangeOn);
    updateIfChanged(this.rangeOn, Characteristic.MotionDetected, rangeOn);
    updateIfChanged(this.remoteEnabled, Characteristic.StatusActive, rangeOn);
    updateIfChanged(this.remoteEnabled, Characteristic.ContactSensorState, this.remoteContactState());
    updateIfChanged(this.burnersOnNumber, Characteristic.CurrentAmbientLightLevel, this.burnerLux());
    updateIfChanged(this.burnersOnNumber, Characteristic.StatusActive, this.burnerCount() > 0);

    /////////// Kitchen timer
    updateIfChanged(this.ovenAlarmService, Characteristic.Active, timerTime > 0 ? 1 : 0);
    updateIfChanged(this.ovenAlarmService, Characteristic.RemainingDuration, timerTime);
    updateIfChanged(this.ovenAlarmService, Characteristic.InUse, timerTime > 0 ? 1 : 0);

    /////////// Keep warm
    if (this.keepWarmSwitch && data.upperCookAndWarmStatus !== undefined) {
      const keepWarm = this.isKeepWarmOn();
      updateIfChanged(this.keepWarmSwitch, Characteristic.On, keepWarm);
      if (!this.userSelectionPending) {
        this.ovenCommandList.ovenKeepWarm = keepWarm ? 'ENABLE' : 'DISABLE';
      }
    }
  }
}

export class OvenStatus {
  constructor(protected readonly raw: SnapshotData | undefined, protected readonly deviceModel: DeviceModel) { }

  /** Snapshot data; always an object (empty when the device has not reported yet). */
  public get data(): SnapshotData {
    return this.raw ?? {};
  }
}
