import type { AccessoryContext } from '../baseDevice.js';
import { BaseDevice } from '../baseDevice.js';
import type { LGThinQHomebridgePlatform } from '../platform.js';
import type { Logger, PlatformAccessory, Service } from 'homebridge';
import type { Device } from '../models/Device.js';
import { normalizeNumber } from '../helper.js';
import { WasherDryerStatus } from './WasherDryer.js';
import {
  SIX_HOURS_IN_SECONDS,
  TEN_MINUTES_MS,
  ONE_HOUR_IN_SECONDS,
  ONE_SECOND_MS,
  SIX_MINUTES_MS,
  DISHWASHER_STANDBY_INTERVAL_MS,
  DRY_CYCLE_THRESHOLD,
  TCL_MAINTENANCE_THRESHOLD,
  RINSE_LEVEL_EMPTY,
  RINSE_LEVEL_HALF,
  RINSE_LEVEL_FULL,
  INPUT_ID_MIN,
  INPUT_ID_MAX,
} from '../lib/constants.js';
import {
  capitalize,
  enteredState,
  formatDateTime,
  formatDuration,
  sumTimeFields,
  textIncludes,
  truncateName,
} from './cooking/helpers.js';
import { createInputSource, createTelevision, setVisibility, updateIfChanged } from './cooking/services.js';

/** Television input identifiers. */
const INPUT_STATUS = 1;
const INPUT_OPTIONS = 2;
const INPUT_START_TIME = 3;
const INPUT_DURATION = 4;
const INPUT_END_TIME = 5;
const INPUT_RINSE = 6;
const INPUT_CLEANLINESS = 7;

const DEFAULT_START_STRING = 'Cycle Start Time Not Set';
const DEFAULT_DURATION_STRING = 'Cycle Duration Not Set';
const DEFAULT_END_STRING = 'Cycle End Time Not Set';

/** Display names for known courses (matched by substring, in order). */
const COURSE_NAMES: readonly [string, string][] = [
  ['AUTO', 'Running a Auto Cycle'],
  ['HEAVY', 'Running a Heavy Cycle'],
  ['DELICATE', 'Running a Delicate Cycle'],
  ['TURBO', 'Running a Turbo Cycle'],
  ['NORMAL', 'Running a Normal Cycle'],
  ['RINSE', 'Running a Rinse Cycle'],
  ['REFRESH', 'Running a Refresh Cycle'],
  ['EXPRESS', 'Running a Express Cycle'],
  ['CLEAN', 'Cleaning the Dishwasher'],
  ['SHORT', 'Running a Short Cycle'],
];

const LATE_COURSE_NAMES: readonly [string, string][] = [
  ['QUICK', 'Running a Quick Cycle'],
  ['STREAM', 'Running a Stream Cycle'],
  ['SPRAY', 'Running a Spray Cycle'],
  ['ECO', 'Running an Eco Cycle'],
];

/** Display names for simple states (matched by substring, in order). */
const STATE_NAMES: readonly [string, string][] = [
  ['FAIL', 'Failure Detected'],
  ['RESERVED', 'Is Reserved'],
  ['RINSING', 'Rinsing'],
  ['DRYING', 'Drying'],
  ['NIGHT', 'Night Drying'],
  ['CANCEL', 'Cancelled Cleaning'],
  ['ERROR', 'Cleaning Error'],
];

const OPTION_NAMES: readonly [string, string][] = [
  ['energySaver', 'Energy Saver'],
  ['halfLoad', 'Half Load'],
  ['dualZone', 'Dual Zone'],
  ['highTemp', 'High Temp'],
  ['steam', 'Steam'],
  ['extraRinse', 'Extra Rinse'],
  ['extraDry', 'Extra Dry'],
  ['nightDry', 'Night Dry'],
  ['delayStart', 'Delay Start'],
];

