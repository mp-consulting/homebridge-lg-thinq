# Change Log

## v1.0.11

### Bug fixes

* Fix AirConditioner RotationSpeed characteristic exceeding maximum value
  - RotationSpeed was configured with maxValue of 5 but received values 0-100
  - Update characteristic to use 0-100 range matching windStrength getter
  - Fix setFanSpeed to properly convert percentage back to wind strength value

## v1.0.10

### Bug fixes

* Fix homebridge-ui not appearing after folder restructuring
  - Update server.js import paths to use new api/ folder location

* Fix Jest config for ESM compatibility with Jest 30
  - Rename jest.config.ts to jest.config.mjs
  - Update test mock paths after folder restructuring

## v1.0.9

### Refactoring

* Reorganize folder structure for better maintainability
  - Move API files (ThinQ, API, Auth, Session, Gateway) to src/api/
  - Move model files (Device, DeviceModel, DeviceRegistry) to src/models/
  - Rename v1/ to devices-v1/ for clarity
  - Consolidate BaseStatus classes into src/status/
  - Remove duplicate test files

## v1.0.8

### Refactoring

* Refactor Status classes to extend BaseStatus
  - DehumidifierStatus now uses type-safe helper methods (getBool, getInt)
  - WasherDryerStatus uses BaseStatus helpers with public data getter for legacy access
  - StylerStatus uses getStatus() with explicit snapshot key
  - Add RangeHoodStatus class (previously had no Status class)

* Move airCleanModels to centralized AC_MODEL_FEATURES
  - Add airClean feature to AC_MODEL_FEATURES in constants.ts
  - AirConditioner now uses hasModelFeature() helper

* Refactor AeroTower to use setDeviceControl helper
  - Simplifies control methods from ~40 lines to ~8 lines
  - Automatic snapshot updates on successful control

## v1.0.7

### Refactoring

* Replace magic numbers with named constants
  - Add temperature, mode, threshold, and limit constants to lib/constants.ts
  - Replace hardcoded values in AirConditioner, AirPurifier, Dishwasher,
    WasherDryer, and Dehumidifier with named constants
  - Improves code readability and maintainability

## v1.0.6

### Refactoring

* Add BaseStatus class with common getter helpers
  - getBoolean(), getInt(), getFloat(), getString() for type-safe data access
  - hasProperty() for checking snapshot data existence
  - getAirQualityData() and getFilterLifePercent() for common patterns
  - Reduces boilerplate in Status classes

* Add model features support to DeviceRegistry
  - Centralized model-specific feature configuration
  - hasModelFeature() helper for feature detection
  - Supports AC features: jetMode, quietMode, energySaveMode

* Enhance BaseDevice with additional helpers
  - getStatus() now auto-resolves snapshot key from DeviceRegistry
  - Add setBooleanControl() for simplified boolean device control
  - Add hasModelFeature() to check model-specific feature support

* Add TemperatureConverter utility class
  - Reusable temperature conversion between HomeKit and LG devices
  - Supports Celsius/Fahrenheit with device model mapping
  - Consolidates duplicate conversion logic

* Refactor AirPurifierStatus to use BaseStatus
  - Uses type-safe getter helpers
  - Uses getAirQualityData() and getFilterLifePercent() helpers

* All device Status getters now use auto-resolve snapshot keys

### Bug fixes

* Fix MICROWAVE snapshotKey in DeviceRegistry (was 'microwaveState', now 'ovenState')

## v1.0.5

### Refactoring

* Add DeviceRegistry for centralized device metadata
  - Single source of truth for device types, categories, and config defaults
  - Lazy loading of device implementations for better performance
  - Simplifies adding new device types

* Enhance BaseDevice with caching and control helpers
  - Add Status caching with version-based invalidation
  - Add getStatus() helper for typed, cached status objects
  - Add setDeviceControl() for simplified device control
  - Config getter now merges DeviceRegistry defaults automatically

* Remove redundant code from device implementations
  - Remove config override boilerplate from 6 devices
  - Use getStatus() helper in WasherDryer, Refrigerator, Dishwasher, Microwave
  - Reduces code duplication by ~50 lines

