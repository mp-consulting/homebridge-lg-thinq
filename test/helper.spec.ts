import { vi } from 'vitest';
import { Helper, fToC, cToF } from '../src/helper.js';
import type { Device } from '../src/models/Device.js';
import { Categories } from 'homebridge';
import { PlatformType } from '../src/lib/constants.js';

// Mock dependencies
vi.mock('homebridge', () => ({
  Categories: {
    OTHER: 1,
    AIR_PURIFIER: 19,
    AIR_CONDITIONER: 21,
    AIR_DEHUMIDIFIER: 23,
  },
  HAPStatus: { SUCCESS: 0 },
}));
vi.mock('../src/models/Device');
vi.mock('../src/lib/constants', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    PlatformType: {
      ThinQ1: 'thinq1',
      ThinQ2: 'thinq2',
    },
  };
});

// Test suite for Helper class and utility functions
describe('Helper', () => {
  describe('make', () => {
    it('should return the correct class for ThinQ2 devices', async () => {
      const mockDevice = { platform: PlatformType.ThinQ2, type: 'AC' } as Device;
      const result = await Helper.make(mockDevice);
      expect(result).toBeDefined();
    });

    it('should return null for unknown device types', async () => {
      const mockDevice = { platform: PlatformType.ThinQ2, type: 'UNKNOWN' } as Device;
      const result = await Helper.make(mockDevice);
      expect(result).toBeNull();
    });

    it('should return null for unsupported platform types', async () => {
      const mockDevice = { platform: 'UnsupportedPlatform', type: 'UNKNOWN' } as Device;
      const result = await Helper.make(mockDevice);
      expect(result).toBeNull();
    });
  });

  describe('category', () => {
    it('should return the correct category for known device types', () => {
      const mockDevice = { type: 'AIR_PURIFIER' } as Device;
      const result = Helper.category(mockDevice);
      expect(result).toBe(Categories.AIR_PURIFIER);
    });

    it('should return Categories.OTHER for unknown device types', () => {
      const mockDevice = { type: 'UNKNOWN' } as Device;
      const result = Helper.category(mockDevice);
      expect(result).toBe(Categories.OTHER);
    });

    it('should return Categories.AIR_CONDITIONER for AC device type', () => {
      const mockDevice = { type: 'AC' } as Device;
      const result = Helper.category(mockDevice);
      expect(result).toBe(Categories.AIR_CONDITIONER);
    });
  });
});

describe('Utility functions', () => {

  describe('fToC', () => {
    it('should convert Fahrenheit to Celsius', () => {
      expect(fToC(32)).toBe(0);
      expect(fToC(212)).toBe(100);
    });

    it('should handle negative Fahrenheit values', () => {
      expect(fToC(-40)).toBe(-40);
    });
  });

  describe('cToF', () => {
    it('should convert Celsius to Fahrenheit', () => {
      expect(cToF(0)).toBe(32);
      expect(cToF(100)).toBe(212);
    });

    it('should handle negative Celsius values', () => {
      expect(cToF(-40)).toBe(-40);
    });
  });
});
