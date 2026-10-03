import WasherDryer, { WasherDryerStatus } from './WasherDryer.js';

/**
 * new kind of wash tower
 * device type: 223
 *
 * The washer state is reported under `snapshot.washer` (registry snapshotKey 'washer'),
 * so the base WasherDryer logic works on it directly without rewriting the payload.
 */
export default class WasherDryer2 extends WasherDryer {
  protected get stateRootKey(): string {
    return 'washer';
  }

  public get Status() {
    return this.getStatus(WasherDryerStatus, 'washer');
  }
}
