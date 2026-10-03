import type { AccessoryContext } from '../baseDevice.js';
import { BaseDevice } from '../baseDevice.js';
import type { LGThinQHomebridgePlatform } from '../platform.js';
import type { CharacteristicValue, Logger, PlatformAccessory, Service } from 'homebridge';
import type { Device } from '../models/Device.js';
import { PlatformType, WASHER_NOT_RUNNING_STATUS, ONE_DAY_IN_SECONDS, TEN_MINUTES_MS, TCL_MAINTENANCE_THRESHOLD } from '../lib/constants.js';
import { toSeconds } from '../utils/normalize.js';
import { BaseStatus } from '../status/BaseStatus.js';
import { DeviceRegistry } from '../models/DeviceRegistry.js';

/** @deprecated Use WASHER_NOT_RUNNING_STATUS from lib/constants.js instead */
export const NOT_RUNNING_STATUS = WASHER_NOT_RUNNING_STATUS;

export default class WasherDryer extends BaseDevice {
  public isRunning = false;
  public isServiceTubCleanMaintenanceTriggered = false;
  /** Last observed (merged) washer state, used to detect transitions to END */
  protected lastState: string | undefined;

  protected serviceWasherDryer: Service | undefined;
  protected serviceEventFinished: Service | undefined;
  protected serviceDoorLock: Service | undefined;
  protected serviceTubCleanMaintenance: Service | undefined;

  constructor(
    platform: LGThinQHomebridgePlatform,
    accessory: PlatformAccessory<AccessoryContext>,
    logger: Logger,
  ) {
    super(platform, accessory, logger);

    const {
      Service: {
        OccupancySensor,
        LockMechanism,
        Valve,
      },
      Characteristic,
      Characteristic: {
        LockCurrentState,
      },
    } = this.platform;

    const device: Device = accessory.context.device;

    this.serviceWasherDryer = this.getOrCreateService(Valve, device.name, device.name);
    this.serviceWasherDryer.getCharacteristic(Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .updateValue(Characteristic.Active.INACTIVE);
    this.serviceWasherDryer.setCharacteristic(Characteristic.Name, device.name);
    this.serviceWasherDryer.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.WATER_FAUCET);
    this.serviceWasherDryer.setCharacteristic(Characteristic.InUse, Characteristic.InUse.NOT_IN_USE);
    this.serviceWasherDryer.getCharacteristic(Characteristic.RemainingDuration)
      .setProps({ maxValue: ONE_DAY_IN_SECONDS })
      .updateValue(0);

    // only thinq2 support door lock status
    const stateRoot = this.stateRoot;
    const hasDoorLock = !!this.config.washer_door_lock && device.platform === PlatformType.ThinQ2
      && !!stateRoot && ('doorLock' in stateRoot);
    this.serviceDoorLock = this.ensureService(LockMechanism, device.name + ' - Door', hasDoorLock, 'Door');
    if (this.serviceDoorLock) {
      this.serviceDoorLock.getCharacteristic(Characteristic.LockCurrentState)
        .updateValue(LockCurrentState.UNSECURED)
        .setProps({
          minValue: 0,
          maxValue: 3,
          validValues: [LockCurrentState.UNSECURED, LockCurrentState.SECURED],
        });
      this.serviceDoorLock.getCharacteristic(Characteristic.LockTargetState)
        .onSet(this.setActive.bind(this))
        .updateValue(Characteristic.LockTargetState.UNSECURED);
    }

    this.serviceEventFinished = this.ensureService(
      OccupancySensor, 'Program Finished', this.config.washer_trigger as boolean, 'Program Finished',
    );
    if (this.serviceEventFinished) {
      this.serviceEventFinished.updateCharacteristic(
        Characteristic.OccupancyDetected, Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
      );
    }

    // tub clean coach
    this.serviceTubCleanMaintenance = this.ensureService(
      OccupancySensor, 'Tub Clean Coach', this.config.washer_tub_clean as boolean, 'Tub Clean Coach',
    );
    if (this.serviceTubCleanMaintenance) {
      this.serviceTubCleanMaintenance.updateCharacteristic(
        Characteristic.OccupancyDetected, Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
      );
      this.serviceTubCleanMaintenance.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
        .setProps({
          validValues: [0], // single press
        });
    }

    this.lastState = stateRoot ? this.Status.state || undefined : undefined;
  }

  /** Snapshot key holding the washer state ('washerDryer', or 'washer' for WASH_TOWER_2) */
  protected get stateRootKey(): string {
    return DeviceRegistry.getSnapshotKey(this.accessory.context.device.type) ?? 'washerDryer';
  }

  /** The (merged) washer state object from the snapshot, if present */
  protected get stateRoot(): Record<string, unknown> | undefined {
    const root = this.accessory.context.device.snapshot?.[this.stateRootKey];
    return root && typeof root === 'object' ? root as Record<string, unknown> : undefined;
  }

  public get Status() {
    return this.getStatus(WasherDryerStatus);
  }

