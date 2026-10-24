import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service
} from "homebridge";
import { discoverFans, type DiscoveredFan } from "./discovery.js";
import { WacFanAccessory } from "./accessory.js";
import { withPluginPrefix } from "./logger.js";
import { DISCOVERY_INTERVAL_MS, PLATFORM_NAME, PLUGIN_NAME, SCAN_TIMEOUT_MS } from "./settings.js";

interface CachedDevice extends DiscoveredFan {
  readonly lastSeen: string;
  readonly unavailableSince?: string;
}

interface Context {
  device?: CachedDevice;
}

export class GoWacFansPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories = new Map<string, PlatformAccessory>();
  private readonly controllers = new Map<string, WacFanAccessory>();
  private discoveryRunning = false;
  private discoveryReported = false;
  private discoveryTimer?: ReturnType<typeof setInterval>;
  public readonly log: Logging;

  constructor(
    log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log = withPluginPrefix(log);
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

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
    const initialDiscovery = !this.discoveryReported;
    this.logDiscovery("Discovering WAC fans...", initialDiscovery);
    try {
      const cachedHosts = [...this.accessories.values()]
        .map((accessory) => (accessory.context as Context).device?.host)
        .filter((host): host is string => Boolean(host));
      const fans = await this.findFans(cachedHosts);

      const changed = this.sync(fans, initialDiscovery);
      this.logDiscovery(`WAC discovery finished: ${fans.length} fan(s) available.`, initialDiscovery || changed);
      this.discoveryReported = true;
    } finally {
      this.discoveryRunning = false;
    }
  }

  findFans(cachedHosts: readonly string[]): Promise<DiscoveredFan[]> {
    return discoverFans(cachedHosts, SCAN_TIMEOUT_MS, true);
  }

  private startDiscoveryTimer(): void {
    if (this.discoveryTimer) {
      return;
    }

    this.discoveryTimer = setInterval(() => {
      this.discoverDevices().catch((error: unknown) => {
        this.log.error(`Discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, DISCOVERY_INTERVAL_MS);

    this.discoveryTimer.unref?.();
  }

  private sync(fans: readonly DiscoveredFan[], initialDiscovery: boolean): boolean {
    const seen = new Set<string>();
    const now = new Date().toISOString();
    let changed = false;

    for (const fan of fans) {
      const uuid = this.api.hap.uuid.generate(fan.clientId);
      const accessory = this.accessories.get(uuid) ?? new this.api.platformAccessory(fan.deviceName, uuid);
      const cached = this.accessories.has(uuid);
      const previous = (accessory.context as Context).device;
      const wasUnavailable = Boolean(previous?.unavailableSince);
      const deviceChanged = previous ? hasDeviceChanged(previous, fan) : false;
      seen.add(uuid);
      (accessory.context as Context).device = { ...fan, lastSeen: now };

      if (!this.controllers.has(uuid) || deviceChanged || wasUnavailable) {
        this.attach(uuid, accessory, fan);
      }

      if (!cached) {
        this.log.info(`Adding fan ${fan.deviceName} at ${fan.host}.`);
        this.accessories.set(uuid, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        changed = true;
      } else if (initialDiscovery) {
        this.log.info(`Restored fan ${fan.deviceName} at ${fan.host}.`);
      } else if (wasUnavailable) {
        this.log.info(`Fan ${fan.deviceName} is available again at ${fan.host}.`);
        changed = true;
      } else if (deviceChanged) {
        this.log.info(`Updated fan ${fan.deviceName} at ${fan.host}.`);
        changed = true;
      }
    }

    for (const [uuid, accessory] of this.accessories) {
      if (seen.has(uuid)) {
        continue;
      }

      const device = (accessory.context as Context).device;
      if (!device) {
        continue;
      }

      if (!device.unavailableSince) {
        this.log.warn(`Keeping cached fan ${accessory.displayName}; it was not discovered this run.`);
        (accessory.context as Context).device = { ...device, unavailableSince: now };
        changed = true;
      }

      if (!this.controllers.has(uuid)) {
        this.attach(uuid, accessory, device);
      }
    }

    return changed;
  }

  private attach(uuid: string, accessory: PlatformAccessory, fan: DiscoveredFan): void {
    this.controllers.get(uuid)?.stop();
    this.controllers.set(uuid, new WacFanAccessory(this, accessory, fan));
  }

  private logDiscovery(message: string, important: boolean): void {
    if (important) {
      this.log.info(message);
    } else {
      this.log.debug(message);
    }
  }
}

function hasDeviceChanged(previous: CachedDevice, fan: DiscoveredFan): boolean {
  return previous.clientId !== fan.clientId ||
    previous.host !== fan.host ||
    previous.mac !== fan.mac ||
    previous.deviceName !== fan.deviceName ||
    previous.fanType !== fan.fanType ||
    previous.firmwareVersion !== fan.firmwareVersion ||
    previous.lightType !== fan.lightType;
}
