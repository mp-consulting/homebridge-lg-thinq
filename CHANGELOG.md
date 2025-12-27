# Change Log

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
