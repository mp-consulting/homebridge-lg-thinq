# CLAUDE.md

## Project Overview

Homebridge plugin (`@mp-consulting/homebridge-lg-thinq`) for LG ThinQ smart appliances. Supports both ThinQ v2 (primary, MQTT-based) and v1 (legacy, polling) devices including AC, air purifiers, refrigerators, washers/dryers, dishwashers, dehumidifiers, ovens, microwaves, range hoods, and stylers.

## Tech Stack

- **Language**: TypeScript (strict, ES2022, ESM via NodeNext)
- **Runtime**: Node.js ^20.18.0 || ^22.10.0 || ^24, Homebridge ^1.8.0 || ^2.0.0-beta
- **Testing**: Vitest with coverage
- **Linting**: ESLint 9 flat config with typescript-eslint
- **Key deps**: `axios` + `axios-retry` (HTTP), `aws-iot-device-sdk` (MQTT), `node-forge` (crypto), `node-persist` (storage), `luxon` (dates)

## Commands

- `npm run build` — Compile TypeScript to `dist/`
- `npm run lint` — Lint with zero warnings
- `npm test` — Run tests (Vitest)
- `npm run test:coverage` — Tests with coverage
- `npm run watch` — Build, link, and watch with nodemon

## Project Structure

```
src/
├── index.ts                    # Plugin entry point
├── platform.ts                 # LGThinQHomebridgePlatform (DynamicPlatformPlugin)
├── baseDevice.ts               # Abstract base for all device types
├── settings.ts                 # Plugin constants
├── cli.ts                      # CLI tool (thinq command)
├── api/                        # ThinQ API layer
│   ├── ThinQ.ts                # Service orchestrator
│   ├── API.ts                  # REST client
│   ├── Auth.ts                 # Authentication (account or token mode)
│   ├── Gateway.ts              # Gateway communication
│   └── Session.ts              # Session management
├── devices/                    # ThinQ v2 device implementations (12 types)
├── devices-v1/                 # ThinQ v1 legacy devices (5 types)
│   └── transforms/             # State transformation layer
├── models/                     # Device, DeviceModel, DeviceRegistry
├── characteristics/            # Custom HomeKit characteristics (TotalConsumption)
├── errors/                     # Custom error hierarchy
├── lib/                        # Constants, persistence
├── status/                     # Device status handling
├── utils/                      # Normalize, TemperatureConverter
└── @types/                     # Type augmentations (homebridge-lib)
test/
├── api/                        # API tests
├── devices-v1/                 # V1 device tests
├── lib/                        # Library tests
├── models/                     # Model tests
└── utils/                      # Utility tests
homebridge-ui/                  # Custom config UI
```

## Architecture

- **DynamicPlatformPlugin** with lazy device discovery
- **Dual protocol**: ThinQ v2 (MQTT real-time) and v1 (polling, configurable interval default 5s)
- **Authentication**: Account (email/password) or refresh token mode
- **Device registry**: Maps device types to handler classes
- **Snapshot-based updates** with hash-based cache invalidation
- **Custom error hierarchy**: AuthenticationError, TokenError, MonitorError, etc.
- **Custom UI**: Uses Homebridge custom UI framework (`homebridge-ui/`) for plugin configuration management

## Code Style

- Single quotes, 2-space indent, semicolons required
- Trailing commas in multiline, max line length 160
- Unix line endings, object curly spacing

## Git Settings

- `coAuthoredBy`: false
