
<p align="center">
<img src="https://raw.githubusercontent.com/homebridge/branding/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>


# Homebridge LG ThinQ

[![npm](https://img.shields.io/npm/v/homebridge-lg-thinq/latest?label=latest)](https://www.npmjs.com/package/homebridge-lg-thinq)
[![npm](https://img.shields.io/npm/dt/homebridge-lg-thinq)](https://www.npmjs.com/package/homebridge-lg-thinq)
[![join-discord](https://badgen.net/badge/icon/discord?icon=discord&label=homebridge-lg-thinq)](https://discord.gg/wEfQpCDtS7)

> Originally based on [homebridge-lg-thinq](https://github.com/nVuln/homebridge-lg-thinq) by [nVuln](https://github.com/nVuln), licensed under the Apache License 2.0. This fork has been substantially rewritten by [MP Consulting](https://github.com/mp-consulting).

## Overview

A Homebridge plugin for controlling/monitoring LG ThinQ device via their ThinQ platform.

⚠️ This library works with v2 of the LG ThinQ API. But some v1 device may backward compatible, please check table [Implementation Status](#implementation-status) below.

A plugin for interacting with the "LG ThinQ" system, which can control new LG smart device. API used in this plugin is not official, I reversed from their "LG ThinQ" mobile app.

## Installation

```
npm i -g homebridge-lg-thinq
```

# Configuration

> ✔️ I highly recommend using [homebridge-config-ui-x](https://github.com/oznu/homebridge-config-ui-x#readme) to make these changes.

1. Navigate to the Plugins page in [homebridge-config-ui-x](https://github.com/oznu/homebridge-config-ui-x).
2. Click the **Settings** button for the LG ThinQ plugin.
3. Login to your LG account
4. Add or remove which devices you want
5. Restart Homebridge for the changes to take effect.

> ⚠️ Or you can manual edit it, add json below to config.json (not recommend)
```json
{
  "auth_mode": "token",
  "refresh_token": "**refresh*token**",
  "username": "lg username",
  "password": "lg password",
  "country": "US",
  "language": "en-US",
  "thinq1": false,
  "devices": [
	{
	  "id": "device id"
	}
  ],
  "platform": "LGThinQ",
  "name": "LG ThinQ"
}

```
- `auth_mode` Required. You can choose between `token` and `account`
- `refresh_token` Required if `auth_mode` = `token`. The `refresh_token` of your account.
- `username` Required if `auth_mode` = `account`. LG thinQ account
- `password` Required if `auth_mode` = `account`. LG thinQ password
- `country` Required. Your account [country alpha-2 code](https://www.countrycode.org/), e.g., US for the USA.
- `language` Required. Your account language code, e.g., en-US, vi-VN.
- `devices` List devices you want add to homebridge, leave it empty if you want add all devices. See [Wiki](https://github.com/mp-consulting/homebridge-lg-thinq/wiki/Wiki) for specific device configuration.
- `thinq1` Optional. Enable thinq1 device support
- `platform` value always `LGThinQ`

## Plugin Authorization Setting

* See [Plugin Authorization Setting](docs/authorization.md)

## Device specific configuration

* See [Device Configuration](docs/device-configuration.md)

## Assistant

The config UI can explain problems with the **Assistant**. It is off until you set up
an AI provider once for all MP Consulting plugins in
[Homebridge AI Kit](https://github.com/mp-consulting/homebridge-ai-kit) (or the
Homebridge Glass UI): the plugin reads the shared `HomebridgeAiKit` platform block from
`config.json` and has no AI settings of its own. When it is not set up, the UI looks
exactly as before, with a small tip in the Settings tab.

When it is enabled, **Explain** buttons appear next to a failed login, a failed device
list, and every appliance the LG ThinQ cloud reports as offline. The answer streams into
an Assistant panel below.

What is sent to the provider: the error message (email addresses masked), the auth mode,
the country and language, whether ThinQ1 support is on (and its refresh interval), and
for an appliance its name, type, online flag and whether it is included in HomeKit. Your
LG email, password, refresh token, device IDs and serial numbers are never sent, and the
provider's API key stays on the Homebridge server.

The plugin's settings are mostly per-appliance options and LG sign-in details, so there
is no "Describe Your Setup" config assistant in this plugin.

## Implementation Status

| *Device*       | *Implementation* | *Status* | *Control* | *Thinq2* | *Thinq1* |
|----------------| --- | --- | --- | --- | --- |
| Refrigerator   | ✔️ | ✔️ | ✔️ | ✔️ | ✔️ |
| Air Purifier   | ✔️ | ✔️ | ✔️ | ✔️ | ✔️ |
| Washer & Dryer | ✔️ | ✔️ | 🚫 | ✔️ | ✔️ |
| Dishwasher     | ✔️ | ✔️ | 🚫 | ✔️ | 🚫 |
| Dehumidifier   | ✔️ | ✔️ | ⚠️ | ✔️ | 🚫 |
| AC             | ✔️ | ✔️ | ✔️ | ✔️ | ✔️ |
| Oven           | ✔️ | ✔️ | ✔️ | ⚠️ | ⚠️ |
| Microwave      | ✔️ | ✔️ | ✔️ | ⚠️ | ⚠️ |

> **Note:** If your dishwasher previously appeared as a TV in HomeKit, update to v1.0.16+ and remove/re-add the accessory for the correct icon to appear.

for more device support please open issue request.

## Contributors ✨

- Special thank to [carlosgamezvillegas](https://github.com/carlosgamezvillegas) for implementing Oven & Microwave device support. More detail in [#87](https://github.com/mp-consulting/homebridge-lg-thinq/issues/87)

## Support

If you have a question, please [start a discussion](https://github.com/mp-consulting/homebridge-lg-thinq/discussions/new) or leave a message at [discord channel](https://discord.gg/wEfQpCDtS7).  
If you would like to report a bug, please [open an issue](https://github.com/mp-consulting/homebridge-lg-thinq/issues/new/choose).

## Development

```
npm install
npm run build
npm run lint
npm test
```

The build vendors `@mp-consulting/homebridge-ui-kit` and Bootstrap into
`homebridge-ui/public/lib/` with `mp-ui-kit-copy --vendor`. Until
`@mp-consulting/homebridge-ai-kit` 2.0.0 and `@mp-consulting/homebridge-ui-kit` 1.2.0
are published, both are installed from sibling checkouts (`file:../homebridge-mcp-server`
and `file:../homebridge-ui-kit`); they must become `^2.0.0` and `^1.2.0` before release.

## CLI Usage

```
$ thinq
Usage: thinq [options] [command]

Options:
  -c, --country <type>         Country code for account (default: "US")
  -l, --language <type>        Language code for account (default: "en-US")
  -h, --help                   display help for command

Commands:
  login <username> <password>  Obtain refresh_token from LG account
  auth                         Obtain refresh_token from account logged by Google Account, Apple ID
  help [command]               display help for command
```
