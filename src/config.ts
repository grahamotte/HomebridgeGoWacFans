import type { PlatformConfig } from "homebridge";

export interface GoWacFansConfig {
  readonly hosts: readonly string[];
  readonly discover: boolean;
  readonly discoveryIntervalMs: number;
  readonly scanTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly pollIntervalMs: number;
  readonly removeStaleAccessories: boolean;
}

export function parseConfig(config: PlatformConfig): GoWacFansConfig {
  return {
    hosts: readHosts(config.hosts),
    discover: readBool(config.discover, true),
    discoveryIntervalMs: readNumber(config.discoveryIntervalMs, 60000, 0, 3600000),
    scanTimeoutMs: readNumber(config.scanTimeoutMs, 750, 200, 5000),
    requestTimeoutMs: readNumber(config.requestTimeoutMs, 3000, 500, 15000),
    pollIntervalMs: readNumber(config.pollIntervalMs, 30000, 0, 300000),
    removeStaleAccessories: readBool(config.removeStaleAccessories, false)
  };
}

export function normalizeHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed) {
    return "";
  }

  try {
    return new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`).host;
  } catch {
    return trimmed.replace(/^https?:\/\//u, "").split("/")[0] ?? "";
  }
}

function readHosts(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter(isString).map(normalizeHost).filter(Boolean))]
    : [];
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(Math.round(value), min), max)
    : fallback;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
