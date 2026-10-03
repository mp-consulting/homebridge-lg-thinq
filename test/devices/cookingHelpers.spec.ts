import {
  MICROWAVE_TEMP_LIMITS,
  OVEN_TEMP_LIMITS,
  burnerStatus,
  capitalize,
  clampCookTemp,
  durationUnit,
  enteredState,
  formatClock,
  formatDateTime,
  formatDuration,
  isFahrenheit,
  isNonZeroNumber,
  roundToHalf,
  sumTimeFields,
  sumTimeFieldsByPrefix,
  tempCtoF,
  tempFtoC,
  textExcludes,
  textIncludes,
  toCelsius,
  toNumber,
  truncateName,
} from '../../src/devices/cooking/helpers.js';

describe('cooking helpers', () => {
  describe('truncateName', () => {
    it.each([
      ['short', 'short'],
      ['x'.repeat(63), 'x'.repeat(63)],
      ['x'.repeat(64), 'x'.repeat(60) + '...'],
      ['y'.repeat(100), 'y'.repeat(60) + '...'],
    ])('truncates %#', (input, expected) => {
      expect(truncateName(input)).toBe(expected);
    });
  });

  describe('toNumber / isNonZeroNumber', () => {
    it.each([
      [5, 5], ['7', 7], [undefined, 0], [null, 0], ['', 0], ['abc', 0], [NaN, 0], [Infinity, 0],
    ])('toNumber(%s) = %s', (input, expected) => {
      expect(toNumber(input)).toBe(expected);
    });

    it.each([
      [1, true], [-3, true], [0, false], [undefined, false], ['5', false], [NaN, false],
    ])('isNonZeroNumber(%s) = %s', (input, expected) => {
      expect(isNonZeroNumber(input)).toBe(expected);
    });
  });

  describe('textIncludes / textExcludes', () => {
    it.each([
      ['DISABLE', 'DIS', true, false],
      ['ENABLE', 'DIS', false, true],
      [undefined, 'DIS', false, false],
      [42, 'DIS', false, false],
    ])('%s / %s', (value, needle, includes, excludes) => {
      expect(textIncludes(value, needle)).toBe(includes);
      expect(textExcludes(value, needle)).toBe(excludes);
    });
  });

  describe('sumTimeFields', () => {
    it.each([
      [[1, 2, 3], 3723],
      [[0, 5, undefined], 300],
      [[undefined, undefined, undefined], 0],
      [['1', '30', '15'], 5415],
      [[2, 'bad', 10], 7210],
    ] as [unknown[], number][])('sums %j to %i', ([h, m, s], expected) => {
      expect(sumTimeFields(h, m, s)).toBe(expected);
    });

    it('reads fields by prefix and ignores missing data', () => {
      expect(sumTimeFieldsByPrefix({ upperTimerHour: 1, upperTimerSecond: 5 }, 'upperTimer')).toBe(3605);
      expect(sumTimeFieldsByPrefix(undefined, 'upperTimer')).toBe(0);
      expect(sumTimeFieldsByPrefix({}, 'upperTimer')).toBe(0);
    });
  });

  describe('duration formatting', () => {
    it.each([
      [0, '0:00:00', 'Minutes'],
      [300, '0:05:00', 'Minutes'],
      [3600, '1:00:00', 'Hour'],
      [5400, '1:30:00', 'Hours'],
      [36000, '10:00:00', 'Hours'],
      [-5, '0:00:00', 'Minutes'],
    ])('formats %i seconds', (seconds, clock, unit) => {
      expect(formatClock(seconds)).toBe(clock);
      expect(durationUnit(seconds)).toBe(unit);
      expect(formatDuration(seconds)).toBe(clock + ' ' + unit);
    });
  });

  describe('formatDateTime', () => {
    it('includes weekday, date and time in long and short styles', () => {
      const date = new Date(Date.UTC(2024, 0, 1, 12, 0, 0));
      expect(formatDateTime(date)).toMatch(/2024/);
      expect(formatDateTime(date, 'short')).toMatch(/Jan/);
      expect(formatDateTime(date, 'long')).toMatch(/January/);
    });
  });

  describe('capitalize', () => {
    it.each([
      ['COOKING', 'Cooking'],
      ['air_fry', 'Air_fry'],
      ['', ''],
      [undefined, ''],
      [3, ''],
    ])('capitalize(%s) = %s', (input, expected) => {
      expect(capitalize(input)).toBe(expected);
    });
  });

  describe('temperature conversion', () => {
    it.each([
      [0, 32], [100, 212], [38, 100], [176.5, 350], [285, 545],
    ])('tempCtoF(%s) = %s', (c, f) => {
      expect(tempCtoF(c)).toBe(f);
    });

    it.each([
      [32, 0], [212, 100], [350, 176.5], [100, 38], [451, 233],
    ])('tempFtoC(%s) = %s', (f, c) => {
      expect(tempFtoC(f)).toBe(c);
    });

    it('rounds to half degrees and converts by unit', () => {
      expect(roundToHalf(20.26)).toBe(20.5);
      expect(roundToHalf(20.24)).toBe(20);
      expect(toCelsius(350, 'FAHRENHEIT')).toBe(176.5);
      expect(toCelsius(180.2, 'CELSIUS')).toBe(180);
      expect(toCelsius(180.2, undefined)).toBe(180);
      expect(isFahrenheit('FAHRENHEIT')).toBe(true);
      expect(isFahrenheit('CELSIUS')).toBe(false);
      expect(isFahrenheit(undefined)).toBe(false);
    });
  });

  describe('clampCookTemp', () => {
    it.each([
      // oven, Fahrenheit
      ['CONVECTION_BAKE', 'FAHRENHEIT', 200, 300],
      ['CONVECTION_ROST', 'FAHRENHEIT', 600, 550],
      ['CONVECTION_ROAST', 'FAHRENHEIT', 200, 300],
      ['AIR_FRY', 'FAHRENHEIT', 400, 400],
      ['BAKE', 'FAHRENHEIT', 100, 170],
      ['BAKE', 'FAHRENHEIT', 600, 550],
      ['AIR_SOUSVIDE', 'FAHRENHEIT', 50, 100],
      ['AIR_SOUSVIDE', 'FAHRENHEIT', 300, 205],
      // oven, Celsius
      ['CONVECTION_BAKE', 'CELSIUS', 100, 150],
      ['BAKE', 'CELSIUS', 50, 80],
      ['BAKE', 'CELSIUS', 300, 285],
      ['AIR_SOUSVIDE', 'CELSIUS', 20, 38],
      // regression: 40-379°C used to be forced down to 38
      ['AIR_SOUSVIDE', 'CELSIUS', 60, 60],
      ['AIR_SOUSVIDE', 'CELSIUS', 38, 38],
      ['AIR_SOUSVIDE', 'CELSIUS', 120, 96],
      // modes without limits are untouched
      ['WARM', 'CELSIUS', 0, 0],
      ['BROIL', 'FAHRENHEIT', 700, 700],
    ])('oven %s %s %i -> %i', (mode, unit, input, expected) => {
      expect(clampCookTemp(OVEN_TEMP_LIMITS, mode, unit, input)).toBe(expected);
    });

    it.each([
      ['COMBI_BAKE', 'FAHRENHEIT', 100, 250],
      ['OVEN', 'FAHRENHEIT', 500, 450],
      ['CONV_BAKE', 'CELSIUS', 100, 125],
      ['COMBI_ROAST', 'CELSIUS', 250, 230],
      ['DEHYDRATE', 'FAHRENHEIT', 50, 100],
      ['DEHYDRATE', 'CELSIUS', 100, 92],
      ['MICROWAVE', 'CELSIUS', 0, 0],
    ])('microwave %s %s %i -> %i', (mode, unit, input, expected) => {
      expect(clampCookTemp(MICROWAVE_TEMP_LIMITS, mode, unit, input)).toBe(expected);
    });

    it('treats an unknown unit as Celsius and non-finite input as the minimum', () => {
      expect(clampCookTemp(OVEN_TEMP_LIMITS, 'BAKE', undefined, 500)).toBe(285);
      expect(clampCookTemp(OVEN_TEMP_LIMITS, 'BAKE', 'FAHRENHEIT', NaN)).toBe(170);
    });
  });

  describe('burnerStatus', () => {
    const backLeft = { index: 2, label: 'Back Left' };

    it.each([
      [undefined, 'Back Left Burner Not in Use', false],
      [{}, 'Back Left Burner Not in Use', false],
      [{ cooktop2CooktopState: 'INIT' }, 'Back Left Burner Not in Use', false],
      [{ cooktop2CooktopState: 'ON' }, 'Back Left Burner is On', true],
      // regression: burner 2 used to read cooktop1 minute/second fields and produce NaN
      [{ cooktop2CooktopState: 'ON', cooktop2OperationTimeMinute: 5 }, 'Back Left Burner is On. Cooking for 0:05:00 Minutes', true],
      [
        { cooktop2CooktopState: 'ON', cooktop1OperationTimeMinute: 9, cooktop2OperationTimeHour: 1, cooktop2OperationTimeSecond: 30 },
        'Back Left Burner is On. Cooking for 1:00:30 Hours',
        true,
      ],
    ])('%j', (data, name, inUse) => {
      expect(burnerStatus(data as Record<string, unknown> | undefined, backLeft)).toEqual({ name, inUse });
    });
  });

  describe('enteredState', () => {
    it.each([
      [undefined, 'END', true],
      ['RUNNING', 'END', true],
      ['END', 'END', false],
      ['END', 'STANDBY', false],
      ['RUNNING', 'RUNNING', false],
    ])('%s -> %s = %s', (previous, current, expected) => {
      expect(enteredState(previous, current, 'END')).toBe(expected);
    });
  });
});
