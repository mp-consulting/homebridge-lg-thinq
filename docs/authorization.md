# Plugin Authorization Setting

## Overview

This plugin requires LG account credentials to access your ThinQ devices.

## Authorization Methods

### Standard LG Account Access

The plugin requires an LG account with username/password to grant access.

### For Third-Party Authenticated Accounts

If you use Google, Apple ID, or Facebook to sign into your LG account, you should create a secondary account using traditional credentials.

> **Note:** You can use the same email as your Google/Apple/Facebook account. LG treats them as separate accounts.

### Refresh Token Alternative

Instead of providing credentials directly, you can generate a refresh token for enhanced privacy. This way you don't need to store your username/password in the plugin configuration.

Run the following commands:

```bash
npm install -g homebridge-lg-thinq
thinq login [username] [password] -c US -l en-US
```

Replace `[username]` and `[password]` with your LG account credentials. Adjust the country code (`-c`) and language (`-l`) as needed for your region.

This command will display a refresh token that you can enter in the plugin configuration instead of your username/password.

## Summary

The plugin offers three authentication pathways:

1. **Direct credentials**: Enter username/password directly in the plugin settings
2. **Secondary account**: Create a new LG account for third-party authenticated users
3. **Refresh token**: Generate a token via CLI for enhanced privacy