export default class Dishwasher extends BaseDevice {
  public isRunning = false;
  public inputID = INPUT_STATUS;
  public rinseLevel = 'LEVEL_2';
  public inputName = 'Dishwasher Status';
  public inputNameOptions = 'Dishwasher Options';
  public inputNameRinse = 'Dishwasher Rinse Aid Level';
  public inputNameMachine = 'Dishwasher Cleanness Status';
  public courseStartString = DEFAULT_START_STRING;
  public courseTimeString = DEFAULT_DURATION_STRING;
  public courseTimeEndString = DEFAULT_END_STRING;
  public showTime = false;
  public firstTime = true;
  public firstEnd = true;
  public settingDuration = 0;
  public dryCounter = 0;
  public delayTime = 0;
  public firstDelay = true;
  public firstStandby = true;
  public standbyTimetMS = 0;
  public finishedTime = 'Today';
  /** Last `state` seen in a dishwasher snapshot (for END edge detection). */
  protected lastReportedState: unknown = undefined;
  protected standbyTimer: ReturnType<typeof setTimeout> | undefined;
  protected finishedTimer: ReturnType<typeof setTimeout> | undefined;

  protected serviceDishwasher: Service;
  protected serviceDoorOpened: Service;
  protected serviceEventFinished: Service | undefined;
  protected tvService: Service;
  protected dishwasherState: Service;
  protected dishwasherOptions: Service;
  protected startTime: Service;
  protected courseDuration: Service;
  protected endTime: Service;
  protected dishwasherRinseLevel: Service;
  protected dishwasherCleanliness: Service;

