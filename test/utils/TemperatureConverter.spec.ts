import { readFileSync } from 'fs';
import { TemperatureConverter, cToF, fToC, roundToHalf } from '../../src/utils/TemperatureConverter.js';
import { DeviceModel } from '../../src/models/DeviceModel.js';

const acModel = new DeviceModel(JSON.parse(readFileSync(new URL('../../sample/airconditioner-model.json', import.meta.url), 'utf8')));

describe('TemperatureConverter', () => {
  describe('Celsius mode', () => {
    const conv = new TemperatureConverter(false, acModel);
    test.each([18, 22, 22.5, 30])('passes %s through unchanged in both directions', (t) => {
      expect(conv.fromHomeKit(t)).toBe(t);
      expect(conv.toHomeKit(t)).toBe(t);
    });
  });

  describe('Fahrenheit mode with model tables', () => {
    const conv = new TemperatureConverter(true, acModel);

    // LG value (°C) -> °F per TempCelToFah -> HomeKit °C
    test.each([
      [18, 64, fToC(64)],
      [22, 72, fToC(72)],
      [22.5, 73, fToC(73)],
      [25, 77, fToC(77)],
      [26.5, 79, fToC(79)],
      [30, 86, fToC(86)],
    ])('toHomeKit(%s) -> %s°F -> %s°C', (lg, _f, expected) => {
      expect(conv.toHomeKit(lg)).toBe(expected);
    });

    // HomeKit °C -> °F -> LG °C per TempFahToCel
    test.each([
      [fToC(64), 18],
      [fToC(72), 22],
      [fToC(73), 22.5],
      [fToC(77), 25],
      [fToC(79), 26.5],
      [fToC(86), 30],
    ])('fromHomeKit(%s) -> %s', (hk, lg) => {
      expect(conv.fromHomeKit(hk)).toBe(lg);
    });

    test('round-trips every half degree from 16 to 30 °C', () => {
      for (let c = 16; c <= 30; c += 0.5) {
        const hk = conv.toHomeKit(c);
        // round-trip lands on the device value for the same whole °F
        const back = conv.fromHomeKit(hk);
        expect(conv.toHomeKit(back)).toBe(hk);
        expect(Math.abs(back - c)).toBeLessThanOrEqual(0.5);
      }
    });

    test('never treats the LG Celsius value as Fahrenheit (regression: fToC(22.5) = -5.3)', () => {
      expect(conv.toHomeKit(22.5)).toBeGreaterThan(20);
    });
  });

  describe('Fahrenheit mode without model tables (fallback)', () => {
    const conv = new TemperatureConverter(true);

    test.each([18, 22, 22.5, 25, 30])('toHomeKit(%s) keeps the value in Celsius', (c) => {
      expect(conv.toHomeKit(c)).toBe(fToC(cToF(c)));
      expect(Math.abs(conv.toHomeKit(c) - c)).toBeLessThan(0.5);
    });

    test.each([
      [fToC(72), 22],
      [fToC(73), 23],
      [22.5, 23], // 72.5 °F rounds to 73 °F -> 22.78 °C -> 23
      [25, 25],
    ])('fromHomeKit(%s) -> %s (Celsius, 0.5 steps)', (hk, lg) => {
      expect(conv.fromHomeKit(hk)).toBe(lg);
    });

    test('both directions agree', () => {
      for (let c = 16; c <= 30; c += 0.5) {
        const hk = conv.toHomeKit(c);
        expect(conv.toHomeKit(conv.fromHomeKit(hk))).toBe(hk);
      }
    });
  });

  test('uses fallback when lookup throws and logs a warning', () => {
    const warn = vi.fn();
    const model = { lookupMonitorValue: () => {
      throw new Error('boom');
    } } as unknown as DeviceModel;
    const conv = new TemperatureConverter(true, model, { warn } as never);
    expect(conv.toHomeKit(22)).toBe(fToC(72));
    expect(warn).toHaveBeenCalled();
  });

  test('roundToHalf', () => {
    expect(roundToHalf(22.2)).toBe(22);
    expect(roundToHalf(22.3)).toBe(22.5);
    expect(roundToHalf(22.8)).toBe(23);
  });

  test('useFahrenheit flag', () => {
    expect(new TemperatureConverter(true).useFahrenheit).toBe(true);
    expect(new TemperatureConverter(false).useFahrenheit).toBe(false);
  });
});
