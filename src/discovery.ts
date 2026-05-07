import os from "node:os";
import { Bonjour, type Service } from "bonjour-service";
import { WacClient, type FanInfo } from "./wac.js";

export interface DiscoveredFan extends FanInfo {
  readonly host: string;
}

export async function discoverFans(
  hosts: readonly string[],
  timeoutMs: number,
  includeLocalScan: boolean,
): Promise<DiscoveredFan[]> {
  const bonjourHosts = includeLocalScan ? await discoverBonjourHosts(timeoutMs) : [];
  const candidates = [...new Set([...hosts, ...bonjourHosts, ...(includeLocalScan ? localCandidates() : [])])];
  const found = new Map<string, DiscoveredFan>();

  await eachLimit(candidates, 48, async (host) => {
    try {
      const info = await new WacClient(host, timeoutMs).getInfo();
      if (info.clientId) {
        found.set(info.clientId, { ...info, host });
      }
    } catch {
      // Most scanned hosts are not fans.
    }
  });

  return [...found.values()];
}

async function discoverBonjourHosts(timeoutMs: number): Promise<string[]> {
  const hosts = new Set<string>();
  const bonjour = new Bonjour(undefined, () => undefined);
  const browser = bonjour.find({ type: "easylink", protocol: "tcp" });

  browser.on("up", (service: Service) => {
    for (const host of [...(service.addresses ?? []), service.host]) {
      if (host && !host.includes(":")) {
        hosts.add(host.endsWith(".") ? host.slice(0, -1) : host);
      }
    }
  });

  const timer = setInterval(() => browser.update(), Math.min(timeoutMs, 1000));
  timer.unref?.();
  await delay(timeoutMs);
  clearInterval(timer);
  browser.stop();
  bonjour.destroy();
  return [...hosts];
}

function localCandidates(): string[] {
  const ips = new Set<string>();

  for (const net of Object.values(os.networkInterfaces()).flat()) {
    if (!net || net.family !== "IPv4" || net.internal) {
      continue;
    }

    const octets = net.address.split(".");
    if (octets.length === 4) {
      for (let i = 1; i < 255; i += 1) {
        ips.add(`${octets[0]}.${octets[1]}.${octets[2]}.${i}`);
      }
    }
  }

  return [...ips];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function eachLimit<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        await task(item);
      }
    }),
  );
}
