/**
 * HomeKit service wiring shared by the Oven, Microwave and Dishwasher accessories.
 */
import type { Characteristic, CharacteristicValue, Logger, PlatformAccessory, Service, WithUUID } from 'homebridge';
import { HAPStatus } from 'homebridge';
import type { LGThinQHomebridgePlatform } from '../../platform.js';
import type { Device } from '../../models/Device.js';
import { normalizeBoolean, normalizeNumber } from '../../helper.js';
import { ONE_SECOND_MS } from '../../lib/constants.js';

type ServiceType = WithUUID<typeof Service>;
type CharacteristicType = WithUUID<new () => Characteristic>;

/** Look a service up by its subtype (stable across renames) or create it. */
export function ensureService(accessory: PlatformAccessory, type: ServiceType, name: string, subtype: string): Service {
  return accessory.getServiceById(type, subtype) || accessory.addService(type, name, subtype);
}

export function setConfiguredName(platform: LGThinQHomebridgePlatform, service: Service, name: string): void {
  service.addOptionalCharacteristic(platform.Characteristic.ConfiguredName);
  service.setCharacteristic(platform.Characteristic.ConfiguredName, name);
}

/** Push a characteristic value only when it differs from the cached one. */
export function updateIfChanged(service: Service, characteristic: CharacteristicType, value: CharacteristicValue): void {
  if (service.getCharacteristic(characteristic).value !== value) {
    service.updateCharacteristic(characteristic, value);
  }
}

/** Update an InputSource's target/current visibility, only notifying HomeKit when it changed. */
export function setVisibility(platform: LGThinQHomebridgePlatform, service: Service, shown: boolean): void {
  const { TargetVisibilityState, CurrentVisibilityState } = platform.Characteristic;
  updateIfChanged(service, TargetVisibilityState, shown ? TargetVisibilityState.SHOWN : TargetVisibilityState.HIDDEN);
  updateIfChanged(service, CurrentVisibilityState, shown ? CurrentVisibilityState.SHOWN : CurrentVisibilityState.HIDDEN);
}

/**
 * Get or create the Television service used as the "status board". It is looked up by its
 * subtype so renaming the device in the config does not create a duplicate-subtype service.
 */
export function createTelevision(
  platform: LGThinQHomebridgePlatform,
  accessory: PlatformAccessory,
  name: string,
  subtype: string,
  configuredName: string,
): Service {
  const { Characteristic } = platform;
  const service = ensureService(accessory, platform.Service.Television, name, subtype);
  service.setCharacteristic(Characteristic.ConfiguredName, configuredName);
  service.setPrimaryService(false);
  service.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
  return service;
}

export interface InputSourceOptions {
  name: string;
  subtype: string;
  identifier: number;
  shown: boolean;
  /** Pure getter returning the current ConfiguredName. */
  getName: () => string;
}

/** Get or create an InputSource linked to the given Television service. */
export function createInputSource(
  platform: LGThinQHomebridgePlatform,
  accessory: PlatformAccessory,
  television: Service,
  options: InputSourceOptions,
): Service {
  const { Characteristic, Service: Services } = platform;
  let service = accessory.getServiceById(Services.InputSource, options.subtype);
  if (!service) {
    service = accessory.addService(Services.InputSource, options.name, options.subtype)
      .setCharacteristic(Characteristic.Identifier, options.identifier)
      .setCharacteristic(Characteristic.ConfiguredName, options.getName())
      .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
      .setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.APPLICATION)
      .setCharacteristic(Characteristic.TargetVisibilityState,
        options.shown ? Characteristic.TargetVisibilityState.SHOWN : Characteristic.TargetVisibilityState.HIDDEN)
      .setCharacteristic(Characteristic.CurrentVisibilityState,
        options.shown ? Characteristic.CurrentVisibilityState.SHOWN : Characteristic.CurrentVisibilityState.HIDDEN);
  }
  service.getCharacteristic(Characteristic.ConfiguredName).onGet(() => options.getName());
  television.addLinkedService(service);
  return service;
}

