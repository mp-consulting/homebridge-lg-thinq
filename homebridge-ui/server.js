import { API } from '../dist/api/API.js';
import { Auth } from '../dist/api/Auth.js';
import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';
import { DeviceType } from '../dist/lib/constants.js';

/**
 * LG ThinQ Plugin UI Server
 */
class LGThinQUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    // Register request handlers
    this.onRequest('/login-by-user-pass', this.handleLogin.bind(this));
    this.onRequest('/get-all-devices', this.handleGetDevices.bind(this));
    this.onRequest('/restart', this.handleRestart.bind(this));

    // Signal ready
    this.ready();
  }

  /**
   * Validate required payload fields
   */
  validate(payload, fields) {
    const missing = fields.filter(f => !payload[f]);
    if (missing.length > 0) {
      throw new RequestError(`Missing required fields: ${missing.join(', ')}`, { status: 400 });
    }
  }

  /**
   * Handle login request
   */
  async handleLogin(payload) {
    this.validate(payload, ['username', 'password', 'country', 'language']);

    try {
      const api = new API(payload.country, payload.language);
      const gateway = await api.gateway();
      const auth = new Auth(gateway);
      const session = await auth.login(payload.username, payload.password);

      return {
        success: true,
        token: session.refreshToken,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message || 'Login failed',
      };
    }
  }

  /**
   * Handle get devices request
   */
  async handleGetDevices(payload) {
    this.validate(payload, ['refresh_token', 'country', 'language']);

    try {
      const api = new API(payload.country, payload.language);
      api.setRefreshToken(payload.refresh_token);
      await api.ready();

      const deviceList = await api.getListDevices();

      return {
        success: true,
        devices: deviceList.map(device => ({
          id: device.deviceId,
          name: device.alias,
          type: DeviceType[device.deviceType] || device.deviceType,
          online: device.online !== false,
        })),
      };
    } catch (err) {
      return {
        success: false,
        error: err.message || 'Failed to get devices',
      };
    }
  }

  /**
   * Handle restart request
   */
  async handleRestart() {
    try {
      this.pushEvent('restart', {});
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err.message || 'Failed to restart',
      };
    }
  }
}

// Start the server
(() => new LGThinQUiServer())();
