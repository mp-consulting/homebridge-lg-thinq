export const GATEWAY_URL = 'https://route.lgthinq.com:46030/v1/service/application/gateway-uri';
export const SVC_CODE = 'SVC202';
export const CLIENT_ID = 'LGAO221A02';
export const OAUTH_SECRET_KEY = 'c053c2a6ddeb7ad97cb0eed0dcb31cf8';
export const OAUTH_CLIENT_KEY = 'LGAO722A02';
export const API_KEY = 'VGhpblEyLjAgU0VSVklDRQ==';
export const API_CLIENT_ID = 'c713ea8e50f657534ff8b9d373dfebfc2ed70b88285c26b8ade49868c0b164d9';

export const APPLICATION_KEY = '6V1V8H2BN5P9ZQGOI5DAQ92YZBDO3EK9'; // for spx login

export enum PlatformType {
  ThinQ1 = 'thinq1',
  ThinQ2 = 'thinq2',
}

export enum DeviceType {
  REFRIGERATOR = 101,
  KIMCHI_REFRIGERATOR = 102,
  WATER_PURIFIER = 103,
  WASHER = 201,
  WASHER_NEW = 221,
  WASH_TOWER = 222,
  WASH_TOWER_2 = 223,
  DRYER = 202,
  STYLER = 203,
  DISHWASHER = 204,
  OVEN = 301,
  MICROWAVE = 302,
  COOKTOP = 303,
  HOOD = 304,
  AC = 401, // Includes heat pumps, etc., possibly all HVAC devices.
  AIR_PURIFIER = 402,
  DEHUMIDIFIER = 403,
  ROBOT_KING = 501, // This is Robotic vacuum cleaner
  TV = 701,
  BOILER = 801,
  SPEAKER = 901,
  HOMEVU = 902,
  ARCH = 1001,
  MISSG = 3001,
  SENSOR = 3002,
  SOLAR_SENSOR = 3102,
  IOT_LIGHTING = 3003,
  IOT_MOTION_SENSOR = 3004,
  IOT_SMART_PLUG = 3005,
  IOT_DUST_SENSOR = 3006,
  EMS_AIR_STATION = 4001,
  AIR_SENSOR = 4003,
  PURICARE_AIR_DETECTOR = 4004,
  V2PHONE = 6001,
  HOMEROBOT = 9000,
  AERO_TOWER = 410,
}

/**
 * Device state constants
 */

// States that indicate the washer/dryer is not actively running
export const WASHER_NOT_RUNNING_STATUS = [
  'COOLDOWN', 'POWEROFF', 'POWERFAIL', 'INITIAL', 'PAUSE', 'AUDIBLE_DIAGNOSIS',
  'FIRMWARE', 'COURSE_DOWNLOAD', 'ERROR', 'END',
];

// States that indicate the styler is not actively running
export const STYLER_NOT_RUNNING_STATUS = [
  'POWEROFF', 'INITIAL', 'PAUSE', 'COMPLETE', 'ERROR', 'DIAGNOSIS',
  'RESERVED', 'SLEEP', 'FOTA',
];

/**
 * Model-specific feature lists for AirConditioner
 */
export const AC_MODEL_FEATURES = {
  jetMode: ['RAC_056905'],
  quietMode: ['WINF_056905'],
  energySaveMode: ['WINF_056905', 'RAC_056905'],
  airClean: ['RAC_056905'],
  /** Models that do NOT support the airState.mon.timeout command */
  noMonitorTimeout: ['RAC_056905'],
};

/**
 * Time constants in seconds
 */
export const ONE_DAY_IN_SECONDS = 86400;
export const TWELVE_HOURS_IN_SECONDS = ONE_DAY_IN_SECONDS / 2;
export const SIX_HOURS_IN_SECONDS = ONE_DAY_IN_SECONDS / 4;
export const ONE_HOUR_IN_SECONDS = 3600;
export const THIRTY_MINUTES_IN_SECONDS = 1800;

/**
 * Time constants in milliseconds
 */
export const REQUEST_TIMEOUT_MS = 60000;
export const RETRY_DELAY_MS = 2000;
export const MQTT_RETRY_DELAY_MS = 5000;
export const SHORT_POLL_INTERVAL_MS = 10000;
export const DEVICE_DISCOVERY_DELAY_MS = 30000;
export const TEN_MINUTES_MS = 600000;
export const SIX_MINUTES_MS = 360000;
export const TWO_MINUTES_MS = 120000;
export const ONE_MINUTE_MS = 60000;
export const TEN_SECONDS_MS = 10000;
export const ONE_POINT_FIVE_SECONDS_MS = 1500;
export const ONE_SECOND_MS = 1000;
export const HUNDRED_MS = 100;
export const ONE_HOUR_MS = 3600000;
export const DISHWASHER_STANDBY_INTERVAL_MS = 902500; // ~15 minutes

/**
 * Filter maintenance thresholds
 */
export const FILTER_CHANGE_THRESHOLD_PERCENT = 95;

/**
 * HomeKit temperature limits (in Celsius)
 * HomeKit enforces specific min/max values for temperature characteristics
 */
export const HOMEKIT_TEMP_MIN = 10;
export const HOMEKIT_TEMP_MAX = 38;

/**
 * Air Purifier operation modes
 */
export const AIR_PURIFIER_NORMAL_MODE = 14;
export const AIR_PURIFIER_AUTO_MODE = 16;

/**
 * Air Conditioner operation mode (used when opMode is undefined)
 */
export const UNDEFINED_OP_MODE = -1;

/**
 * Washer/Dryer maintenance thresholds
 */
export const TCL_MAINTENANCE_THRESHOLD = 30;
export const DRY_CYCLE_THRESHOLD = 3;

/**
 * Fan speed ranges
 */
export const FAN_SPEED_MIN = 2;
export const FAN_SPEED_MAX = 6;

/**
 * Humidity limits
 */
export const HUMIDITY_MAX = 100;
export const HUMIDITY_DIVISOR = 10;

/**
 * Energy consumption divisor
 */
export const ENERGY_CONSUMPTION_DIVISOR = 100;

/**
 * Rinse level percentages (for dishwasher)
 */
export const RINSE_LEVEL_EMPTY = 0;
export const RINSE_LEVEL_HALF = 50;
export const RINSE_LEVEL_FULL = 100;

/**
 * Lamp levels (for range hood and similar devices)
 */
export const LAMP_OFF = 0;
export const LAMP_LOW = 1;
export const LAMP_HIGH = 2;

/**
 * Name length limits (for HomeKit)
 */
export const MAX_NAME_LENGTH = 64;
export const TRUNCATED_NAME_LENGTH = 60;

/**
 * Time string extraction indices (ISO format)
 */
export const ISO_TIME_START_INDEX = 11;
export const ISO_TIME_LENGTH = 8;

/**
 * Swing mode values
 */
export const SWING_MODE_ON = '100';
export const SWING_MODE_OFF = '0';

/**
 * Monitor timeout value for AC devices
 */
export const AC_MONITOR_TIMEOUT_VALUE = '70';

/**
 * Input identifier bounds (for TV service)
 */
export const INPUT_ID_MIN = 1;
export const INPUT_ID_MAX = 7;
