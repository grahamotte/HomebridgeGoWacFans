import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service
} from "homebridge";
import { normalizeHost, parseConfig, type GoWacFansConfig } from "./config.js";
import { discoverFans, type DiscoveredFan } from "./discovery.js";
import { WacFanAccessory } from "./accessory.js";
import { PLATFORM_NAME, PLUGIN_NAME } from "./settings.js";

interface Context {
  device?: DiscoveredFan & { readonly lastSeen: string };
}

export class GoWacFansPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories = new Map<string, PlatformAccessory>();
  public readonly settings: GoWacFansConfig;
  private readonly controllers = new Map<string, WacFanAccessory>();
  private discoveryRunning = false;
  private discoveryTimer?: ReturnType<typeof setInterval>;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.settings = parseConfig(config);

    api.on("didFinishLaunching", () => {
      this.discoverDevices().catch((error: unknown) => {
        this.log.error(`Discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      this.startDiscoveryTimer();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info("Loading accessory from cache:", accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  async discoverDevices(): Promise<void> {
    if (this.discoveryRunning) {
      this.log.debug("Skipping WAC discovery; previous discovery is still running.");
      return;
    }

    this.discoveryRunning = true;
    this.log.info("Discovering WAC fans...");
    try {
      const cachedHosts = [...this.accessories.values()]
        .map((accessory) => (accessory.context as Context).device?.host)
        .filter((host): host is string => Boolean(host));
      const fans = await discoverFans(
        [...this.settings.hosts, ...cachedHosts].map(normalizeHost),
        this.settings.scanTimeoutMs,
        this.settings.discover,
      );

      this.sync(fans);
      this.log.info(`WAC discovery finished: ${fans.length} fan(s) available.`);
    } finally {
      this.discoveryRunning = false;
    }
  }

  private startDiscoveryTimer(): void {
    if (this.settings.discoveryIntervalMs === 0 || this.discoveryTimer) {
      return;
    }

    this.discoveryTimer = setInterval(() => {
      this.discoverDevices().catch((error: unknown) => {
        this.log.error(`Discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, this.settings.discoveryIntervalMs);

    this.discoveryTimer.unref?.();
  }

  private sync(fans: readonly DiscoveredFan[]): void {
    const seen = new Set<string>();

    for (const fan of fans) {
      const uuid = this.api.hap.uuid.generate(fan.clientId);
      const accessory = this.accessories.get(uuid) ?? new this.api.platformAccessory(fan.deviceName, uuid);
      const cached = this.accessories.has(uuid);
      seen.add(uuid);
      (accessory.context as Context).device = { ...fan, lastSeen: new Date().toISOString() };
      this.attach(uuid, accessory, fan);

      if (!cached) {
        this.log.info(`Adding fan ${fan.deviceName} at ${fan.host}.`);
        this.accessories.set(uuid, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      } else {
        this.log.info(`Restored fan ${fan.deviceName} at ${fan.host}.`);
      }
    }

    for (const [uuid, accessory] of this.accessories) {
      if (seen.has(uuid)) {
        continue;
      }

      if (this.settings.removeStaleAccessories) {
        this.controllers.get(uuid)?.stop();
        this.controllers.delete(uuid);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.delete(uuid);
      } else {
        const device = (accessory.context as Context).device;
        if (!device) {
          continue;
        }

        this.log.warn(`Keeping cached fan ${accessory.displayName}; it was not discovered this run.`);
        this.attach(uuid, accessory, device);
      }
    }
  }

  private attach(uuid: string, accessory: PlatformAccessory, fan: DiscoveredFan): void {
    this.controllers.get(uuid)?.stop();
    this.controllers.set(uuid, new WacFanAccessory(this, accessory, fan));
  }
}
