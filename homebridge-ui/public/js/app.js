(async () => {
  'use strict';

  // State
  let credentials = { refresh_token: null, country: null, language: null };
  let devices = [];
  let selectedDevices = new Set();

  // DOM helper
  const $ = id => document.getElementById(id);
  const steps = { login: $('step-login'), devices: $('step-devices'), complete: $('step-complete') };

  // Constants
  const DEFAULT_COUNTRY = 'US';
  const DEFAULT_LANGUAGE = 'en-US';

  // Load existing config
  const pluginConfig = await homebridge.getPluginConfig();
  const config = pluginConfig[0] || {};

  // Initialize selected devices from config
  if (config.devices && Array.isArray(config.devices)) {
    config.devices.forEach(d => selectedDevices.add(d.id));
  }

  // Populate country select
  const populateCountrySelect = () => {
    const select = $('country_language');
    select.innerHTML = '';

    COUNTRIES.forEach(({ country, language, label }) => {
      const option = document.createElement('option');
      option.dataset.country = country;
      option.dataset.language = language;
      option.textContent = label;
      select.appendChild(option);
    });
  };

  // Find country option
  const findCountryOption = (country, language) => {
    const select = $('country_language');
    let option = select.querySelector(`option[data-country="${country}"][data-language="${language}"]`);
    if (!option) {
      option = select.querySelector(`option[data-country="${DEFAULT_COUNTRY}"][data-language="${DEFAULT_LANGUAGE}"]`);
    }
    return option;
  };

  // Pre-fill form from config
  const prefillForm = () => {
    if (config.username) $('username').value = config.username;
    if (config.password) $('password').value = config.password;
    if (config.thinq1) $('thinq1').checked = config.thinq1;
    if (config.username && config.password) $('rememberCredentials').checked = true;

    // Set country/language
    const country = config.country || DEFAULT_COUNTRY;
    const language = config.language || DEFAULT_LANGUAGE;
    const option = findCountryOption(country, language);
    if (option) option.selected = true;
  };

  // Show/hide step
  const showStep = step => {
    Object.entries(steps).forEach(([k, el]) => {
      el.classList.toggle('hidden', k !== step);
    });
  };

  // Escape HTML for XSS prevention
  const escapeHtml = text => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  // Toggle device selection
  const toggleDevice = (deviceId) => {
    if (selectedDevices.has(deviceId)) {
      selectedDevices.delete(deviceId);
    } else {
      selectedDevices.add(deviceId);
    }
    renderDevices();
    updateSelectAllButton();
  };

  // Update select all button text
  const updateSelectAllButton = () => {
    const btn = $('btn-select-all');
    if (selectedDevices.size === devices.length && devices.length > 0) {
      btn.textContent = 'Deselect All';
    } else {
      btn.textContent = 'Select All';
    }
  };

  // Render device list
  const renderDevices = () => {
    const list = $('device-list');
    if (!devices.length) {
      list.innerHTML = '<div class="text-center text-muted py-4">No devices found</div>';
      return;
    }
    list.innerHTML = devices.map(d => {
      const isSelected = selectedDevices.has(d.id);
      return `
      <div class="device-item ${isSelected ? 'device-selected' : ''}" data-device-id="${escapeHtml(d.id)}">
        <div class="device-checkbox">
          <input type="checkbox" class="form-check-input" ${isSelected ? 'checked' : ''}>
        </div>
        <div class="device-info">
          <div class="device-name">${escapeHtml(d.name)}</div>
          <div class="device-id">ID: ${escapeHtml(d.id)}</div>
          <div class="device-type">${escapeHtml(d.type || 'Unknown')}</div>
        </div>
        <div class="device-status">
          <span class="status-badge ${d.online !== false ? 'status-online' : 'status-offline'}">${d.online !== false ? 'Online' : 'Offline'}</span>
        </div>
      </div>
    `;
    }).join('');

    // Add click handlers
    list.querySelectorAll('.device-item').forEach(item => {
      item.addEventListener('click', () => {
        const deviceId = item.dataset.deviceId;
        toggleDevice(deviceId);
      });
    });

    updateSelectAllButton();
  };

  // Get selected devices config
  const getSelectedDevicesConfig = () => {
    // Merge with existing device configs to preserve settings
    const existingDeviceConfigs = {};
    if (config.devices && Array.isArray(config.devices)) {
      config.devices.forEach(d => {
        existingDeviceConfigs[d.id] = d;
      });
    }

    return devices
      .filter(d => selectedDevices.has(d.id))
      .map(d => {
        const existing = existingDeviceConfigs[d.id] || {};
        return {
          ...existing,
          id: d.id,
          name: existing.name || d.name,
          type: d.type,
        };
      });
  };

  // Load devices from API
  const loadDevices = async () => {
    $('refresh-spinner').classList.remove('hidden');
    $('btn-refresh').disabled = true;

    try {
      const res = await homebridge.request('/get-all-devices', {
        country: credentials.country,
        language: credentials.language,
        refresh_token: credentials.refresh_token,
      });

      if (res.success) {
        devices = res.devices || [];
        $('device-count').textContent = devices.length;

        // If no devices are selected yet, select all by default
        if (selectedDevices.size === 0 && devices.length > 0) {
          devices.forEach(d => selectedDevices.add(d.id));
        }

        renderDevices();
      } else {
        homebridge.toast.error(res.error || 'Failed to load devices');
      }
    } catch (e) {
      homebridge.toast.error(e.message || 'Failed to load devices');
    } finally {
      $('refresh-spinner').classList.add('hidden');
      $('btn-refresh').disabled = false;
    }
  };

  // Check for existing session
  const checkSession = async () => {
    try {
      if (config.refresh_token) {
        credentials = {
          refresh_token: config.refresh_token,
          country: config.country || DEFAULT_COUNTRY,
          language: config.language || DEFAULT_LANGUAGE,
        };

        $('active-session-notice').classList.remove('hidden');
        $('login-form').classList.add('hidden');

        await loadDevices();
        showStep('devices');
        return true;
      }
    } catch {
      // No session, show login
    }
    return false;
  };

  // Get selected country/language
  const getSelectedCountryLanguage = () => {
    const select = $('country_language');
    const selected = select.options[select.selectedIndex];
    return {
      country: selected.dataset.country,
      language: selected.dataset.language,
    };
  };

  // Initialize
  populateCountrySelect();
  prefillForm();
  await checkSession();

  // Event: Login with different account
  $('btn-new-login')?.addEventListener('click', () => {
    $('active-session-notice').classList.add('hidden');
    $('login-form').classList.remove('hidden');
  });

  // Event: Login
  $('btn-login').addEventListener('click', async () => {
    const username = $('username').value.trim();
    const password = $('password').value;
    const { country, language } = getSelectedCountryLanguage();

    if (!username || !password) {
      homebridge.toast.error('Please enter your username and password');
      return;
    }

    $('login-spinner').classList.remove('hidden');
    $('btn-login').disabled = true;

    try {
      const res = await homebridge.request('/login-by-user-pass', {
        country,
        language,
        username,
        password,
      });

      if (res.success) {
        credentials = {
          refresh_token: res.token,
          country,
          language,
        };

        // Update config
        const newConfig = {
          ...config,
          platform: 'LGThinQ',
          name: config.name || 'LG ThinQ',
          country,
          language,
          refresh_token: res.token,
          auth_mode: 'token',
        };

        // Remember credentials if checked
        if ($('rememberCredentials').checked) {
          newConfig.username = username;
          newConfig.password = password;
        } else {
          delete newConfig.username;
          delete newConfig.password;
        }

        await homebridge.updatePluginConfig([newConfig]);
        await homebridge.savePluginConfig();

        homebridge.toast.success('Successfully connected to LG ThinQ!');

        await loadDevices();
        showStep('devices');
      } else {
        homebridge.toast.error(res.error || 'Login failed');
      }
    } catch (e) {
      homebridge.toast.error(e.message || 'Login failed');
    } finally {
      $('login-spinner').classList.add('hidden');
      $('btn-login').disabled = false;
    }
  });

  // Event: Refresh devices
  $('btn-refresh').addEventListener('click', loadDevices);

  // Event: Select all / Deselect all
  $('btn-select-all').addEventListener('click', () => {
    if (selectedDevices.size === devices.length) {
      selectedDevices.clear();
    } else {
      devices.forEach(d => selectedDevices.add(d.id));
    }
    renderDevices();
  });

  // Event: Advanced settings
  $('btn-schema').addEventListener('click', async () => {
    // Save devices first so they appear in schema form
    const deviceConfigs = getSelectedDevicesConfig();
    const newConfig = {
      ...config,
      devices: deviceConfigs,
    };
    await homebridge.updatePluginConfig([newConfig]);
    Object.assign(config, newConfig);

    homebridge.showSchemaForm();
  });

  // Event: Save configuration
  $('btn-save').addEventListener('click', async () => {
    homebridge.showSpinner();

    try {
      const { country, language } = getSelectedCountryLanguage();
      const deviceConfigs = getSelectedDevicesConfig();

      const newConfig = {
        ...config,
        platform: 'LGThinQ',
        name: config.name || 'LG ThinQ',
        country,
        language,
        refresh_token: credentials.refresh_token,
        thinq1: $('thinq1').checked,
        auth_mode: 'token',
        devices: deviceConfigs,
      };

      // Remember credentials if checked
      if ($('rememberCredentials').checked) {
        newConfig.username = $('username').value.trim();
        newConfig.password = $('password').value;
      } else {
        delete newConfig.username;
        delete newConfig.password;
      }

      await homebridge.updatePluginConfig([newConfig]);
      await homebridge.savePluginConfig();

      homebridge.toast.success('Configuration saved!');
      showStep('complete');
    } catch (e) {
      homebridge.toast.error(e.message || 'Failed to save configuration');
    } finally {
      homebridge.hideSpinner();
    }
  });

  // Event: Restart Homebridge
  $('btn-restart').addEventListener('click', () => {
    if (confirm('Are you sure you want to restart Homebridge?')) {
      homebridge.request('/restart');
      homebridge.closeSettings();
    }
  });

  // Event: Config changes from schema form
  homebridge.addEventListener('configChanged', e => {
    Object.assign(config, e.data);
    // Update selected devices from config changes
    if (e.data.devices && Array.isArray(e.data.devices)) {
      selectedDevices.clear();
      e.data.devices.forEach(d => selectedDevices.add(d.id));
      renderDevices();
    }
  });

  // Event: Country/language change
  $('country_language').addEventListener('change', async () => {
    const { country, language } = getSelectedCountryLanguage();
    config.country = country;
    config.language = language;
    await homebridge.updatePluginConfig([{ ...config, country, language }]);
  });

  // Event: ThinQ1 checkbox change
  $('thinq1').addEventListener('change', async () => {
    config.thinq1 = $('thinq1').checked;
    await homebridge.updatePluginConfig([{ ...config, thinq1: config.thinq1 }]);
  });
})();
