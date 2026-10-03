/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Minimal in-memory HAP mocks for constructing device handlers in unit tests.
 */
import { vi } from 'vitest';

type Handler = (...args: any[]) => any;

const CONSTANTS: Record<string, Record<string, number>> = {
  Active: { INACTIVE: 0, ACTIVE: 1 },
  InUse: { NOT_IN_USE: 0, IN_USE: 1 },
  ValveType: { GENERIC_VALVE: 0, IRRIGATION: 1 },
  TargetVisibilityState: { SHOWN: 0, HIDDEN: 1 },
  CurrentVisibilityState: { SHOWN: 0, HIDDEN: 1 },
  IsConfigured: { NOT_CONFIGURED: 0, CONFIGURED: 1 },
  InputSourceType: { OTHER: 0, APPLICATION: 10 },
  SleepDiscoveryMode: { NOT_DISCOVERABLE: 0, ALWAYS_DISCOVERABLE: 1 },
  TargetHeatingCoolingState: { OFF: 0, HEAT: 1, COOL: 2, AUTO: 3 },
  CurrentHeatingCoolingState: { OFF: 0, HEAT: 1, COOL: 2 },
  TemperatureDisplayUnits: { CELSIUS: 0, FAHRENHEIT: 1 },
  ContactSensorState: { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 },
  OccupancyDetected: { OCCUPANCY_NOT_DETECTED: 0, OCCUPANCY_DETECTED: 1 },
};

function typeProxy(): Record<string, any> {
  const cache = new Map<string, any>();
  return new Proxy({}, {
    get(_target, prop: string) {
      if (!cache.has(prop)) {
        cache.set(prop, { UUID: prop, typeName: prop, ...(CONSTANTS[prop] ?? {}) });
      }
      return cache.get(prop);
    },
  });
}

export class MockCharacteristic {
  public value: unknown = null;
  public getHandler?: Handler;
  public setHandler?: Handler;
  public props: Record<string, unknown> = {};

  onGet(fn: Handler) {
    this.getHandler = fn;
    return this;
  }

  onSet(fn: Handler) {
    this.setHandler = fn;
    return this;
  }

  setProps(props: Record<string, unknown>) {
    this.props = { ...this.props, ...props };
    return this;
  }

  updateValue(value: unknown) {
    this.value = value;
    return this;
  }
}

export class MockService {
  public characteristics = new Map<string, MockCharacteristic>();
  /** Every updateCharacteristic call, in order. */
  public updates: { name: string; value: unknown }[] = [];
  public linked: MockService[] = [];

  constructor(public type: { UUID: string }, public displayName: string, public subtype?: string) {}

  getCharacteristic(type: { typeName: string }) {
    let characteristic = this.characteristics.get(type.typeName);
    if (!characteristic) {
      characteristic = new MockCharacteristic();
      this.characteristics.set(type.typeName, characteristic);
    }
    return characteristic;
  }

  setCharacteristic(type: { typeName: string }, value: unknown) {
    this.getCharacteristic(type).value = value;
    return this;
  }

  updateCharacteristic(type: { typeName: string }, value: unknown) {
    this.getCharacteristic(type).value = value;
    this.updates.push({ name: type.typeName, value });
    return this;
  }

  value(name: string) {
    return this.characteristics.get(name)?.value;
  }

  addOptionalCharacteristic() {
    return undefined;
  }

  setPrimaryService() {
    return undefined;
  }

  addLinkedService(service: MockService) {
    this.linked.push(service);
  }
}

export class MockAccessory {
  public services: MockService[] = [];

  constructor(public context: { device: any }) {}

  getService(nameOrType: string | { UUID: string }) {
    if (typeof nameOrType === 'string') {
      return this.services.find(s => s.displayName === nameOrType || s.subtype === nameOrType);
    }
    return this.services.find(s => s.type.UUID === nameOrType.UUID);
  }

  getServiceById(type: { UUID: string }, subtype: string) {
    return this.services.find(s => s.type.UUID === type.UUID && s.subtype === subtype);
  }

  addService(type: { UUID: string }, name: string, subtype?: string) {
    if (subtype && this.getServiceById(type, subtype)) {
      throw new Error(`Cannot add a Service with the same UUID '${type.UUID}' and subtype '${subtype}'`);
    }
    const service = new MockService(type, name, subtype);
    this.services.push(service);
    return service;
  }

  removeService(service: MockService) {
    this.services = this.services.filter(s => s !== service);
  }

  byId(type: string, subtype: string) {
    const service = this.services.find(s => s.type.UUID === type && s.subtype === subtype);
    if (!service) {
      throw new Error(`no ${type} service with subtype ${subtype}`);
    }
    return service;
  }
}

export class MockHapStatusError extends Error {
  constructor(public hapStatus: number) {
    super('HapStatusError ' + hapStatus);
  }
}

export function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
}

export function makeDevice(type: string, snapshot: Record<string, unknown>, lookupMonitorName: (k: string, v: string) => string | null = () => null) {
  return {
    id: 'device-1',
    name: 'Test ' + type,
    type,
    model: 'MODEL',
    salesModel: 'SALES',
    serialNumber: 'SN',
    data: { snapshot },
    get snapshot() {
      return this.data.snapshot;
    },
    deviceModel: { lookupMonitorName },
  };
}

export function makePlatform(deviceConfig: Record<string, unknown> = {}) {
  const logger = makeLogger();
  const deviceControl = vi.fn().mockResolvedValue(true);
  const platform = {
    Service: typeProxy(),
    Characteristic: typeProxy(),
    config: { devices: [{ id: 'device-1', ...deviceConfig }] },
    api: { hap: { HapStatusError: MockHapStatusError } },
    ThinQ: { deviceControl },
    log: logger,
  };
  return { platform, logger, deviceControl };
}
