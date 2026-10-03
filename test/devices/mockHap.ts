/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from 'vitest';
import { readFileSync } from 'fs';
import { Device } from '../../src/models/Device.js';
import { DeviceModel } from '../../src/models/DeviceModel.js';

/* Minimal HAP / Homebridge fakes shared by device tests. */

const CONSTANTS: Record<string, Record<string, number>> = {
  Active: { INACTIVE: 0, ACTIVE: 1 },
  CurrentHeaterCoolerState: { INACTIVE: 0, IDLE: 1, HEATING: 2, COOLING: 3 },
  TargetHeaterCoolerState: { AUTO: 0, HEAT: 1, COOL: 2 },
  SwingMode: { SWING_DISABLED: 0, SWING_ENABLED: 1 },
  TargetFanState: { MANUAL: 0, AUTO: 1 },
  CurrentFanState: { INACTIVE: 0, IDLE: 1, BLOWING_AIR: 2 },
  OccupancyDetected: { OCCUPANCY_NOT_DETECTED: 0, OCCUPANCY_DETECTED: 1 },
  LockCurrentState: { UNSECURED: 0, SECURED: 1 },
  LockTargetState: { UNSECURED: 0, SECURED: 1 },
  ValveType: { GENERIC_VALVE: 0, WATER_FAUCET: 3 },
  InUse: { NOT_IN_USE: 0, IN_USE: 1 },
  StatusFault: { NO_FAULT: 0, GENERAL_FAULT: 1 },
  FilterChangeIndication: { FILTER_OK: 0, CHANGE_FILTER: 1 },
};

const charTypes = new Map<string, Record<string, unknown>>();
export const Characteristic = new Proxy({}, {
  get(_t, name: string) {
    if (!charTypes.has(name)) {
      charTypes.set(name, { charName: name, ...(CONSTANTS[name] ?? {}) });
    }
    return charTypes.get(name);
  },
}) as any;

export class FakeCharacteristic {
  value: unknown = null;
  props: Record<string, unknown> = {};
  setHandler?: (v: unknown) => unknown;
  getHandler?: () => unknown;
  onSet(fn: (v: unknown) => unknown) {
    this.setHandler = fn; return this;
  }
  onGet(fn: () => unknown) {
    this.getHandler = fn; return this;
  }
  setProps(p: Record<string, unknown>) {
    Object.assign(this.props, p); return this;
  }
  updateValue(v: unknown) {
    this.value = v; return this;
  }
}

export class FakeService {
  chars = new Map<unknown, FakeCharacteristic>();
  linkedServices: FakeService[] = [];
  constructor(public type: unknown, public displayName: string, public subtype?: string) {}
  getCharacteristic(t: unknown) {
    if (!this.chars.has(t)) {
      this.chars.set(t, new FakeCharacteristic());
    }
    return this.chars.get(t)!;
  }
  updateCharacteristic(t: unknown, v: unknown) {
    this.getCharacteristic(t).updateValue(v); return this;
  }
  setCharacteristic(t: unknown, v: unknown) {
    return this.updateCharacteristic(t, v);
  }
  addOptionalCharacteristic() {}
  addLinkedService(s: FakeService) {
    if (!this.linkedServices.includes(s)) {
      this.linkedServices.push(s);
    }
  }
  removeLinkedService(s: FakeService) {
    const i = this.linkedServices.indexOf(s);
    if (i >= 0) {
      this.linkedServices.splice(i, 1);
    }
  }
}

const serviceTypes = new Map<string, unknown>();
export const Service = new Proxy({}, {
  get(_t, name: string) {
    if (!serviceTypes.has(name)) {
      serviceTypes.set(name, { serviceName: name });
    }
    return serviceTypes.get(name);
  },
}) as any;

export class FakeAccessory {
  services: FakeService[] = [];
  constructor(public context: { device: Device }) {}
  getService(arg: unknown) {
    if (typeof arg === 'string') {
      return this.services.find(s => s.subtype === arg || s.displayName === arg);
    }
    return this.services.find(s => s.type === arg);
  }
  addService(type: unknown, name?: string, subtype?: string) {
    const s = new FakeService(type, name ?? '', subtype);
    this.services.push(s);
    return s;
  }
  // mirrors HAP: removing a service also unlinks it everywhere
  removeService = vi.fn((s: FakeService) => {
    const i = this.services.indexOf(s);
    if (i >= 0) {
      this.services.splice(i, 1);
      this.services.forEach(other => other.removeLinkedService(s));
    }
  });
}

export class HapStatusError extends Error {
  constructor(public hapStatus: number) {
    super(`HAP status ${hapStatus}`);
  }
}

export function makePlatform(deviceConfig: Record<string, unknown>) {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    Service,
    Characteristic,
    customCharacteristics: { TotalConsumption: { charName: 'TotalConsumption' } },
    config: { devices: [deviceConfig] },
    log: logger,
    api: { hap: { HapStatusError, HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402, INVALID_VALUE_IN_REQUEST: -70410 } } },
    ThinQ: { deviceControl: vi.fn().mockResolvedValue(true), thinq1DeviceControl: vi.fn().mockResolvedValue({}) },
  } as any;
}

export const loadSample = (name: string) => JSON.parse(readFileSync(new URL(`../../sample/${name}`, import.meta.url), 'utf8'));

export function makeACDevice(overrides: Record<string, unknown> = {}) {
  const device = new Device({ ...loadSample('airconditioner.json'), snapshot: { ...loadSample('airconditioner-snapshot.json') }, ...overrides });
  device.deviceModel = new DeviceModel(loadSample('airconditioner-model.json'));
  return device;
}
