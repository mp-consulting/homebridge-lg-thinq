(async () => {
  'use strict';

  // State
  let credentials = { refresh_token: null, country: null, language: null };
  let devices = [];
  const selectedDevices = new Set();
  // Per-device settings overrides (keyed by device id)
  const deviceSettings = {};

  // DOM helper
  const $ = id => document.getElementById(id);
  const steps = { login: $('step-login'), devices: $('step-devices'), complete: $('step-complete') };

  // Constants
  const DEFAULT_COUNTRY = 'US';
  const DEFAULT_LANGUAGE = 'en-US';
  const DEFAULT_REFRESH_INTERVAL = 60;

  // Per-device type field definitions
  const DEVICE_TYPE_FIELDS = {
    AC: {
      selects: [
        { key: 'ac_mode', label: 'AC Mode', options: [['', 'Both (default)'], ['COOLING', 'Cooling only'], ['HEATING', 'Heating only'], ['BOTH', 'Both']] },
        { key: 'ac_swing_mode', label: 'Swing Mode', options: [['', 'Default'], ['BOTH', 'Both axes'], ['VERTICAL', 'Vertical only'], ['HORIZONTAL', 'Horizontal only']] },
        { key: 'ac_temperature_unit', label: 'Temperature Unit', options: [['C', 'Celsius (°C)'], ['F', 'Fahrenheit (°F)']] },
      ],
      toggles: [
        { key: 'ac_fan_control', label: 'Separate fan control', group: 'Controls' },
        { key: 'ac_jet_control', label: 'Separate jet control', group: 'Controls' },
        { key: 'ac_energy_save', label: 'Energy save switch', group: 'Controls' },
        { key: 'ac_air_clean', label: 'Air purify switch', group: 'Controls' },
        { key: 'ac_led_control', label: 'LED panel control', group: 'Controls' },
        { key: 'ac_air_quality', label: 'Air quality sensor', group: 'Sensors' },
        { key: 'ac_temperature_sensor', label: 'Current temperature as sensor', group: 'Sensors' },
        { key: 'ac_humidity_sensor', label: 'Humidity sensor', group: 'Sensors' },
      ],
    },
    WASHER: {
      toggles: [
        { key: 'washer_trigger', label: 'Program finished trigger' },
        { key: 'washer_tub_clean', label: 'Tub clean event' },
        { key: 'washer_door_lock', label: 'Door lock status' },
      ],
    },
    REFRIGERATOR: {
      toggles: [
        { key: 'ref_express_freezer', label: 'Express Freezer / Ice Plus' },
        { key: 'ref_express_fridge', label: 'Express Fridge' },
        { key: 'ref_eco_friendly', label: 'Eco Friendly' },
      ],
    },
    DISHWASHER: {
      toggles: [
        { key: 'dishwasher_trigger', label: 'Program finished trigger' },
      ],
    },
    AIR_PURIFIER: {
      toggles: [
        { key: 'air_fast_mode', label: 'Air Fast Mode' },
      ],
    },
  };
  // Type aliases
  ['WASHER_NEW', 'WASH_TOWER', 'DRYER'].forEach(t => {
    DEVICE_TYPE_FIELDS[t] = DEVICE_TYPE_FIELDS.WASHER; 
  });

  // Load existing config
  const pluginConfig = await homebridge.getPluginConfig();
  const config = pluginConfig[0] || {};

  // Initialize selected devices and per-device settings from config
  if (config.devices && Array.isArray(config.devices)) {
    config.devices.forEach(d => {
      selectedDevices.add(d.id);
      deviceSettings[d.id] = { ...d };
    });
  }

  // Populate country select (login form)
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

  const findCountryOption = (country, language) => {
    const select = $('country_language');
    return select.querySelector(`option[data-country="${country}"][data-language="${language}"]`)
      || select.querySelector(`option[data-country="${DEFAULT_COUNTRY}"][data-language="${DEFAULT_LANGUAGE}"]`);
  };

  // Pre-fill login form from config
  const prefillForm = () => {
    if (config.username) {
      $('username').value = config.username; 
    }
    if (config.password) {
      $('password').value = config.password; 
    }
    if (config.username && config.password) {
      $('rememberCredentials').checked = true; 
    }
    const option = findCountryOption(config.country || DEFAULT_COUNTRY, config.language || DEFAULT_LANGUAGE);
    if (option) {
      option.selected = true; 
    }
  };

  // Pre-fill Settings tab from config
  const prefillSettingsTab = () => {
    const authMode = config.auth_mode || 'token';
    $('settings-auth-mode').value = authMode;
    $('settings-refresh-token').value = config.refresh_token || '';
    $('settings-country').value = config.country || DEFAULT_COUNTRY;
    $('settings-language').value = config.language || DEFAULT_LANGUAGE;
    $('settings-refresh-interval').value = config.refresh_interval || DEFAULT_REFRESH_INTERVAL;
    $('settings-thinq1').checked = !!config.thinq1;
    $('settings-token-group').classList.toggle('d-none', authMode !== 'token');
  };

  // Show/hide step
  const showStep = step => {
    Object.entries(steps).forEach(([k, el]) => {
      el.classList.toggle('d-none', k !== step);
    });
  };

  // Escape HTML for XSS prevention
  const escapeHtml = text => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  // ── Device list ────────────────────────────────────────────────

  const toggleDevice = (deviceId) => {
    if (selectedDevices.has(deviceId)) {
      selectedDevices.delete(deviceId);
    } else {
      selectedDevices.add(deviceId);
    }
    renderDevices();
    updateSelectAllButton();
  };

  const updateSelectAllButton = () => {
    const btn = $('btn-select-all');
    btn.textContent = (selectedDevices.size === devices.length && devices.length > 0) ? 'Deselect All' : 'Select All';
  };

  const renderDevices = () => {
    const list = $('device-list');
    if (!devices.length) {
      list.innerHTML = MpKit.EmptyState.render({
        iconClass: 'bi bi-phone',
        title: 'No devices found',
        hint: 'Connect your LG account and click Refresh',
      });
      return;
    }
    list.innerHTML = devices.map(d => {
      const isSelected = selectedDevices.has(d.id);
      const statusBadge = d.online !== false ? MpKit.StatusBadge.online() : MpKit.StatusBadge.offline();
      const overrides = deviceSettings[d.id] || {};
      const displayName = overrides.name || d.name;
      return `
        <div class="device-item ${isSelected ? 'device-selected' : ''}" data-device-id="${escapeHtml(d.id)}">
          <div class="device-checkbox">
            <input type="checkbox" class="form-check-input" ${isSelected ? 'checked' : ''}>
          </div>
          <div class="device-info">
            <div class="device-name">${escapeHtml(displayName)}</div>
            <div class="device-meta">
              <span class="me-2">${escapeHtml(d.type || 'Unknown')}</span>
              <span class="font-monospace">ID: ${escapeHtml(d.id)}</span>
            </div>
          </div>
          <div class="d-flex align-items-center gap-2">
            ${statusBadge}
            <button class="btn btn-link text-body-secondary p-1 btn-device-settings" data-device-id="${escapeHtml(d.id)}" title="Device settings">
              <i class="bi bi-gear"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.device-item').forEach(item => {
      // Checkbox toggle on row click (excluding gear button)
      item.addEventListener('click', e => {
        if (!e.target.closest('.btn-device-settings')) {
          toggleDevice(item.dataset.deviceId);
        }
      });
    });

    list.querySelectorAll('.btn-device-settings').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openDeviceSettings(btn.dataset.deviceId);
      });
    });

    updateSelectAllButton();
  };

  // ── Per-device settings panel ──────────────────────────────────

  const AC_OP_MODES = [
    [0, 'Cool'],
    [1, 'Dry'],
    [2, 'Fan'],
    [4, 'Heat'],
    [5, 'Air Clean'],
    [6, 'Auto'],
  ];

  const opModeSelect = (selected) => `
    <select class="form-select form-select-sm" style="max-width:140px;">
      ${AC_OP_MODES.map(([val, lbl]) => `<option value="${val}" ${selected === val ? 'selected' : ''}>${lbl}</option>`).join('')}
    </select>
  `;

  const renderAcButtonsEditor = (buttons) => {
    const rows = buttons.map((btn, i) => `
      <div class="d-flex gap-2 mb-2 ac-button-row">
        <input type="text" class="form-control form-control-sm" placeholder="Name" style="max-width:180px;" value="${escapeHtml(btn.name || '')}">
        ${opModeSelect(btn.op_mode ?? 0)}
        <button class="btn btn-outline-danger btn-sm btn-remove-ac-button" data-index="${i}" type="button">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    `).join('');

    return `
      <hr class="my-3">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h6 class="mp-label mb-0"><i class="bi bi-toggles2 me-1"></i>AC Buttons</h6>
        <button class="btn btn-outline-secondary btn-sm" id="btn-add-ac-button" type="button">
          <i class="bi bi-plus me-1"></i>Add button
        </button>
      </div>
      <div class="form-text mb-3">Custom HomeKit switches that activate an operation mode.</div>
      <div id="ac-buttons-list">${rows}</div>
    `;
  };

  const wireAcButtonsEditor = () => {
    $('btn-add-ac-button')?.addEventListener('click', () => {
      const list = $('ac-buttons-list');
      const index = list.querySelectorAll('.ac-button-row').length;
      const row = document.createElement('div');
      row.className = 'd-flex gap-2 mb-2 ac-button-row';
      row.innerHTML = `
        <input type="text" class="form-control form-control-sm" placeholder="Name" style="max-width:180px;">
        ${opModeSelect(0)}
        <button class="btn btn-outline-danger btn-sm btn-remove-ac-button" data-index="${index}" type="button">
          <i class="bi bi-trash"></i>
        </button>
      `;
      list.appendChild(row);
      wireRemoveButtons();
    });
    wireRemoveButtons();
  };

  const wireRemoveButtons = () => {
    $('ac-buttons-list')?.querySelectorAll('.btn-remove-ac-button').forEach(btn => {
      btn.onclick = () => btn.closest('.ac-button-row').remove();
    });
  };

  const readAcButtons = () => {
    const rows = $('ac-buttons-list')?.querySelectorAll('.ac-button-row') || [];
    return Array.from(rows).map(row => {
      const name = row.querySelector('input').value.trim();
      const op_mode = parseInt(row.querySelector('select').value) || 0;
      return { name, op_mode };
    }).filter(b => b.name);
  };

  let activeDeviceId = null;

  const openDeviceSettings = (deviceId) => {
    activeDeviceId = deviceId;
    const device = devices.find(d => d.id === deviceId);
    if (!device) {
      return; 
    }

    const overrides = deviceSettings[deviceId] || {};
    const fields = DEVICE_TYPE_FIELDS[device.type];

    $('device-settings-title').innerHTML = `<i class="bi bi-gear me-2"></i>${escapeHtml(overrides.name || device.name)}`;

    let typeHtml = '';
    if (fields) {
      const selects = (fields.selects || []).map(f => `
        <div class="col-md-6 mb-3">
          <label class="form-label small">${escapeHtml(f.label)}</label>
          <select class="form-select form-select-sm" id="dev-${f.key}">
            ${f.options.map(([val, lbl]) => `<option value="${val}" ${(overrides[f.key] || '') === val ? 'selected' : ''}>${escapeHtml(lbl)}</option>`).join('')}
          </select>
        </div>
      `).join('');

      const hasGroups = (fields.toggles || []).some(f => f.group);
      let toggles;
      if (hasGroups) {
        const groupOrder = [];
        const groupMap = {};
        (fields.toggles || []).forEach(f => {
          const g = f.group || '';
          if (!groupMap[g]) {
            groupMap[g] = [];
            groupOrder.push(g);
          }
          groupMap[g].push(f);
        });
        toggles = groupOrder.map(g => {
          const label = g
            ? `<div class="mb-2"><small class="text-body-secondary fw-semibold text-uppercase" style="font-size:.7rem;">${escapeHtml(g)}</small></div>`
            : '';
          const items = groupMap[g].map(f => `
            <div class="form-check mb-2">
              <input class="form-check-input" type="checkbox" id="dev-${f.key}" ${overrides[f.key] ? 'checked' : ''}>
              <label class="form-check-label small" for="dev-${f.key}">${escapeHtml(f.label)}</label>
            </div>`).join('');
          return `<div class="col-md-6">${label}${items}</div>`;
        }).join('');
      } else {
        toggles = (fields.toggles || []).map(f => `
          <div class="col-md-6 mb-2">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="dev-${f.key}" ${overrides[f.key] ? 'checked' : ''}>
              <label class="form-check-label small" for="dev-${f.key}">${escapeHtml(f.label)}</label>
            </div>
          </div>`).join('');
      }

      const acButtonsHtml = device.type === 'AC' ? renderAcButtonsEditor(overrides.ac_buttons || []) : '';

      typeHtml = `
        <h6 class="mp-label mb-3"><i class="bi bi-toggles me-1"></i>${escapeHtml(device.type)} Settings</h6>
        ${selects ? `<div class="row">${selects}</div>` : ''}
        ${toggles ? `<div class="row mt-2">${toggles}</div>` : ''}
        ${acButtonsHtml}
      `;
    }

    $('device-settings-content').innerHTML = `
      <div class="row g-3 mb-4">
        <div class="col-md-6">
          <label class="form-label" for="dev-name">Display Name</label>
          <input type="text" class="form-control" id="dev-name" value="${escapeHtml(overrides.name || '')}" placeholder="${escapeHtml(device.name)}">
          <div class="form-text">Custom name in HomeKit (leave empty to use device name)</div>
        </div>
        <div class="col-md-6">
          <label class="form-label" for="dev-serial">Serial Number <span class="text-body-secondary">(optional)</span></label>
          <input type="text" class="form-control font-monospace" id="dev-serial" value="${escapeHtml(overrides.serial_number || '')}">
        </div>
      </div>
      ${typeHtml}
    `;

    if (device.type === 'AC') {
      wireAcButtonsEditor();
    }

    $('device-settings-panel').classList.remove('d-none');
    $('device-settings-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const closeDeviceSettings = () => {
    activeDeviceId = null;
    $('device-settings-panel').classList.add('d-none');
  };

  const applyDeviceSettings = () => {
    if (!activeDeviceId) {
      return; 
    }
    const device = devices.find(d => d.id === activeDeviceId);
    if (!device) {
      return; 
    }

    const overrides = deviceSettings[activeDeviceId] || {};
    const fields = DEVICE_TYPE_FIELDS[device.type];

    overrides.name = $('dev-name').value.trim();
    overrides.serial_number = $('dev-serial').value.trim() || undefined;

    if (fields) {
      (fields.selects || []).forEach(f => {
        const val = $(`dev-${f.key}`)?.value;
        if (val) {
          overrides[f.key] = val; 
        } else {
          delete overrides[f.key]; 
        }
      });
      (fields.toggles || []).forEach(f => {
        overrides[f.key] = $(`dev-${f.key}`)?.checked || false;
      });
      if (device.type === 'AC') {
        overrides.ac_buttons = readAcButtons();
      }
    }

    deviceSettings[activeDeviceId] = overrides;
    closeDeviceSettings();
    renderDevices();
    homebridge.toast.success('Device settings applied — click Save to persist');
  };

  // ── Config helpers ─────────────────────────────────────────────

  const getSelectedDevicesConfig = () => {
    return devices
      .filter(d => selectedDevices.has(d.id))
      .map(d => {
        const overrides = deviceSettings[d.id] || {};
        // Remove falsy booleans to keep config clean
        const cleaned = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== false && v !== '' && v !== undefined));
        return { id: d.id, name: d.name, type: d.type, ...cleaned };
      });
  };

  const saveConfiguration = async () => {
    homebridge.showSpinner();
    try {
      const deviceConfigs = getSelectedDevicesConfig();
      const newConfig = {
        ...config,
        platform: 'LGThinQ',
        name: config.name || 'LG ThinQ',
        country: $('settings-country').value.trim() || config.country || DEFAULT_COUNTRY,
        language: $('settings-language').value.trim() || config.language || DEFAULT_LANGUAGE,
        refresh_token: credentials.refresh_token,
        auth_mode: config.auth_mode || 'token',
        refresh_interval: parseInt($('settings-refresh-interval').value) || DEFAULT_REFRESH_INTERVAL,
        devices: deviceConfigs,
      };
      if ($('rememberCredentials').checked) {
        newConfig.username = $('username').value.trim();
        newConfig.password = $('password').value;
      } else {
        delete newConfig.username;
        delete newConfig.password;
      }
      await homebridge.updatePluginConfig([newConfig]);
      await homebridge.savePluginConfig();
      Object.assign(config, newConfig);
      homebridge.toast.success('Configuration saved!');
      showStep('complete');
    } catch (e) {
      homebridge.toast.error(e.message || 'Failed to save configuration');
    } finally {
      homebridge.hideSpinner();
    }
  };

  // ── Load devices ───────────────────────────────────────────────

  const loadDevices = async () => {
    $('refresh-spinner').classList.remove('d-none');
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
      $('refresh-spinner').classList.add('d-none');
      $('btn-refresh').disabled = false;
    }
  };

  // ── Session check ──────────────────────────────────────────────

  const checkSession = async () => {
    try {
      if (config.refresh_token) {
        credentials = {
          refresh_token: config.refresh_token,
          country: config.country || DEFAULT_COUNTRY,
          language: config.language || DEFAULT_LANGUAGE,
        };
        $('active-session-notice').classList.remove('d-none');
        $('login-form').classList.add('d-none');
        $('session-loading').classList.remove('d-none');
        await loadDevices();
        $('session-loading').classList.add('d-none');
        showStep('devices');
        return true;
      }
    } catch {
      // No session, show login
    }
    return false;
  };

  const getSelectedCountryLanguage = () => {
    const select = $('country_language');
    const selected = select.options[select.selectedIndex];
    return { country: selected.dataset.country, language: selected.dataset.language };
  };

  // ── Initialize ─────────────────────────────────────────────────

  populateCountrySelect();
  prefillForm();
  prefillSettingsTab();
  await checkSession();

  // ── Events: Login ──────────────────────────────────────────────

  $('btn-new-login')?.addEventListener('click', () => {
    $('active-session-notice').classList.add('d-none');
    $('login-form').classList.remove('d-none');
  });

  $('btn-login').addEventListener('click', async () => {
    const username = $('username').value.trim();
    const password = $('password').value;
    const { country, language } = getSelectedCountryLanguage();

    if (!username || !password) {
      homebridge.toast.error('Please enter your username and password');
      return;
    }

    $('login-spinner').classList.remove('d-none');
    $('btn-login').disabled = true;

    try {
      const res = await homebridge.request('/login-by-user-pass', { country, language, username, password });
      if (res.success) {
        credentials = { refresh_token: res.token, country, language };
        const newConfig = {
          ...config,
          platform: 'LGThinQ',
          name: config.name || 'LG ThinQ',
          country,
          language,
          refresh_token: res.token,
          auth_mode: 'token',
        };
        if ($('rememberCredentials').checked) {
          newConfig.username = username;
          newConfig.password = password;
        } else {
          delete newConfig.username;
          delete newConfig.password;
        }
        await homebridge.updatePluginConfig([newConfig]);
        await homebridge.savePluginConfig();
        Object.assign(config, newConfig);
        prefillSettingsTab();
        homebridge.toast.success('Successfully connected to LG ThinQ!');
        await loadDevices();
        showStep('devices');
      } else {
        homebridge.toast.error(res.error || 'Login failed');
      }
    } catch (e) {
      homebridge.toast.error(e.message || 'Login failed');
    } finally {
      $('login-spinner').classList.add('d-none');
      $('btn-login').disabled = false;
    }
  });

  // ── Events: Devices tab ────────────────────────────────────────

  $('btn-refresh').addEventListener('click', loadDevices);

  $('btn-select-all').addEventListener('click', () => {
    if (selectedDevices.size === devices.length) {
      selectedDevices.clear();
    } else {
      devices.forEach(d => selectedDevices.add(d.id));
    }
    renderDevices();
  });

  $('btn-close-device-settings').addEventListener('click', closeDeviceSettings);
  $('btn-cancel-device-settings').addEventListener('click', closeDeviceSettings);
  $('btn-apply-device-settings').addEventListener('click', applyDeviceSettings);

  $('btn-save').addEventListener('click', saveConfiguration);

  // ── Events: Settings tab ───────────────────────────────────────

  $('settings-auth-mode').addEventListener('change', () => {
    $('settings-token-group').classList.toggle('d-none', $('settings-auth-mode').value !== 'token');
  });

  $('btn-save-settings').addEventListener('click', async () => {
    // Apply settings tab fields to config before saving
    config.auth_mode = $('settings-auth-mode').value;
    config.refresh_token = $('settings-refresh-token').value.trim() || config.refresh_token;
    config.country = $('settings-country').value.trim() || DEFAULT_COUNTRY;
    config.language = $('settings-language').value.trim() || DEFAULT_LANGUAGE;
    config.refresh_interval = parseInt($('settings-refresh-interval').value) || DEFAULT_REFRESH_INTERVAL;
    config.thinq1 = $('settings-thinq1').checked || undefined;
    if (config.auth_mode === 'token') {
      credentials.refresh_token = config.refresh_token;
    }
    await saveConfiguration();
  });

  // ── Events: Tab switching ──────────────────────────────────────

  document.querySelectorAll('[data-bs-toggle="tab"]').forEach(btn => {
    btn.addEventListener('shown.bs.tab', e => {
      if (e.target.id === 'tab-devices') {
        closeDeviceSettings();
      }
    });
  });

  // ── Events: Save / Restart / Schema changes ────────────────────

  const attachRestartHandler = () => {
    $('btn-restart').addEventListener('click', () => {
      const container = $('restart-btn-container');
      container.innerHTML = `
        <span class="small text-body-secondary me-2">Restart Homebridge?</span>
        <button class="btn btn-warning btn-sm me-1" id="btn-restart-confirm">
          <i class="bi bi-check me-1"></i>Yes, restart
        </button>
        <button class="btn btn-outline-secondary btn-sm" id="btn-restart-cancel">Cancel</button>
      `;
      $('btn-restart-confirm').addEventListener('click', () => {
        homebridge.request('/restart');
        homebridge.closeSettings();
      });
      $('btn-restart-cancel').addEventListener('click', () => {
        container.innerHTML = '<button id="btn-restart" class="btn btn-warning"><i class="bi bi-arrow-repeat me-1"></i>Restart Homebridge</button>';
        attachRestartHandler();
      });
    });
  };
  attachRestartHandler();

  homebridge.addEventListener('configChanged', e => {
    Object.assign(config, e.data);
    if (e.data.devices && Array.isArray(e.data.devices)) {
      selectedDevices.clear();
      e.data.devices.forEach(d => {
        selectedDevices.add(d.id);
        deviceSettings[d.id] = { ...d };
      });
      renderDevices();
    }
    prefillSettingsTab();
  });

  $('country_language').addEventListener('change', async () => {
    const { country, language } = getSelectedCountryLanguage();
    config.country = country;
    config.language = language;
    await homebridge.updatePluginConfig([{ ...config, country, language }]);
  });
})();
