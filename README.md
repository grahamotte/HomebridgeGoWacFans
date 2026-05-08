# Go WAC Fans

Homebridge plugin for local WAC and Modern Forms fans using the published local
`POST /mf` API.

## Features

- Discovers fans with WAC/Modern Forms Bonjour plus local API probing.
- Supports optional host entries as a fallback.
- Exposes fan power, six speed levels, direction, light power, and brightness.
- Keeps cached accessories when a fan is switched off, and rediscovers fans that come back later.

## Setup

```json
{
  "platform": "GoWacFans",
  "name": "GoWacFans"
}
```

Host entries are optional and should only be needed for unusual networks:

```json
{
  "platform": "GoWacFans",
  "name": "GoWacFans",
  "hosts": ["192.168.1.21", "192.168.1.138"]
}
```

## Options

- `discover`: use Bonjour discovery and local IPv4 probing. Default: `true`.
- `hosts`: optional fan IP addresses or hostnames.
- `discoveryIntervalMs`: rediscovery interval for switch-powered fans. Use `0` to disable. Default: `60000`.
- `scanTimeoutMs`: per-host discovery timeout. Default: `5000`.
- `requestTimeoutMs`: normal API timeout. Default: `3000`.
- `pollIntervalMs`: background refresh interval. Default: `30000`.
- `removeStaleAccessories`: remove cached fans not found during discovery. Default: `false`.
