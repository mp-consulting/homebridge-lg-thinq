import { LGThinQHomebridgePlatform } from './platform.js';
import { HAPStatus, Logger, PlatformAccessory, Service, WithUUID } from 'homebridge';
import { Device } from './lib/Device.js';
import { EventEmitter } from 'events';
import { DeviceRegistry } from './lib/DeviceRegistry.js';

type ServiceConstructor = WithUUID<typeof Service>;

export interface DeviceControlPayload {
  dataKey: string | null;
  dataValue: unknown;
  dataSetList?: Record<string, unknown> | null;
  dataGetList?: Record<string, unknown> | null;
}

export type AccessoryContext = {
  device: Device;
}

export class BaseDevice extends EventEmitter {
  /** Cached status instance */
  private _cachedStatus: unknown = null;
  /** Hash of last snapshot for cache invalidation */
  private _lastSnapshotVersion: number = 0;

  constructor(
    public readonly platform: LGThinQHomebridgePlatform,
    public readonly accessory: PlatformAccessory<AccessoryContext>,
    protected readonly logger: Logger,
  ) {
    super();

    const device: Device = accessory.context.device;
    const { AccessoryInformation } = this.platform.Service;
    const serviceAccessoryInformation = accessory.getService(AccessoryInformation) || accessory.addService(AccessoryInformation);

    // set accessory information
    serviceAccessoryInformation
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'LG')
      .setCharacteristic(this.platform.Characteristic.Model, device.salesModel || device.model || 'Unknown')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.config.serial_number || device.serialNumber || 'Unknown');
  }

  public updateAccessoryCharacteristic(device: Device) {
    this.accessory.context.device = device;
    // Increment version to invalidate status cache
    this._lastSnapshotVersion++;
  }

  public update(snapshot: any) {
    this.platform.log.debug('[' + this.accessory.context.device.name + '] Received snapshot: ', JSON.stringify(snapshot));
    this.accessory.context.device.data.snapshot = { ...this.accessory.context.device.snapshot, ...snapshot };
    this.updateAccessoryCharacteristic(this.accessory.context.device);
  }

  /**
   * Get device configuration merged with defaults from DeviceRegistry
   */
  public get config(): Record<string, any> {
    const deviceType = this.accessory.context.device.type;
    const defaults = DeviceRegistry.getConfigDefaults(deviceType);
    const userConfig = this.platform.config.devices?.find(
      (enabled: Record<string, any>) => enabled.id === this.accessory.context.device.id,
    ) || {};
    return { ...defaults, ...userConfig };
  }

  /**
   * Get a cached Status instance. Override in subclasses to provide typed status.
   * The cache is invalidated when updateAccessoryCharacteristic is called.
   *
   * @param StatusClass - The Status class constructor
   * @param snapshotKey - Key to access snapshot data (e.g., 'washerDryer', 'airState')
   * @returns Cached Status instance
   */
  protected getStatus<T>(
    StatusClass: new (data: any, model: any) => T,
    snapshotKey: string,
  ): T {
    const device = this.accessory.context.device;
    const currentVersion = this._lastSnapshotVersion;

    // Return cached status if snapshot hasn't changed
    if (this._cachedStatus && this._lastSnapshotVersion === currentVersion) {
      return this._cachedStatus as T;
    }

    // Create new status instance
    const snapshotData = device.snapshot?.[snapshotKey];
    this._cachedStatus = new StatusClass(snapshotData, device.deviceModel);

    return this._cachedStatus as T;
  }

  /**
   * Invalidate the status cache. Call this when the device state changes.
   */
  protected invalidateStatusCache(): void {
    this._lastSnapshotVersion++;
  }

  /**
   * Helper method to safely control a device with error handling.
   * Wraps ThinQ deviceControl with try/catch and returns success/failure.
   */
  protected async controlDevice(
    payload: DeviceControlPayload,
    onSuccess?: () => void,
  ): Promise<boolean> {
    const device = this.accessory.context.device;
    try {
      const result = await this.platform.ThinQ?.deviceControl(device.id, payload);
      if (result && onSuccess) {
        onSuccess();
      }
      return !!result;
    } catch (error) {
      this.logger.error(`[${device.name}] Device control failed:`, error);
      throw new this.platform.api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Simplified device control using dataKey and dataValue.
   * Automatically updates the local snapshot on success.
   *
   * @param dataKey - The data key path (e.g., 'airState.operation')
   * @param dataValue - The value to set
   * @param updateSnapshot - Whether to update local snapshot on success (default: true)
   * @returns Promise<boolean> indicating success
   */
  protected async setDeviceControl(
    dataKey: string,
    dataValue: unknown,
    updateSnapshot: boolean = true,
  ): Promise<boolean> {
    const device = this.accessory.context.device;

    try {
      const result = await this.platform.ThinQ?.deviceControl(device.id, {
        dataKey,
        dataValue,
      });

      if (result && updateSnapshot) {
        // Update local snapshot with the new value
        this.updateSnapshotValue(dataKey, dataValue);
        this.updateAccessoryCharacteristic(device);
      }

      return !!result;
    } catch (error) {
      this.logger.error(`[${device.name}] Failed to set ${dataKey}:`, error);
      throw new this.platform.api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Update a value in the local snapshot using a dot-notation path.
   *
   * @param path - Dot-notation path (e.g., 'airState.operation')
   * @param value - The value to set
   */
  protected updateSnapshotValue(path: string, value: unknown): void {
    const device = this.accessory.context.device;
    const keys = path.split('.');
    let obj: any = device.data.snapshot;

    // Navigate to the parent of the target key
    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in obj)) {
        obj[keys[i]] = {};
      }
      obj = obj[keys[i]];
    }

    // Set the final value
    obj[keys[keys.length - 1]] = value;
  }

  /**
   * Get or create a service with the given type and name.
   * Automatically adds ConfiguredName characteristic.
   */
  protected getOrCreateService(
    serviceType: ServiceConstructor,
    name: string,
    subType?: string,
  ): Service {
    const effectiveSubType = subType || name;
    const service = this.accessory.getService(effectiveSubType)
      || this.accessory.addService(serviceType, name, effectiveSubType);

    // Add ConfiguredName for better HomeKit display
    service.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
    service.updateCharacteristic(this.platform.Characteristic.ConfiguredName, name);

    return service;
  }

  /**
   * Conditionally create or remove a service based on a boolean flag.
   * Returns the service if enabled, undefined if disabled.
   */
  protected ensureService(
    serviceType: ServiceConstructor,
    name: string,
    enabled: boolean,
    subType?: string,
  ): Service | undefined {
    const existingService = subType
      ? this.accessory.getService(subType)
      : this.accessory.getService(serviceType);

    if (enabled) {
      if (!existingService) {
        return this.getOrCreateService(serviceType, name, subType);
      }
      return existingService;
    } else if (existingService) {
      this.accessory.removeService(existingService);
    }

    return undefined;
  }

  public static model(): string {
    return '';
  }
}