/** Get or create a Switch with a ConfiguredName. */
export function createSwitch(platform: LGThinQHomebridgePlatform, accessory: PlatformAccessory, name: string, subtype: string): Service {
  const service = ensureService(accessory, platform.Service.Switch, name, subtype);
  setConfiguredName(platform, service, name);
  return service;
}

/**
 * Get or create a "mode" switch: its On state reflects `isSelected()` and turning it on calls `onSelect`.
 */
export function createModeSwitch(
  platform: LGThinQHomebridgePlatform,
  accessory: PlatformAccessory,
  name: string,
  subtype: string,
  isSelected: () => boolean,
  onSelect: (on: boolean) => void,
): Service {
  const service = createSwitch(platform, accessory, name, subtype);
  service.getCharacteristic(platform.Characteristic.On)
    .onGet(() => isSelected())
    .onSet((value) => onSelect(normalizeBoolean(value)));
  return service;
}

/** Turn a momentary (button-like) switch back off after a short delay. */
export function resetMomentarySwitch(platform: LGThinQHomebridgePlatform, service: Service, ms: number = ONE_SECOND_MS): void {
  setTimeout(() => {
    service.updateCharacteristic(platform.Characteristic.On, false);
  }, ms);
}

export interface DurationValveOptions {
  name: string;
  subtype: string;
  primary?: boolean;
  /** maxValue of RemainingDuration. */
  maxRemaining: number;
  /** maxValue of SetDuration (defaults to maxRemaining). */
  maxSetDuration?: number;
  setDurationStep?: number;
  remaining: () => number;
  setDuration: () => number;
  onActiveSet: (active: boolean) => Promise<void>;
  onSetDuration: (seconds: number) => void;
}

/** Get or create a Valve used as a countdown (cook time / kitchen timer). */
export function createDurationValve(
  platform: LGThinQHomebridgePlatform,
  accessory: PlatformAccessory,
  logger: Logger,
  options: DurationValveOptions,
): Service {
  const { Characteristic } = platform;
  const service = ensureService(accessory, platform.Service.Valve, options.name, options.subtype);
  if (options.primary) {
    service.setPrimaryService(true);
  }
  service.setCharacteristic(Characteristic.Name, options.name);
  setConfiguredName(platform, service, options.name);
  service.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.IRRIGATION);
  service.getCharacteristic(Characteristic.Active)
    .onGet(() => (options.remaining() !== 0 ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE))
    .onSet(async (value) => {
      await options.onActiveSet(normalizeBoolean(value));
    });
  service.setCharacteristic(Characteristic.InUse,
    options.remaining() > 0 ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
  service.getCharacteristic(Characteristic.RemainingDuration)
    .setProps({ maxValue: options.maxRemaining })
    .onGet(() => options.remaining());
  const setDurationProps: { maxValue: number; minStep?: number } = { maxValue: options.maxSetDuration ?? options.maxRemaining };
  if (options.setDurationStep !== undefined) {
    setDurationProps.minStep = options.setDurationStep;
  }
  service.getCharacteristic(Characteristic.SetDuration)
    .setProps(setDurationProps)
    .onGet(() => options.setDuration())
    .onSet((value) => {
      const seconds = normalizeNumber(value);
      if (seconds === null) {
        logger.error(options.name + ': SetDuration is not a number');
        return;
      }
      options.onSetDuration(seconds);
    });
  return service;
}

/**
 * Send a ThinQ v2 `Set` control command and surface any failure to HomeKit as
 * SERVICE_COMMUNICATION_FAILURE (so the Home app shows "No Response" instead of silently lying).
 */
export async function sendControlCommand(
  platform: LGThinQHomebridgePlatform,
  device: Device,
  logger: Logger,
  ctrlKey: string,
  dataSetList: Record<string, unknown>,
): Promise<void> {
  let accepted = false;
  try {
    const result = await platform.ThinQ?.deviceControl(device.id, {
      dataKey: null,
      dataValue: null,
      dataSetList,
      dataGetList: null,
    }, 'Set', ctrlKey);
    accepted = !!result;
    if (!accepted) {
      logger.error(`[${device.name}] ${ctrlKey} command was not accepted by the device`);
    }
  } catch (error) {
    logger.error(`[${device.name}] ${ctrlKey} command failed:`, error);
  }
  if (!accepted) {
    throw new platform.api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
}
