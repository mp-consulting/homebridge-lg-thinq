/**
 * Special thank to carlosgamezvillegas (https://github.com/carlosgamezvillegas) for the initial work on the Microwave device.
 */
import type { AccessoryContext } from '../baseDevice.js';
import { BaseDevice } from '../baseDevice.js';
import type { Device } from '../models/Device.js';
import type { DeviceModel } from '../models/DeviceModel.js';
import type { LGThinQHomebridgePlatform } from '../platform.js';
import type { Logger, PlatformAccessory, Service } from 'homebridge';
import { normalizeBoolean, normalizeNumber, safeParseInt } from '../helper.js';
import {
  ONE_HOUR_IN_SECONDS,
  ONE_POINT_FIVE_SECONDS_MS,
  ONE_SECOND_MS,
  TEN_SECONDS_MS,
  TWO_MINUTES_MS,
} from '../lib/constants.js';
import type { SnapshotData } from './cooking/helpers.js';
import {
  MICROWAVE_TEMP_LIMITS,
  SECONDS_PER_MINUTE,
  capitalize,
  clampCookTemp,
  delay,
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
const INPUT_ID_MAX = 9;
const VENT_SPEED_MAX = 5;
const LAMP_LEVEL_MAX = 2;
/** Vent/lamp level used when the Television service is switched on. */
const DEFAULT_VENT_LAMP_LEVEL = 2;
/** The device reports power as 1-10; HomeKit brightness is 0-100 in steps of 10. */
const POWER_LEVEL_TO_PERCENT = 10;
const POWER_PERCENT_MAX = 100;
const DEFAULT_COOK_SECONDS = 300;
const COOK_TIME_MAX_SECONDS = 9 * ONE_HOUR_IN_SECONDS;
const TIMER_MAX_SECONDS = 100 * SECONDS_PER_MINUTE - 1;
const MIN_CURRENT_TEMP_C = 10;
const MIN_TARGET_TEMP_C = 38;
const MAX_TEMP_C = 233;
const TEMP_STEP = 0.5;
/** Microwave target temperatures are set in 5° increments. */
const TARGET_TEMP_INCREMENT = 5;
const AMBIENT_TEMP_C = 22;
const AMBIENT_HUMIDITY = 50;
const COMMAND_SETTLE_MS = TEN_SECONDS_MS;
const USER_EDIT_PAUSE_MS = TWO_MINUTES_MS;
/** Wait after stopping a cook before switching off the vent/lamp. */
const STOP_SETTLE_MS = ONE_POINT_FIVE_SECONDS_MS;

interface MicrowaveCommandList {
  ovenMode: string;
  ovenSetTemperature: number;
  tempUnits: string;
  ovenSetDuration: number;
  subCookNumber: number;
  weightUnits: string;
  microwavePower: string;
  targetWeight: number;
}

function defaultMicrowaveCommand(tempUnits: string): MicrowaveCommandList {
  return {
    ovenMode: 'NONE',
    ovenSetTemperature: 0,
    tempUnits,
    ovenSetDuration: 0,
    subCookNumber: 0,
    weightUnits: 'KG',
    microwavePower: '100',
    targetWeight: 0,
  };
}

interface ModeSwitchDefinition {
  name: string;
  subtype: string;
  mode: string;
}

const MICROWAVE_MODE_SWITCHES: readonly ModeSwitchDefinition[] = [
  { name: 'Microwave Mode', subtype: 'CataNicoGaTa-80M', mode: 'MICROWAVE' },
  { name: 'Combination Bake Mode', subtype: 'CataNicoGaTa-80B', mode: 'COMBI_BAKE' },
  { name: 'Dehydrate Mode', subtype: 'CataNicoGaTa-80d', mode: 'DEHYDRATE' },
  { name: 'Oven Mode', subtype: 'CataNicoGaTa-80OVen', mode: 'OVEN' },
  { name: 'Convection Bake Mode', subtype: 'CataNicoGaTa-Control1', mode: 'CONV_BAKE' },
  { name: 'Combination Roast Mode', subtype: 'CataNicoGaTa-Control2', mode: 'COMBI_ROAST' },
  { name: 'Time Defrost Mode', subtype: 'CataNicoGaTa-Control3', mode: 'TIME_DEFROST' },
  { name: 'Defrost Mode', subtype: 'CataNicoGaTa-Control3D', mode: 'INVERTER_DEFROST' },
  { name: 'Air Fry Mode', subtype: 'CataNicoGaTa-Control4', mode: 'AIRFRY' },
  { name: 'Proof Mode', subtype: 'CataNicoGaTa-Control5', mode: 'PROOF' },
  { name: 'Warm Mode (High)', subtype: 'CataNicoGaTa-Control5W', mode: 'WARM' },
];

const MICROWAVE_MODE_LABELS: Readonly<Record<string, string>> = {
  STANDBY: 'Standby',
  MICROWAVE: 'Microwave',
  GRILL: 'Grill',
  OVEN: 'Oven',
  COMBI: 'Combination',
  COMBI_BAKE: 'Combination Bake',
  COMBI_ROAST: 'Combination Roast',
  INVERTER_DEFROST: 'Inverter Defrost',
  AUTO_COOK: 'Air Fry',
  AIRFRY: 'Air Fry',
  WARM: 'Warm',
  CONV_BAKE: 'Convection Bake',
  BROIL: 'Broil',
  DEHYDRATE: 'Dehydrate',
  SPEED_CONV: 'Speed Convection',
  SPEED_ROAST: 'Speed Roast',
  SPEED_BROIL: 'Speed Broil',
  PROOF: 'Proof',
  SENSOR_COOK: 'Sensor Cook',
  TIME_DEFROST: 'Timed Defrost',
};

const MICROWAVE_STATE_LABELS: Readonly<Record<string, string>> = {
  INITIAL: 'in Standby',
  PREHEATING: 'Preheating',
  COOKING_IN_PROGRESS: 'Cooking',
  DONE: 'Done Baking',
  COOLING: 'Cooling Down',
  CLEANING: 'Cleaning Itself',
  CLEANING_DONE: 'Done Cleaning Itself',
  PAUSED: 'Paused',
  PREFERENCE: 'Preference',
  ERROR: 'Not Working',
  READY_TO_START: 'Ready To Start',
  PREHEATING_IS_DONE: 'Done Preheating',
};

/** Sub-cook programs: display label and default temperature (°F). */
const SUB_COOK_PROGRAMS: Readonly<Record<number, { label: string; defaultTempF: number }>> = {
  3335: { label: 'Buffalo Wings', defaultTempF: 450 },
  3212: { label: 'Chicken Nuggets', defaultTempF: 450 },
  3227: { label: 'Chicken Tenders', defaultTempF: 450 },
  3339: { label: 'Fish Sticks', defaultTempF: 450 },
  3253: { label: 'French Fries', defaultTempF: 450 },
  3345: { label: 'Hash Brown Patties', defaultTempF: 450 },
  3336: { label: 'Mozzarella Sticks', defaultTempF: 450 },
  3343: { label: 'Popcorn Shrimp', defaultTempF: 450 },
  3225: { label: 'Potato Wedges', defaultTempF: 450 },
  211: { label: 'Meat', defaultTempF: 350 },
  212: { label: 'Poultry', defaultTempF: 425 },
  213: { label: 'Fish', defaultTempF: 400 },
  214: { label: 'Bread', defaultTempF: 400 },
};
const OTHER_SUB_COOK = { label: 'Other Food', defaultTempF: 450 };

const BAKE_OR_OVEN_MODES = ['COMBI_BAKE', 'CONV_BAKE', 'COMBI_ROAST', 'OVEN'];

function clampTemp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default class Microwave extends BaseDevice {
  protected inputID = INPUT_ID_MIN;
  protected timerAlarmSec = 0;
  protected ventSpeed = 0;
  protected lampLevel = 0;
  protected mwPower = 50;
  protected ovenCommandList: MicrowaveCommandList;
  protected userSelectionPending = false;
  protected userTargetTemperature: number | undefined;
  protected wasCooking = false;
  protected readonly cookTimes = new CookTimeTracker({
    start: 'Microwave Start Time Not Set',
    cookTime: 'Microwave Cook Time Not Set',
    end: 'Microwave End Time Not Set',
    timer: 'Microwave Cook Timer Not Set',
  });

  protected readonly pauser = new UpdatePauser(() => this.refreshCharacteristics(), USER_EDIT_PAUSE_MS);
  protected readonly commandGate = new CommandGate(ONE_SECOND_MS);

  /** Service */
  private serviceHood: Service;
  private serviceLight: Service;
  private microwavePower: Service;
  private ovenService: Service;
  private ovenState: Service;
  private lightVent: Service;
  private ovenMode: Service;
  private ovenTemp: Service;
  private ovenOptions: Service;
  private ovenStart: Service;
  private ovenTimer: Service;
  private ovenTime: Service;
  private ovenEndTime: Service;
  private ovenTimerService: Service;
  private ovenAlarmService: Service;
  private modeSwitches: { definition: ModeSwitchDefinition; service: Service }[];
  private cancelSwitch: Service;
  private startOvenSwitch: Service;
  private ovenTempControl: Service;
  private offSwitch: Service;

  constructor(
    platform: LGThinQHomebridgePlatform,
    accessory: PlatformAccessory<AccessoryContext>,
    logger: Logger,
  ) {
    super(platform, accessory, logger);
    const { Characteristic, Service: Services } = this.platform;
    this.ovenCommandList = defaultMicrowaveCommand(this.reportedTempUnit() ?? 'FAHRENHEIT');

    ///////// Vent fan
    this.serviceHood = ensureService(accessory, Services.Fanv2, 'Microwave Fan', 'YourUniqueIdentifier-59F');
    setConfiguredName(platform, this.serviceHood, 'Microwave Fan');
    this.serviceHood.getCharacteristic(Characteristic.Active)
      .onGet(() => (this.ventLevel() > 0 ? 1 : 0))
      .onSet(async (value) => {
        const vNum = normalizeNumber(value);
        if (vNum === null) {
          return;
        }
        this.ventSpeed = vNum;
        if (this.ventSpeed !== this.ventLevel()) {
          await this.sendLightVentCommand();
        }
      });
    this.serviceHood.getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: VENT_SPEED_MAX, minStep: 1 })
      .onGet(() => this.ventLevel())
      .onSet(async (value) => {
        const vNum = normalizeNumber(value);
        if (vNum === null) {
          return;
        }
        this.ventSpeed = vNum;
        await this.sendLightVentCommand();
      });

    ///////// Vent lamp
    this.serviceLight = ensureService(accessory, Services.Lightbulb, 'Microwave Light', 'YourUniqueIdentifier-59L');
    setConfiguredName(platform, this.serviceLight, 'Microwave Light');
    this.serviceLight.getCharacteristic(Characteristic.On)
      .onGet(() => this.lampLevelReported() > 0)
      .onSet(async (value) => {
        this.lampLevel = normalizeBoolean(value) ? LAMP_LEVEL_MAX : 0;
        await this.sendLightVentCommand();
      });
    this.serviceLight.getCharacteristic(Characteristic.Brightness)
      .setProps({ minValue: 0, maxValue: LAMP_LEVEL_MAX, minStep: 1 })
      .onGet(() => this.lampLevelReported())
      .onSet(async (value) => {
        const vNum = normalizeNumber(value);
        if (vNum === null) {
          return;
        }
        this.lampLevel = vNum;
        if (this.lampLevel !== this.lampLevelReported()) {
          await this.sendLightVentCommand();
        }
      });

    this.offSwitch = createSwitch(platform, accessory, 'Turn Off Microwave', 'CataNicoGaTa-Control8Off');
    this.offSwitch.setCharacteristic(Characteristic.ConfiguredName, 'Turn Off the Microwave');
    this.offSwitch.getCharacteristic(Characteristic.On)
      .onGet(() => false)
      .onSet(async (value) => {
        if (!normalizeBoolean(value)) {
          return;
        }
        try {
          await this.turnOffVentAndLamp();
        } finally {
          resetMomentarySwitch(platform, this.offSwitch);
        }
      });

    ///////// Microwave power level
    this.microwavePower = ensureService(accessory, Services.Lightbulb, 'Microwave Power', 'YourUniqueIdentifier-59SP');
    setConfiguredName(platform, this.microwavePower, 'Microwave Power');
    this.microwavePower.getCharacteristic(Characteristic.On)
      .onGet(() => this.powerPercent() > 0)
      .onSet((value) => {
        this.mwPower = normalizeBoolean(value) ? POWER_PERCENT_MAX : 0;
      });
    this.microwavePower.getCharacteristic(Characteristic.Brightness)
      .setProps({ minValue: 0, maxValue: POWER_PERCENT_MAX, minStep: POWER_LEVEL_TO_PERCENT })
      .onGet(() => this.powerPercent())
      .onSet((value) => {
        const vNum = normalizeNumber(value);
        if (vNum !== null) {
          this.mwPower = vNum;
        }
      });

    ///////// Television status board
    this.ovenService = createTelevision(platform, accessory, this.config.name || accessory.context.device.name,
      'NicoCataGaTa-OvenOven7', 'LG Microwave Oven');
    this.ovenService.getCharacteristic(Characteristic.Active)
      .onGet(() => this.ovenServiceActive())
      .onSet(async (value) => {
        if (normalizeBoolean(value)) {
          if (this.ventLevel() === 0 || this.lampLevelReported() === 0) {
            this.lampLevel = DEFAULT_VENT_LAMP_LEVEL;
            this.ventSpeed = DEFAULT_VENT_LAMP_LEVEL;
            await this.sendLightVentCommand();
          }
          return;
        }
        if (this.isCooking()) {
          await this.stopOven();
          await delay(STOP_SETTLE_MS);
        }
        await this.turnOffVentAndLamp();
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
    const cooking = this.isCooking();
    this.ovenState = input('Microwave Status', 'NicoCataGaTa-Oven1003', 1, true, () => this.ovenStatus());
    this.lightVent = input('Light and Vent Status', 'NicoCata-Always15', 2, this.lightVentState(), () => this.lightVentStatus());
    this.ovenMode = input('Microwave Cooking Mode', 'NicoCataGaTa-Oven1004', 3, cooking, () => this.ovenModeName());
    this.ovenTemp = input('Microwave Oven Temperature', 'NicoCataGaTa-Oven1004T', 4, cooking, () => this.ovenTemperature());
    this.ovenOptions = input('Microwave Options', 'NicoCata-Always4', 5, cooking, () => this.ovenOptionsName());
    this.ovenStart = input('Microwave Start Time', 'NicoCata-Always1', 6, this.cookTimes.showTime,
      () => truncateName(this.cookTimes.startString));
    this.ovenTimer = input('Microwave Timer Status', 'NicoCata-Always2', 7, this.cookTimes.showTimer,
      () => truncateName(this.cookTimes.timerString));
    this.ovenTime = input('Microwave Cook Time Status', 'NicoCata-Always2T', 8, this.cookTimes.showTime,
      () => truncateName(this.cookTimes.cookTimeString));
    this.ovenEndTime = input('Microwave End Time', 'NicoCata-Always3', 9, this.cookTimes.showTime,
      () => truncateName(this.cookTimes.endString));

    //////////Timers
    this.ovenTimerService = createDurationValve(platform, accessory, logger, {
      name: 'Microwave Cook Time',
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
      name: 'Microwave Timer',
      subtype: 'NicoCataGaTa-OvenT32',
      maxRemaining: TIMER_MAX_SECONDS,
      setDurationStep: SECONDS_PER_MINUTE,
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
        this.timerAlarmSec = Math.min(seconds, TIMER_MAX_SECONDS);
      },
    });

    ///////////Switches
    this.modeSwitches = MICROWAVE_MODE_SWITCHES.map(definition => ({
      definition,
      service: createModeSwitch(platform, accessory, definition.name, definition.subtype,
        () => this.ovenCommandList.ovenMode === definition.mode,
        (on) => {
          if (on) {
            this.ovenCommandList.ovenMode = definition.mode;
            this.markUserSelection();
          }
          this.syncModeSwitches();
        }),
    }));

    this.cancelSwitch = createSwitch(platform, accessory, 'Stop Microwave', 'CataNicoGaTa-Control6');
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
    this.startOvenSwitch = createSwitch(platform, accessory, 'Start Microwave', 'CataNicoGaTa-Control8');
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

    /////////Temperature Control
    this.ovenTempControl = ensureService(accessory, Services.Thermostat, 'Microwave Oven Temperature Control', 'NicoCataGaTa-OvenTC');
    this.ovenTempControl.setCharacteristic(Characteristic.Name, 'Microwave Oven Temperature Control');
    this.ovenTempControl.setCharacteristic(Characteristic.CurrentHeatingCoolingState, this.currentHeatingState());
    setConfiguredName(platform, this.ovenTempControl, 'Microwave Oven Temperature Control');
    this.ovenTempControl.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({ validValues: [Characteristic.TargetHeatingCoolingState.OFF, Characteristic.TargetHeatingCoolingState.HEAT] })
      .onGet(() => this.targetHeatingState())
      .onSet(async (value) => {
        if (normalizeBoolean(value)) {
          this.pauser.pause(USER_EDIT_PAUSE_MS);
        } else {
          await this.stopOven();
        }
      });
    this.ovenTempControl.getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({ minValue: MIN_CURRENT_TEMP_C, maxValue: MAX_TEMP_C, minStep: TEMP_STEP })
      .onGet(() => this.ovenCurrentTemperature());
    this.ovenTempControl.getCharacteristic(Characteristic.CurrentRelativeHumidity)
      .onGet(() => AMBIENT_HUMIDITY);
    this.ovenTempControl.getCharacteristic(Characteristic.TargetTemperature)
      .setProps({ minValue: MIN_TARGET_TEMP_C, maxValue: MAX_TEMP_C, minStep: TEMP_STEP })
      .onGet(() => this.ovenTargetTemperature())
      .onSet((value) => {
        const vNum = normalizeNumber(value);
        if (vNum === null) {
          this.logger.error('TargetTemperature is not a number');
          return;
        }
        const deviceTemp = isFahrenheit(this.Status.data.LWOTargetTemperatureUnit) ? tempCtoF(vNum) : vNum;
        this.ovenCommandList.ovenSetTemperature = Math.round(deviceTemp / TARGET_TEMP_INCREMENT) * TARGET_TEMP_INCREMENT;
        this.userTargetTemperature = vNum;
        this.markUserSelection();
      });
  }

  public get Status() {
    return this.getStatus(MicrowaveStatus);
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

  protected async turnOffVentAndLamp(): Promise<void> {
    if (this.ventLevel() !== 0 || this.lampLevelReported() !== 0) {
      this.lampLevel = 0;
      this.ventSpeed = 0;
      await this.sendLightVentCommand();
    }
  }

  async sendLightVentCommand(): Promise<void> {
    this.logger.debug('Fan Speed: ' + this.ventSpeed + ' Light: ' + this.lampLevel);
    await this.sendOvenState('setVentLampLevel', {
      'cmdOptionContentsType': 'REMOTE_VENT_LAMP',
      'cmdOptionDataLength': 'REMOTE_VENT_LAMP',
      'mwoVentOnOff': this.ventSpeed > 0 ? 'ENABLE' : 'DISABLE',
      'mwoVentSpeedLevel': this.ventSpeed,
      'mwoLampOnOff': this.lampLevel > 0 ? 'ENABLE' : 'DISABLE',
      'mwoLampLevel': this.lampLevel,
    });
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
          'upperTimerHour': 0,
          'upperTimerMinute': Math.floor(time / SECONDS_PER_MINUTE),
          'upperTimerSecond': Math.floor(time % SECONDS_PER_MINUTE),
        });
      } finally {
        this.pauser.pause(COMMAND_SETTLE_MS);
      }
    });
  }

  /** Build the cook-start command from the pending selection, applying per-mode defaults and limits. */
  protected prepareOvenCommand(): MicrowaveCommandList {
    const unit = this.reportedTempUnit() ?? this.ovenCommandList.tempUnits;
    const command: MicrowaveCommandList = { ...this.ovenCommandList, tempUnits: unit, microwavePower: this.mwPower.toString() };
    if (command.ovenMode === 'NONE') {
      command.ovenMode = 'WARM';
    }
    if (command.ovenSetDuration === 0) {
      command.ovenSetDuration = DEFAULT_COOK_SECONDS;
    }
    const mode = command.ovenMode;
    const apply = (overrides: Partial<MicrowaveCommandList>) => Object.assign(command, overrides);

    if (BAKE_OR_OVEN_MODES.some(m => mode.includes(m))) {
      command.ovenSetTemperature = clampCookTemp(MICROWAVE_TEMP_LIMITS, mode, unit, command.ovenSetTemperature);
      if (mode.includes('COMBI_BAKE')) {
        apply({ subCookNumber: 82, microwavePower: '10', targetWeight: 0, weightUnits: 'KG' });
      }
      if (mode.includes('COMBI_ROAST')) {
        apply({ subCookNumber: 82, microwavePower: '30', targetWeight: 0, weightUnits: 'LBS' });
      }
      if (mode.includes('CONV_BAKE') || mode.includes('OVEN')) {
        apply({ subCookNumber: 0, microwavePower: '100', targetWeight: 0, weightUnits: 'LBS' });
      }
    } else if (mode.includes('DEHYDRATE')) {
      command.ovenSetTemperature = clampCookTemp(MICROWAVE_TEMP_LIMITS, mode, unit, command.ovenSetTemperature);
      apply({ subCookNumber: 0, microwavePower: '100', targetWeight: 0, weightUnits: 'LBS' });
    } else if (mode.includes('PROOF')) {
      apply({ subCookNumber: 0, microwavePower: '100', ovenSetTemperature: 0, targetWeight: 0, weightUnits: 'KG' });
    } else if (mode.includes('MICROWAVE')) {
      apply({
        subCookNumber: 0,
        microwavePower: this.mwPower === 0 ? '100' : this.mwPower.toString(),
        ovenSetTemperature: 0,
        targetWeight: 0,
      });
    } else if (mode.includes('AIRFRY')) {
      apply({ ovenMode: 'AUTO_COOK', subCookNumber: 0, ovenSetDuration: 0, microwavePower: '100', ovenSetTemperature: 0, targetWeight: 0 });
    } else if (mode.includes('INVERTER_DEFROST')) {
      apply({ subCookNumber: 211, ovenSetDuration: 0, microwavePower: 'NONE', ovenSetTemperature: 0, targetWeight: 300 });
    } else if (mode.includes('TIME_DEFROST')) {
      apply({ subCookNumber: 0, microwavePower: '100', ovenSetTemperature: 0, targetWeight: 0, weightUnits: 'KG' });
    } else if (mode.includes('WARM')) {
      return { ...defaultMicrowaveCommand(unit), ovenMode: 'WARM' };
    }
    return command;
  }

  async sendOvenCommand(): Promise<void> {
    await this.commandGate.run(async () => {
      this.pauser.pause(USER_EDIT_PAUSE_MS);
      try {
        const command = this.prepareOvenCommand();
        this.ovenCommandList = command;
        this.logger.debug('Sending the following commands to the Microwave: ' + JSON.stringify(command));
        const duration = command.ovenSetDuration;
        // Dehydrate/Proof take hours + minutes; other modes express the duration in minutes only.
        const splitHours = command.ovenMode.includes('DEHYDRATE') || command.ovenMode.includes('PROOF');
        await this.sendOvenState('SetCookStart', {
          'cmdOptionContentsType': 'REMOTE_COOK_START',
          'cmdOptionDataLength': 'REMOTE_COOK_START',
          'cmdOptionSetCookName': command.ovenMode,
          'cmdOptionSetReserved': 0,
          'cmdOptionSetSubCookNumber': command.subCookNumber,
          'cmdOptionSetTargetTemperatureUnit': command.tempUnits,
          'cmdOptionSetTargetTimeHour': splitHours ? Math.floor(duration / ONE_HOUR_IN_SECONDS) : 0,
          'cmdOptionSetTargetTimeMinute': splitHours
            ? Math.floor(duration % ONE_HOUR_IN_SECONDS / SECONDS_PER_MINUTE)
            : Math.floor(duration / SECONDS_PER_MINUTE),
          'cmdOptionSetTargetTimeSecond': Math.floor(duration % SECONDS_PER_MINUTE),
          'cmdOptionSetWeightUnit': command.weightUnits,
          'cmdOptionStep': 0,
          'setMwoPowerLevel': command.microwavePower,
          'setTargetSteamLevel': 'NONE',
          'setTargetTemp': command.ovenSetTemperature,
          'setTargetTempLevel': command.ovenMode === 'WARM' ? 'HIGH' : 0,
          'setTargetWeight': command.targetWeight,
          'setWarmType': 'NONE',
        });
        this.clearUserSelection();
      } finally {
        this.pauser.pause(COMMAND_SETTLE_MS);
      }
    });
  }

  async stopOven(): Promise<void> {
    await this.commandGate.run(async () => {
      this.pauser.pause(USER_EDIT_PAUSE_MS);
      try {
        this.logger.debug('Stop Command Sent to Microwave');
        await this.sendOvenState('SetCookStop', { 'cmdOptionCookStop': 'UPPER' });
        this.clearUserSelection();
      } finally {
        this.pauser.pause(COMMAND_SETTLE_MS);
      }
    });
  }

  /////////////////////////// State (pure getters)

  reportedTempUnit(): string | undefined {
    const unit = this.Status.data.LWOTargetTemperatureUnit;
    return typeof unit === 'string' ? unit : undefined;
  }

  ventLevel(): number {
    return toNumber(this.Status.data.mwoVentSpeedLevel);
  }

  lampLevelReported(): number {
    return toNumber(this.Status.data.mwoLampLevel);
  }

  /** Power as a HomeKit percentage (device reports 1-10). */
  powerPercent(): number {
    return safeParseInt(this.Status.data.LWOMGTPowerLevel) * POWER_LEVEL_TO_PERCENT;
  }

  /** The microwave is cooking (state known and not INITIAL). */
  isCooking(): boolean {
    return textExcludes(this.Status.data.LWOState, 'INITIAL');
  }

  onStatus(): boolean {
    return this.isCooking();
  }

  lightVentState(): boolean {
    return this.isCooking() || this.ventLevel() !== 0 || this.lampLevelReported() !== 0;
  }

  ovenServiceActive(): 0 | 1 {
    return this.lightVentState() ? 1 : 0;
  }

  remainTime(): number {
    return sumTimeFieldsByPrefix(this.Status.data, 'LWORemainTime');
  }

  ovenTargetTime(): number {
    return sumTimeFieldsByPrefix(this.Status.data, 'LWOTargetTime');
  }

  ovenTimerTime(): number {
    return sumTimeFieldsByPrefix(this.Status.data, 'LWOTimer');
  }

  subCookProgram(): { label: string; defaultTempF: number } | undefined {
    const code = this.Status.data.LWOSubCookName;
    if (code === undefined || code === null || code === 0) {
      return undefined;
    }
    return SUB_COOK_PROGRAMS[toNumber(code)] ?? OTHER_SUB_COOK;
  }

  /** Default program temperature (°F) for sub-cook programs that do not report a target temperature. */
  defaultTemp(): number {
    if (!this.isCooking() || this.Status.data.LWOManualCookName === 'STANDBY') {
      return 0;
    }
    return this.subCookProgram()?.defaultTempF ?? 0;
  }

  ovenModeName(): string {
    const cookName = this.Status.data.LWOManualCookName;
    const label = typeof cookName === 'string' ? (MICROWAVE_MODE_LABELS[cookName] ?? capitalize(cookName)) : 'Unknown';
    let name = 'Microwave Mode: ' + label;
    const program = this.subCookProgram();
    if (cookName !== 'STANDBY' && program) {
      name += ' (' + program.label + ')';
    }
    return truncateName(name);
  }

  ovenStatus(): string {
    const state = this.Status.data.LWOState;
    const label = typeof state === 'string' ? (MICROWAVE_STATE_LABELS[state] ?? capitalize(state)) : 'Unknown';
    return truncateName('Microwave is ' + label);
  }

  ovenTemperature(): string {
    const data = this.Status.data;
    const current = data.upperCurrentTemperatureValue;
    const target = data.LWOTargetTemperatureValue;
    const defaultTemp = this.defaultTemp();
    let temperature = 'Microwave Oven Temperature Information';
    if (isNonZeroNumber(current)) {
      temperature = 'Current Temp is ' + current + '°';
    }
    if (isNonZeroNumber(target)) {
      temperature += ' With Set Temp ' + target + '°';
    } else if (defaultTemp !== 0 && !isNonZeroNumber(current)) {
      temperature = 'Current Temp is ' + defaultTemp + '° With Set Temp ' + defaultTemp + '°';
    }
    return truncateName(temperature);
  }

  /** Default program temperature applies while cooking/preheating a sub-cook program. */
  protected defaultTempC(): number | undefined {
    const state = this.Status.data.LWOState;
    const defaultTemp = this.defaultTemp();
    if (defaultTemp !== 0 && (textIncludes(state, 'COOKING_IN_PROGRESS') || textIncludes(state, 'PREHEATING'))) {
      return tempFtoC(defaultTemp);
    }
    return undefined;
  }

  ovenCurrentTemperature(): number {
    const data = this.Status.data;
    const unit = data.LWOTargetTemperatureUnit;
    let celsius: number | undefined;
    if (isNonZeroNumber(data.upperCurrentTemperatureValue)) {
      celsius = toCelsius(data.upperCurrentTemperatureValue, unit);
    } else if (isNonZeroNumber(data.LWOTargetTemperatureValue)) {
      celsius = toCelsius(data.LWOTargetTemperatureValue, unit);
    } else {
      celsius = this.defaultTempC();
    }
    return clampTemp(celsius ?? AMBIENT_TEMP_C, MIN_CURRENT_TEMP_C, MAX_TEMP_C);
  }

  ovenTargetTemperature(): number {
    if (this.userTargetTemperature !== undefined) {
      return clampTemp(this.userTargetTemperature, MIN_TARGET_TEMP_C, MAX_TEMP_C);
    }
    const data = this.Status.data;
    const celsius = isNonZeroNumber(data.LWOTargetTemperatureValue)
      ? toCelsius(data.LWOTargetTemperatureValue, data.LWOTargetTemperatureUnit)
      : this.defaultTempC();
    return clampTemp(celsius ?? MIN_TARGET_TEMP_C, MIN_TARGET_TEMP_C, MAX_TEMP_C);
  }

  ovenOptionsName(): string {
    const data = this.Status.data;
    let options = 'Settings: ' + (isFahrenheit(data.LWOTargetTemperatureUnit) ? 'Temp in °F' : 'Temp in °C');
    if (textExcludes(data.LWOSabbath, 'NOT')) {
      options += ', Sabbath On';
    }
    if (textIncludes(data.LWOControlLock, 'ENA')) {
      options += ', Control Lock';
    }
    return truncateName(options);
  }

  currentHeatingState(): 0 | 1 {
    const data = this.Status.data;
    return isNonZeroNumber(data.upperCurrentTemperatureValue) || this.defaultTemp() !== 0 || isNonZeroNumber(data.LWOTargetTemperatureValue)
      ? 1 : 0;
  }

  targetHeatingState(): 0 | 1 {
    return isNonZeroNumber(this.Status.data.LWOTargetTemperatureValue) || this.defaultTemp() !== 0 ? 1 : 0;
  }

  lightVentStatus(): string {
    const lamp = this.lampLevelReported();
    const vent = this.ventLevel();
    const lampText = lamp === 0 ? 'Light is Off' : lamp === 1 ? 'Light is set to Low' : 'Light is set to High';
    const ventText = vent > 0 ? ' and Vent is set to Level ' + vent : ' and Vent is Off';
    return lampText + ventText;
  }

  /////////////////////////// Updates

  syncModeSwitches(): void {
    for (const { definition, service } of this.modeSwitches) {
      updateIfChanged(service, this.platform.Characteristic.On, this.ovenCommandList.ovenMode === definition.mode);
    }
  }

  protected syncCommandList(cooking: boolean, active: 0 | 1): void {
    if (cooking && !this.wasCooking) {
      this.clearUserSelection();
    }
    this.wasCooking = cooking;
    if (!this.userSelectionPending) {
      if (active === 0) {
        this.ovenCommandList = defaultMicrowaveCommand(this.reportedTempUnit() ?? this.ovenCommandList.tempUnits);
      }
      const cookName = this.Status.data.LWOManualCookName;
      if (textExcludes(cookName, 'STAND')) {
        this.ovenCommandList.ovenMode = cookName as string;
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
    const cooking = this.isCooking();
    const active = this.ovenServiceActive();
    const targetTime = this.ovenTargetTime();
    const timerTime = this.ovenTimerTime();
    const remaining = this.remainTime();

    updateIfChanged(this.ovenService, Characteristic.Active, active);
    this.syncCommandList(cooking, active);
    this.cookTimes.update(textExcludes(data.LWOManualCookName, 'STAND'), targetTime, timerTime);

    /////////// Names
    updateIfChanged(this.ovenState, Characteristic.ConfiguredName, this.ovenStatus());
    updateIfChanged(this.ovenMode, Characteristic.ConfiguredName, this.ovenModeName());
    updateIfChanged(this.lightVent, Characteristic.ConfiguredName, this.lightVentStatus());
    updateIfChanged(this.ovenTemp, Characteristic.ConfiguredName, this.ovenTemperature());
    updateIfChanged(this.ovenStart, Characteristic.ConfiguredName, truncateName(this.cookTimes.startString));
    updateIfChanged(this.ovenTimer, Characteristic.ConfiguredName, truncateName(this.cookTimes.timerString));
    updateIfChanged(this.ovenTime, Characteristic.ConfiguredName, truncateName(this.cookTimes.cookTimeString));
    updateIfChanged(this.ovenEndTime, Characteristic.ConfiguredName, truncateName(this.cookTimes.endString));
    updateIfChanged(this.ovenOptions, Characteristic.ConfiguredName, this.ovenOptionsName());

    /////////// Visibility
    setVisibility(this.platform, this.ovenMode, cooking);
    setVisibility(this.platform, this.ovenTemp, cooking);
    setVisibility(this.platform, this.lightVent, this.lightVentState());
    setVisibility(this.platform, this.ovenOptions, cooking);
    setVisibility(this.platform, this.ovenStart, this.cookTimes.showTime);
    setVisibility(this.platform, this.ovenTime, this.cookTimes.showTime);
    setVisibility(this.platform, this.ovenEndTime, this.cookTimes.showTime);
    setVisibility(this.platform, this.ovenTimer, this.cookTimes.showTimer);

    /////////// Temperature
    const displayUnits = isFahrenheit(data.LWOTargetTemperatureUnit)
      ? Characteristic.TemperatureDisplayUnits.FAHRENHEIT
      : Characteristic.TemperatureDisplayUnits.CELSIUS;
    updateIfChanged(this.ovenTempControl, Characteristic.TemperatureDisplayUnits, displayUnits);
    updateIfChanged(this.ovenTempControl, Characteristic.CurrentTemperature, this.ovenCurrentTemperature());
    updateIfChanged(this.ovenTempControl, Characteristic.TargetTemperature, this.ovenTargetTemperature());
    updateIfChanged(this.ovenTempControl, Characteristic.TargetHeatingCoolingState, this.targetHeatingState());
    updateIfChanged(this.ovenTempControl, Characteristic.CurrentHeatingCoolingState, this.currentHeatingState());
    updateIfChanged(this.ovenTempControl, Characteristic.CurrentRelativeHumidity, AMBIENT_HUMIDITY);

    /////////// Power, light, vent
    const powerPercent = this.powerPercent();
    updateIfChanged(this.microwavePower, Characteristic.On, powerPercent > 0);
    updateIfChanged(this.microwavePower, Characteristic.Brightness, powerPercent);
    const lamp = this.lampLevelReported();
    updateIfChanged(this.serviceLight, Characteristic.On, lamp > 0);
    updateIfChanged(this.serviceLight, Characteristic.Brightness, lamp);
    const vent = this.ventLevel();
    updateIfChanged(this.serviceHood, Characteristic.Active, vent > 0 ? 1 : 0);
    updateIfChanged(this.serviceHood, Characteristic.RotationSpeed, vent);

    /////////// Cook timer
    updateIfChanged(this.ovenTimerService, Characteristic.Active, remaining > 0 ? 1 : 0);
    if (targetTime === 0) {
      updateIfChanged(this.ovenTimerService, Characteristic.InUse, Characteristic.InUse.NOT_IN_USE);
    } else if (cooking) {
      updateIfChanged(this.ovenTimerService, Characteristic.InUse, Characteristic.InUse.IN_USE);
    }
    updateIfChanged(this.ovenTimerService, Characteristic.RemainingDuration, remaining);
    if (!this.userSelectionPending) {
      updateIfChanged(this.ovenTimerService, Characteristic.SetDuration, targetTime);
    }

    /////////// Kitchen timer
    updateIfChanged(this.ovenAlarmService, Characteristic.Active, timerTime > 0 ? 1 : 0);
    updateIfChanged(this.ovenAlarmService, Characteristic.RemainingDuration, timerTime);
    updateIfChanged(this.ovenAlarmService, Characteristic.InUse, timerTime > 0 ? 1 : 0);
  }
}

export class MicrowaveStatus {
  constructor(protected readonly raw: SnapshotData | undefined, protected readonly deviceModel: DeviceModel) { }

  /** Snapshot data; always an object (empty when the device has not reported yet). */
  public get data(): SnapshotData {
    return this.raw ?? {};
  }
}
