import type { DeviceModel } from '../../models/DeviceModel.js';
import { safeParseInt } from '../helper.js';

export default function HoodState(deviceModel: DeviceModel, decodedMonitor: Record<string, unknown>) {
  return {
    hoodState: {
      'ventMode': deviceModel.enumName('VentMode', String(decodedMonitor.VentMode)),
      'error': deviceModel.enumName('Error', String(decodedMonitor.VentMode)),
      'ventLevel': safeParseInt(decodedMonitor.VentLevel),
      'lampSet': decodedMonitor.LampSet,
      'remainTimeMinute': safeParseInt(decodedMonitor.TimerMin),
      'ventSet': decodedMonitor.VentSet,
      'hoodFotaEnable': safeParseInt(decodedMonitor.FOTAEnable) ? 'ENABLE' : 'DISABLE',
      'remainTimeSecond': safeParseInt(decodedMonitor.TimerSec),
      'childLock': safeParseInt(decodedMonitor.ChildLock) ? 'ENABLE' : 'DISABLE',
      'standyMode': safeParseInt(decodedMonitor.StandyMode) ? 'ENABLE' : 'DISABLE',
      'lampLevel': safeParseInt(decodedMonitor.LampLevel),
      'hoodState': safeParseInt(decodedMonitor.HoodState) ? 'USING' : 'INIT',
    },
  };
}
