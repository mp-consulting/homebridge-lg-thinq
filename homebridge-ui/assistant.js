import { registerAiRoutes } from '@mp-consulting/homebridge-ai-kit/plugin';

/**
 * LG ThinQ background the Assistant gets with every request from this plugin's
 * settings UI. Keep it short: it is sent with each prompt.
 */
export const THINQ_AI_CONTEXT = [
  'The plugin bridges LG ThinQ appliances (AC, air purifiers, refrigerators, washers, dryers, dishwashers,',
  'dehumidifiers, ovens, microwaves, range hoods, stylers) to HomeKit through the LG ThinQ cloud; there is no local',
  'control. ThinQ v2 devices get real-time updates over MQTT (AWS IoT); legacy ThinQ v1 devices are only added when',
  '"thinq1" is enabled and are polled every "refresh_interval" seconds. Authentication ("auth_mode"): "account" signs',
  'in with the LG account email and password; "token" uses a refresh token. Accounts that sign in to LG with Google,',
  'Apple or Facebook cannot use a password: they need a refresh token (the plugin\'s "thinq auth" CLI command or the',
  'Plugin Authorization wiki). The settings UI logs in with email and password once, then stores only the refresh',
  'token. "country" and "language" (e.g. US / en-US) must match the LG account region, or login and the device list',
  'fail. Errors: "LG rejected the sign-in" means wrong credentials or a social-login account; "Your account was',
  'already used to registered in ..." (LG code MS.001.03) means the account belongs to another country; resultCode',
  '0110 (ManualProcessNeeded) and "Open the LG ThinQ app and accept the new terms" mean the user must sign in to the',
  'LG ThinQ app and accept new agreements; 0102 is an expired token (the plugin refreshes it; HTTP 401/403 too);',
  '0106/0111 or 9999 (NotConnectedError) mean the device or the LG server is not reachable (the plugin retries',
  'discovery every 30 s); HTTP 429 / resultCode 9012 is LG rate limiting (requests pause 1 to 30 minutes; increase',
  'the refresh interval or use fewer ThinQ integrations); "Internal Server Error" or ECONN errors are LG outages.',
  'An appliance shown offline is not connected to LG\'s cloud (Wi-Fi, power, or removed from the ThinQ app). Never',
  'ask the user for their password, refresh token or API keys.',
].join(' ');

export const ASSISTANT_PLUGIN_NAME = '@mp-consulting/homebridge-lg-thinq';

/**
 * Adds the Assistant routes (/ai/status, /ai/explain, /ai/ask, /ai/config) to the
 * plugin UI server. The provider settings come from the shared `HomebridgeAiKit`
 * block in config.json; the key never reaches the browser.
 *
 * `options` is passed through to `registerAiRoutes` (tests inject a provider).
 */
export function registerAssistant(server, options = {}) {
  registerAiRoutes(server, {
    pluginName: ASSISTANT_PLUGIN_NAME,
    systemContext: THINQ_AI_CONTEXT,
    ...options,
  });
}
