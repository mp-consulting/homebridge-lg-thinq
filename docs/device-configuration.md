# Device Configuration

This document covers configuration options for specific device types in the homebridge-lg-thinq plugin.

## Washer / WashTower / Dryer

Configuration includes a required device ID and optional settings:

| Option | Default | Description |
|--------|---------|-------------|
| `washer_trigger` | `false` | Enable program finished trigger. Works as an Occupancy sensor. |
| `washer_door_lock` | `false` | Enable door lock status monitoring. |

## Air Conditioner

| Option | Description |
|--------|-------------|
| `ac_mode` | Set supported modes: `cooling`, `heating`, or `both` |
| `ac_swing_mode` | Set swing direction: `vertical`, `horizontal`, or `both` |
| `ac_air_quality` | Enable air quality sensor (if supported by device) |
| `ac_temperature_sensor` | Expose temperature as a separate sensor for automations |
| `ac_buttons` | Custom button array for preset mode configurations |

> **Note:** The swing mode feature will turn on/off swing mode only. It cannot control a specified swing direction.

## Refrigerator

Optional features that can be controlled via switches:

| Option | Description |
|--------|-------------|
| `ref_express_freezer` | Ice Plus functionality |
| `ref_express_fridge` | Express Fridge mode |
| `ref_eco_friendly` | Energy-saving operation |

## Example Configuration

```json
{
  "platform": "LGThinQ",
  "name": "LG ThinQ",
  "auth_mode": "token",
  "refresh_token": "your-refresh-token",
  "devices": [
    {
      "id": "your-device-id",
      "name": "My Washer",
      "washer_trigger": true,
      "washer_door_lock": true
    },
    {
      "id": "your-ac-device-id",
      "name": "Living Room AC",
      "ac_mode": "both",
      "ac_swing_mode": "vertical",
      "ac_air_quality": true
    },
    {
      "id": "your-fridge-device-id",
      "name": "Kitchen Fridge",
      "ref_express_freezer": true,
      "ref_eco_friendly": true
    }
  ]
}
```

All configurations require a device ID. Display names are optional.