## v1.0.4

### Features

* Improve device selection in Config UI
  - Add checkboxes to select/deselect devices
  - Add "Select All / Deselect All" button
  - Save devices with type for device-specific settings in Advanced Settings
  - Preserve existing device settings when saving

## v1.0.3

### Improvements

* Reduce log noise for Air Conditioner temperature updates
  - Remove debug warn statements from temperature characteristic updates
  - Only update characteristics when value actually changes

### Changes

* Update package metadata (author, funding, license)
* Change license to MIT

## v1.0.2

### Bug fixes

* Fix HomeKit temperature threshold validation errors for Air Conditioner
  - Clamp temperature values to HomeKit valid range (10-38°C)
  - Prevents "illegal value" errors when device reports out-of-range temperatures

### Changes

* Move homebridge-config-ui-x to devDependencies (reduces production bundle size)

## v1.0.1

### Bug fixes

* Fix lint error in Microwave.ts (line too long)

### Documentation

* Add authorization documentation (docs/authorization.md)
* Add device configuration documentation (docs/device-configuration.md)
* Update README to link to local docs

## v1.0.0

### Initial Release

* Fork from nVuln/homebridge-lg-thinq
* Support for Air Conditioner, Air Purifier, Dehumidifier, Dishwasher, Refrigerator, Washer & Dryer, Oven, Microwave, Range Hood, AeroTower
* Web-based configuration UI with 3-step wizard
* ThinQ1 and ThinQ2 API support
* Real-time device updates via MQTT (ThinQ2)

---

# Previous Changelog (from upstream)

## v1.8.0

### Washer is fixed now
* Washer should be appear in Home app now, so sorry for my mistake in previous version.
* Reset Homebridge accesssory cache is required to make it work.

### New Device Supported

* New kind of washer is supported also (device type 223)

## v1.7.0

- fix: washer service name  a9fa96a
- fix: air purifier service name  6a7937f
- fix: refrigerator service name  4faca7f
- fix: AC warning message  b53642d
- add: refrigerator water filter status #260  d0ef884
- fix: dishwasher crashed #270  7efddaf
- fix: AC temperature not updated #177  e934f81
- revert: server.js in custom UI  e11b2a6
- fix: retrieve sale model if possible #275  d6df494

## v1.6.0

### New Device Supported

* Oven
* Microwave

## v1.5.0

### IMPORTANT: AC temperature unit need to be set in plugin setting
- if your AC is in Fahrenheit, please change it in plugin setting to make sure the temperature value is correct, otherwise it will be converted to Celsius by default.
- in previous version, the temperature unit is auto detected, but it's not reliable, so we have to change it to manual setting.

## v1.4.0

- fix: AC humidity value on some device #224  c4227b4
- add: custom characteristic for AC energy consumption #222  6b36c7a
- add: dishwasher data sample  3805ce1
- enable refrigerator door sensor on thinq 1  1d99daf
- fix: Washer tub clean coach event triggered multiple times  aaa8920

## v1.3.0

### New Device Supported

* Range Hood
* AeroTower

### Bug fixes

* Air Conditioner fahrenheit unit (US region)
* Washer/Dryer as water faucet appear again on ios 16

### New feature

* Filter status on Air Purifier
* Tub clean event on Washer/Dryer (trigger at 30 cycle)

## v1.2.0

### Changes

* Real-time device data update via MQTT (thinq2 only)
* More device support

### Bug fixes

* Update login workflow: preLogin step

### Other Changes

* Washer door lock disable by default, need enable it in plugin setting
* Refrigerator: Express Freezer (Ice Plus), Express Fridge, Eco Friendly
* UI device list: changed to tabarray

## v1.1.0

### Changes

* AC supported
* Refrigerator thinq1

### Bug fixes

* washer program finished trigger (as Occupancy Sensor)
* thinq1 device monitor

## v1.0.0

### stable release

* config UI with 3rd party login support (Google, Facebook ...)
* devices support: Air Purifier, Dehumidifier, Dishwasher, Refrigerator, Washer & Dryer
* more device support in future
