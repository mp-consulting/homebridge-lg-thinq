import { BaseStatus } from '../../src/status/BaseStatus.js';
import type { DeviceModel } from '../../src/models/DeviceModel.js';

class FilterStatus extends BaseStatus {
  public get remaining() {
    return this.getFilterRemainingPercent('use', 'max');
  }

  public get legacy() {
    return this.getFilterLifePercent('use', 'max');
  }
}

const model = {} as DeviceModel;

describe('BaseStatus.getFilterRemainingPercent', () => {
  test.each([
    [{ use: 0, max: 1000 }, 100], // new filter
    [{ use: 250, max: 1000 }, 75],
    [{ use: 960, max: 1000 }, 4], // worn
    [{ use: 1000, max: 1000 }, 0],
    [{ use: 1500, max: 1000 }, 0], // over max -> clamped
    [{ use: -5, max: 1000 }, 100], // bogus negative usage
    [{ use: 100, max: 0 }, 0], // unknown max
    [{}, 0],
  ])('%j -> %s%%', (data, expected) => {
    const s = new FilterStatus(data, model);
    expect(s.remaining).toBe(expected);
    expect(s.legacy).toBe(expected);
  });
});