  async setActive(value: CharacteristicValue) {
    void value;
    // do nothing, revert back
    this.updateAccessoryCharacteristic(this.accessory.context.device);
  }

  public updateAccessoryCharacteristic(device: Device) {
    super.updateAccessoryCharacteristic(device);

    const {
      Characteristic,
    } = this.platform;
    this.serviceWasherDryer?.updateCharacteristic(Characteristic.Active, this.Status.isRunning ? 1 : 0);
    this.serviceWasherDryer?.updateCharacteristic(Characteristic.InUse, this.Status.isRunning ? 1 : 0);
    const prevRemainDuration = this.serviceWasherDryer?.getCharacteristic(Characteristic.RemainingDuration)?.value;
    if (this.Status.remainDuration !== prevRemainDuration) {
      this.serviceWasherDryer?.updateCharacteristic(Characteristic.RemainingDuration, this.Status.remainDuration);
    }

    this.serviceWasherDryer?.updateCharacteristic(Characteristic.StatusFault,
      this.Status.isError ? Characteristic.StatusFault.GENERAL_FAULT : Characteristic.StatusFault.NO_FAULT);

    if (this.config.washer_door_lock && this.serviceDoorLock) {
      this.serviceDoorLock.updateCharacteristic(Characteristic.LockCurrentState,
        this.Status.isDoorLocked ? Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED);
      this.serviceDoorLock.updateCharacteristic(Characteristic.LockTargetState, this.Status.isDoorLocked ? 1 : 0);
    }
  }

  public update(snapshot: Record<string, unknown>) {
    super.update(snapshot);

    const delta = snapshot[this.stateRootKey] as Record<string, unknown> | undefined;
    if (!delta || typeof delta !== 'object') {
      return;
    }

    const {
      Characteristic: {
        OccupancyDetected,
      },
    } = this.platform;

    // use the merged status so sparse MQTT deltas (e.g. only `state`) are handled
    const status = this.Status;
    const state = status.state;
    const prevState = this.lastState;
    if (state) {
      this.lastState = state;
    }

    if (this.config.washer_trigger as boolean && this.serviceEventFinished) {
      // detect if washer program is done: transition from a running state to END/COOLDOWN
      const enteredEnd = ['END', 'COOLDOWN'].includes(state)
        && prevState !== undefined && prevState !== state && !NOT_RUNNING_STATUS.includes(prevState);
      if (enteredEnd || (this.isRunning && !status.isRunning)) {
        this.serviceEventFinished.updateCharacteristic(OccupancyDetected, OccupancyDetected.OCCUPANCY_DETECTED);
        this.isRunning = false; // marked device as not running

        // turn it off after 10 minute
        setTimeout(() => {
          this.serviceEventFinished?.updateCharacteristic(OccupancyDetected, OccupancyDetected.OCCUPANCY_NOT_DETECTED);
        }, TEN_MINUTES_MS);
      }

      // detect if washer program is start
      if (status.isRunning && !this.isRunning) {
        this.serviceEventFinished.updateCharacteristic(OccupancyDetected, OccupancyDetected.OCCUPANCY_NOT_DETECTED);
        this.isRunning = true;
      }
    }

    if ('TCLCount' in delta && this.serviceTubCleanMaintenance) {
      // detect if tub clean coach counter is reached
      if (status.TCLCount >= TCL_MAINTENANCE_THRESHOLD) {
        this.serviceTubCleanMaintenance.updateCharacteristic(OccupancyDetected, OccupancyDetected.OCCUPANCY_DETECTED);
      } else {
        // reset tub clean coach trigger flag
        this.serviceTubCleanMaintenance.updateCharacteristic(OccupancyDetected, OccupancyDetected.OCCUPANCY_NOT_DETECTED);
      }
    }
  }
}

export class WasherDryerStatus extends BaseStatus {
  public get state() {
    return this.getString('state');
  }

  public get isPowerOn() {
    return !['POWEROFF', 'POWERFAIL'].includes(this.getString('state'));
  }

  public get isRunning() {
    return this.isPowerOn && !NOT_RUNNING_STATUS.includes(this.getString('state'));
  }

  public get isError() {
    return this.getString('state') === 'ERROR';
  }

  public get isRemoteStartEnable() {
    return this.getString('remoteStart') === this.deviceModel.lookupMonitorName('remoteStart', '@CP_ON_EN_W');
  }

  public get isDoorLocked() {
    const current = this.deviceModel.lookupMonitorName('doorLock', '@CP_ON_EN_W');
    if (current === null) {
      return this.getString('doorLock') === 'DOORLOCK_ON';
    }

    return this.getString('doorLock') === current;
  }

  public get remainDuration() {
    const remainTimeHour = this.getInt('remainTimeHour');
    const remainTimeMinute = this.getInt('remainTimeMinute');

    let remainingDuration = 0;
    if (this.isRunning) {
      remainingDuration = toSeconds(remainTimeHour, remainTimeMinute);
    }

    return remainingDuration;
  }

  public get TCLCount() {
    return Math.min(this.getInt('TCLCount'), TCL_MAINTENANCE_THRESHOLD);
  }
}