  constructor(
    platform: LGThinQHomebridgePlatform,
    accessory: PlatformAccessory<AccessoryContext>,
    logger: Logger,
  ) {
    super(platform, accessory, logger);

    const {
      Service: {
        Valve,
        ContactSensor,
        OccupancySensor,
      },
      Characteristic,
    } = this.platform;

    const device = accessory.context.device;

    this.tvService = createTelevision(platform, accessory, this.config.name || device.name, 'CataNicoGaTa-70', 'LG Dishwasher');
    this.tvService.getCharacteristic(Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .updateValue(Characteristic.Active.INACTIVE)
      .onGet(() => (this.onStatus() ? 1 : 0));
    this.tvService.setCharacteristic(Characteristic.ActiveIdentifier, this.inputID);
    this.tvService.getCharacteristic(Characteristic.ActiveIdentifier)
      .onSet((inputIdentifier) => {
        const vNum = normalizeNumber(inputIdentifier);
        if (vNum === null) {
          this.logger.error('Dishwasher ActiveIdentifier is not a number');
          return;
        }
        this.inputID = vNum > INPUT_ID_MAX || vNum < INPUT_ID_MIN ? INPUT_ID_MIN : vNum;
      })
      .onGet(() => this.inputID);

    // ConfiguredName getters are pure: the cached strings are refreshed by updateAccessoryCharacteristic.
    const input = (name: string, subtype: string, identifier: number, shown: boolean, getName: () => string) =>
      createInputSource(platform, accessory, this.tvService, { name, subtype, identifier, shown, getName });
    const on = this.onStatus();
    this.dishwasherState = input('Dishwasher Status', 'CataNicoGaTa-10030', INPUT_STATUS, true, () => this.inputName);
    this.dishwasherOptions = input('Dishwasher Options', 'CataNicoGaTa-10040', INPUT_OPTIONS, on, () => this.inputNameOptions);
    this.startTime = input('Cycle Start Time', 'CataNico-Always10', INPUT_START_TIME, this.showTime, () => this.courseStartString);
    this.courseDuration = input('Cycle Duration', 'CataNico-Always20', INPUT_DURATION, this.showTime, () => this.courseTimeString);
    this.endTime = input('Cycle End Time', 'CataNico-Always30', INPUT_END_TIME, this.showTime, () => this.courseTimeEndString);
    this.dishwasherRinseLevel = input('Dishwasher Rinse Aid Level', 'CataNicoGaTa-10050', INPUT_RINSE, on, () => this.inputNameRinse);
    this.dishwasherCleanliness = input('Dishwasher Cleanness Status', 'CataNicoGaTa-10060', INPUT_CLEANLINESS, on,
      () => this.inputNameMachine);

    this.serviceDishwasher = accessory.getService(Valve) || accessory.addService(Valve, 'LG Dishwasher');
    this.serviceDishwasher.setPrimaryService(true);
    this.serviceDishwasher.setCharacteristic(Characteristic.Name, device.name);
    this.serviceDishwasher.addOptionalCharacteristic(Characteristic.ConfiguredName);
    this.serviceDishwasher.setCharacteristic(Characteristic.ConfiguredName, device.name);
    this.serviceDishwasher.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.IRRIGATION);
    this.serviceDishwasher.getCharacteristic(Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .updateValue(Characteristic.Active.INACTIVE)
      .onGet(() => this.timerStatus());
    this.serviceDishwasher.setCharacteristic(Characteristic.InUse, Characteristic.InUse.NOT_IN_USE);
    this.serviceDishwasher.getCharacteristic(Characteristic.StatusFault)
      .onGet(() => this.getRinseLevel());
    this.serviceDishwasher.getCharacteristic(Characteristic.RemainingDuration).setProps({
      maxValue: SIX_HOURS_IN_SECONDS,
    });
    this.serviceDishwasher.getCharacteristic(Characteristic.SetDuration)
      .onGet(() => this.settingDuration)
      .setProps({
        maxValue: SIX_HOURS_IN_SECONDS,
      });

    // Door open state
    this.serviceDoorOpened = accessory.getService(ContactSensor) || accessory.addService(ContactSensor, 'Dishwasher Door');
    this.serviceDoorOpened.addOptionalCharacteristic(Characteristic.ConfiguredName);
    this.serviceDoorOpened.setCharacteristic(Characteristic.ConfiguredName, 'Dishwasher Door');
    this.serviceDoorOpened.getCharacteristic(Characteristic.StatusActive)
      .onGet(() => this.getDoorStatus());
    this.serviceDoorOpened.getCharacteristic(Characteristic.BatteryLevel)
      .onGet(() => this.getRinseLevelPercent());
    this.serviceDoorOpened.getCharacteristic(Characteristic.StatusLowBattery)
      .onGet(() => this.getRinseLevelStatus());

    this.serviceEventFinished = accessory.getService(OccupancySensor);
    if (this.config.dishwasher_trigger as boolean) {
      this.serviceEventFinished = this.serviceEventFinished || accessory.addService(OccupancySensor, device.name + ' - Program Finished');

      this.serviceEventFinished.updateCharacteristic(Characteristic.OccupancyDetected, Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    } else if (this.serviceEventFinished) {
      accessory.removeService(this.serviceEventFinished);
    }
  }

  public destroy(): void {
    if (this.standbyTimer) {
      clearTimeout(this.standbyTimer);
      this.standbyTimer = undefined;
    }
    if (this.finishedTimer) {
      clearTimeout(this.finishedTimer);
      this.finishedTimer = undefined;
    }
    super.destroy();
  }

  /** Name for the running course (e.g. "Running a Heavy Cycle"). */
  protected runningCourseName(): string {
    const data = this.Status.data;
    const course = data.course;
    const match = COURSE_NAMES.find(([key]) => textIncludes(course, key));
    if (match) {
      return match[1];
    }
    if (textIncludes(course, 'DOWNLOAD')) {
      return 'Running a ' + capitalize(data.currentDownloadCourse) + ' Cycle';
    }
    const lateMatch = LATE_COURSE_NAMES.find(([key]) => textIncludes(course, key));
    if (lateMatch) {
      return lateMatch[1];
    }
    return 'Running a ' + capitalize(course) + ' Cycle';
  }

  /** Recompute the status/options input names. Called from the update path only. */
  currentInputName() {
    const data = this.Status.data;
    const state = data.state;
    const process = data.process;
    if (!textIncludes(process, 'RESERVED')) {
      this.firstDelay = true;
    }
    if (!textIncludes(state, 'STAND')) {
      this.standbyTimetMS = 0;
      this.firstStandby = true;
    }
    if (this.firstDelay) {
      if (textIncludes(state, 'OFF')) {
        this.inputName = 'Power Off';
        this.firstEnd = true;
        this.resetTimeSettings();
        this.settingDuration = 0;
        this.dryCounter = 0;
      } else if (textIncludes(state, 'STAND')) {
        this.firstEnd = true;
        this.resetTimeSettings();
        this.dryCounter = 0;
        if (!this.onStatus()) {
          this.inputName = 'Power Off';
        } else {
          this.inputName = 'In Standby';
          if (!textIncludes(data.door, 'OPEN')) {
            this.inputName += ' (Door Closed)';
          }
        }
        if (this.firstStandby) {
          this.standbyTimetMS = Date.now();
          this.firstStandby = false;
          this.scheduleStandbyRefresh();
        }
      } else if (textIncludes(state, 'INITIAL')) {
        this.inputName = 'Initializing';
        this.resetTimeSettings();
      } else if (textIncludes(state, 'RUNNING')) {
        this.inputName = this.runningCourseName();
      } else if (textIncludes(state, 'PAUSE')) {
        this.inputName = 'Paused Cleaning';
        this.firstTime = true;
        this.firstDelay = true;
      } else if (textIncludes(state, 'END')) {
        if (this.firstEnd) {
          this.finishedTime = formatDateTime(new Date(), 'short');
          this.firstEnd = false;
          this.resetTimeSettings();
        }
        this.inputName = 'Finished Cycle ' + this.finishedTime;
        if (textIncludes(data.extraDry, 'ON') && this.dryCounter > DRY_CYCLE_THRESHOLD && this.Status.remainDuration === ONE_HOUR_IN_SECONDS) {
          this.inputName += ' (Waiting For Extra Dry Step)';
        }
      } else {
        const match = STATE_NAMES.find(([key]) => textIncludes(state, key));
        this.inputName = match ? match[1] : 'Dishwasher ' + capitalize(state);
      }
      if (textIncludes(data.door, 'OPEN')) {
        this.inputName += ' (Door Open)';
        this.resetTimeSettings();
      }
      if (state === process && textIncludes(process, 'RUNNING')) {
        this.inputName += '. Step: Cleaning';
      }
      if (state !== process && typeof process === 'string' && !process.includes('NONE') && !textIncludes(state, 'END')) {
        this.inputName += this.processStepName();
      }
    }

    const options = OPTION_NAMES.filter(([key]) => textIncludes(data[key], 'ON')).map(([, label]) => label);
    this.inputNameOptions = 'Options: ' + (options.length > 0 ? options.join(', ') : 'None');
    this.inputName = truncateName(this.inputName);
    this.inputNameOptions = truncateName(this.inputNameOptions);
    if (!this.Status.isPowerOn) {
      this.inputNameOptions = 'Dishwasher Options';
    }
    updateIfChanged(this.dishwasherState, this.platform.Characteristic.ConfiguredName, this.inputName);
    updateIfChanged(this.dishwasherOptions, this.platform.Characteristic.ConfiguredName, this.inputNameOptions);
    setVisibility(this.platform, this.dishwasherOptions, this.onStatus());
  }

  /** Suffix describing the current wash step, e.g. ". Step: Drying". */
  protected processStepName(): string {
    const data = this.Status.data;
    const process = data.process;
    if (textIncludes(process, 'RINSING')) {
      return '. Step: Rinsing';
    }
    if (textIncludes(process, 'DRYING')) {
      const extra = textIncludes(data.extraDry, 'ON') && this.dryCounter > DRY_CYCLE_THRESHOLD ? ' (Extra)' : '';
      return '. Step: Drying' + extra;
    }
    if (textIncludes(process, 'NIGHT')) {
      return '. Step: Night Drying';
    }
    if (textIncludes(process, 'END')) {
      return '. Step: Ending';
    }
    if (textIncludes(process, 'CANCEL')) {
      return '. Step: Cancelling';
    }
    if (textIncludes(process, 'RESERVED') && data.delayStart === 'ON') {
      this.delayTime = sumTimeFields(data.reserveTimeHour, data.reserveTimeMinute);
      this.timeDurationEnd();
      this.firstDelay = false;
      return '. Step: Waiting ' + formatDuration(this.delayTime) + ' to Start';
    }
    const state = data.state;
    if (!textIncludes(state, 'INITIAL') && !textIncludes(state, 'STAND') && !textIncludes(process, 'RESERVED')) {
      return '. Step: ' + capitalize(state);
    }
    return '';
  }

  /** Re-evaluate Active state once the standby window has elapsed (single tracked timer). */
  protected scheduleStandbyRefresh(): void {
    if (this.standbyTimer) {
      clearTimeout(this.standbyTimer);
    }
    this.standbyTimer = setTimeout(() => {
      this.standbyTimer = undefined;
      const { Characteristic } = this.platform;
      this.serviceDishwasher.updateCharacteristic(Characteristic.Active, this.timerStatus());
      this.tvService.updateCharacteristic(Characteristic.Active, this.onStatus() ? 1 : 0);
      this.serviceDoorOpened.updateCharacteristic(Characteristic.StatusActive, this.onStatus());
    }, DISHWASHER_STANDBY_INTERVAL_MS);
  }

  timeDurationEnd() {
    const remaining = this.Status.remainDuration;
    this.showTime = true;
    this.courseTimeString = 'Duration: ' + formatDuration(remaining);
    if (textIncludes(this.Status.data.extraDry, 'ON')) {
      this.courseTimeString += ' + 1:00:00 Hour For Extra Dry';
    }
    const startMS = Date.now() + this.delayTime * ONE_SECOND_MS;
    this.courseStartString = truncateName('Start: ' + formatDateTime(new Date(startMS)));
    this.courseTimeString = truncateName(this.courseTimeString);
    this.courseTimeEndString = truncateName('End: ' + formatDateTime(new Date(startMS + remaining * ONE_SECOND_MS)));
    this.pushTimeInputs();
  }

  /** Push the start/duration/end inputs (names and visibility) to HomeKit when changed. */
  protected pushTimeInputs(): void {
    const { ConfiguredName } = this.platform.Characteristic;
    updateIfChanged(this.startTime, ConfiguredName, this.courseStartString);
    updateIfChanged(this.courseDuration, ConfiguredName, this.courseTimeString);
    updateIfChanged(this.endTime, ConfiguredName, this.courseTimeEndString);
    setVisibility(this.platform, this.startTime, this.showTime);
    setVisibility(this.platform, this.courseDuration, this.showTime);
    setVisibility(this.platform, this.endTime, this.showTime);
  }

  /** Active cannot be controlled remotely; the handler only logs. */
  setActive() {
    this.logger.debug('Dishwasher Response', this.Status.data);
  }

  public updateAccessoryCharacteristic(device: Device) {
    super.updateAccessoryCharacteristic(device);
    const { Characteristic } = this.platform;
    const data = this.Status.data;
    const remaining = this.Status.remainDuration;
    if (remaining !== this.serviceDishwasher.getCharacteristic(Characteristic.RemainingDuration).value) {
      if (textIncludes(data.extraDry, 'ON') && remaining === ONE_HOUR_IN_SECONDS) {
        this.dryCounter += 1;
      }
      if (this.dryCounter <= DRY_CYCLE_THRESHOLD) {
        this.serviceDishwasher.updateCharacteristic(Characteristic.RemainingDuration, remaining);
      }
    }
    if (this.Status.isPowerOn) {
      this.settingDuration = sumTimeFields(data.initialTimeHour, data.initialTimeMinute);
    }
    updateIfChanged(this.serviceDishwasher, Characteristic.SetDuration, this.settingDuration);
    this.serviceDishwasher.updateCharacteristic(Characteristic.Active, this.timerStatus());
    this.tvService.updateCharacteristic(Characteristic.Active, this.onStatus() ? 1 : 0);
    if ((data.delayStart === 'ON' && textIncludes(data.process, 'RESER')) || textIncludes(data.state, 'STAND')) {
      this.serviceDishwasher.updateCharacteristic(Characteristic.InUse, Characteristic.InUse.NOT_IN_USE);
    } else {
      this.serviceDishwasher.updateCharacteristic(Characteristic.InUse, this.Status.isRunning ? 1 : 0);
    }
    const contactSensorValue = this.Status.isDoorClosed ?
      Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
    this.serviceDoorOpened.updateCharacteristic(Characteristic.ContactSensorState, contactSensorValue);
    this.currentInputName();
    if (textIncludes(data.state, 'RUNNING') && !textIncludes(data.process, 'RESERVED') && this.firstTime) {
      this.delayTime = 0;
      this.timeDurationEnd();
      this.firstTime = false;
    }
    this.updateRinseLevel();
  }

  public get Status() {
    return this.getStatus(DishwasherStatus);
  }

  /** Rinse level from the snapshot while running, otherwise the last known level. */
  protected effectiveRinseLevel(): string {
    const data = this.Status.data;
    if (textIncludes(data.state, 'RUNNING')) {
      return typeof data.rinseLevel === 'string' && data.rinseLevel ? data.rinseLevel : 'LEVEL_1';
    }
    return this.rinseLevel;
  }

  updateRinseLevel() {
    const { Characteristic } = this.platform;
    this.rinseLevel = this.effectiveRinseLevel();
    let inputID = this.inputID;
    let rinseLevelPercent = RINSE_LEVEL_FULL;
    let rinseLevelStatus = 0;
    if (this.rinseLevel === 'LEVEL_0') {
      rinseLevelPercent = RINSE_LEVEL_EMPTY;
      rinseLevelStatus = 1;
      this.inputNameRinse = 'Rinse Aid Level is Running Low';
      inputID = INPUT_RINSE;
    } else if (this.rinseLevel === 'LEVEL_1') {
      rinseLevelPercent = RINSE_LEVEL_HALF;
      this.inputNameRinse = 'Rinse Aid Level is at 50% Capacity';
    } else if (this.rinseLevel === 'LEVEL_2') {
      this.inputNameRinse = 'Rinse Aid Level is at 100% Capacity';
    } else {
      this.inputNameRinse = 'Rinse Aid Level is Normal';
    }
    const on = this.onStatus();
    this.serviceDishwasher.updateCharacteristic(Characteristic.StatusFault, rinseLevelStatus);
    this.serviceDoorOpened.updateCharacteristic(Characteristic.StatusActive, on);
    this.serviceDoorOpened.updateCharacteristic(Characteristic.BatteryLevel, rinseLevelPercent);
    this.serviceDoorOpened.updateCharacteristic(Characteristic.StatusLowBattery, rinseLevelStatus);

    const needsCleaning = this.Status.data.tclCount > TCL_MAINTENANCE_THRESHOLD;
    if (needsCleaning) {
      inputID = INPUT_CLEANLINESS;
      this.inputNameMachine = 'Machine Cleaning Cycle is Needed Soon';
    } else {
      this.inputNameMachine = 'Dishwasher is Clean';
    }
    updateIfChanged(this.dishwasherCleanliness, Characteristic.ConfiguredName, this.inputNameMachine);
    setVisibility(this.platform, this.dishwasherCleanliness, needsCleaning && on);
    updateIfChanged(this.dishwasherRinseLevel, Characteristic.ConfiguredName, this.inputNameRinse);
    setVisibility(this.platform, this.dishwasherRinseLevel, on);

    if (inputID !== this.inputID) {
      this.inputID = inputID;
      this.tvService.updateCharacteristic(Characteristic.ActiveIdentifier, inputID);
    }
  }

  onStatus() {
    if (this.standbyTimetMS !== 0 && Date.now() - this.standbyTimetMS > SIX_MINUTES_MS) {
      return false;
    }
    return this.Status.isPowerOn;
  }

  timerStatus() {
    if (!this.onStatus() || this.Status.remainDuration === 0 || textIncludes(this.Status.data.state, 'STAND')) {
      return 0;
    }
    return 1;
  }

  getRinseLevel() {
    return this.effectiveRinseLevel() === 'LEVEL_0' ? 1 : 0;
  }

  getDoorStatus() {
    return this.onStatus();
  }

  getRinseLevelPercent() {
    const level = this.effectiveRinseLevel();
    if (level === 'LEVEL_0') {
      return RINSE_LEVEL_EMPTY;
    }
    if (level === 'LEVEL_1') {
      return RINSE_LEVEL_HALF;
    }
    return RINSE_LEVEL_FULL;
  }

  getRinseLevelStatus() {
    return this.getRinseLevel();
  }

  resetTimeSettings() {
    this.showTime = false;
    this.firstTime = true;
    this.firstDelay = true;
    this.courseStartString = DEFAULT_START_STRING;
    this.courseTimeString = DEFAULT_DURATION_STRING;
    this.courseTimeEndString = DEFAULT_END_STRING;
    setVisibility(this.platform, this.startTime, false);
    setVisibility(this.platform, this.courseDuration, false);
    setVisibility(this.platform, this.endTime, false);
  }

  public update(snapshot: Record<string, unknown>) {
    super.update(snapshot);

    const dishwasher = snapshot.dishwasher as Record<string, unknown> | undefined;
    if (!dishwasher || !('state' in dishwasher)) {
      return;
    }
    const previousState = this.lastReportedState;
    this.lastReportedState = dishwasher.state;

    if (!(this.config.dishwasher_trigger as boolean) || !this.serviceEventFinished) {
      return;
    }
    const { OccupancyDetected } = this.platform.Characteristic;

    // detect if the program is done: only on the transition into END, or running -> not running
    if (enteredState(previousState, dishwasher.state, 'END') || (this.isRunning && !this.Status.isRunning)) {
      this.serviceEventFinished.updateCharacteristic(OccupancyDetected, OccupancyDetected.OCCUPANCY_DETECTED);
      this.isRunning = false; // marked device as not running

      // turn it off after 10 minutes (single tracked timer)
      if (this.finishedTimer) {
        clearTimeout(this.finishedTimer);
      }
      this.finishedTimer = setTimeout(() => {
        this.finishedTimer = undefined;
        this.serviceEventFinished?.updateCharacteristic(OccupancyDetected, OccupancyDetected.OCCUPANCY_NOT_DETECTED);
      }, TEN_MINUTES_MS);
    }

    // detect if dishwasher program is start
    if (this.Status.isRunning && !this.isRunning) {
      this.serviceEventFinished.updateCharacteristic(OccupancyDetected, OccupancyDetected.OCCUPANCY_NOT_DETECTED);
      this.isRunning = true;
    }
  }
}

// re-use some status in washer
export class DishwasherStatus extends WasherDryerStatus {
  public get isRunning() {
    return this.isPowerOn && this.data?.state === this.deviceModel.lookupMonitorName('state', '@DW_STATE_RUNNING_W');
  }

  public get isDoorClosed() {
    return this.data?.door === this.deviceModel.lookupMonitorName('door', '@CP_OFF_EN_W');
  }
}
