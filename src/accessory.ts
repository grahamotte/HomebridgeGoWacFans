import type { CharacteristicValue, PlatformAccessory, Service } from "homebridge";
import type { GoWacFansPlatform } from "./platform.js";
import { mapState, speedFromHomeKit, WacClient, WacError, type FanChange, type FanValues } from "./wac.js";

interface Device {
  readonly clientId: string;
  readonly host: string;
  readonly mac: string;
  readonly deviceName: string;
  readonly fanType: string;
  readonly firmwareVersion: string;
  readonly lightType: string;
}

const CACHE_TTL_MS = 5000;

export class WacFanAccessory {
  private readonly client: WacClient;
  private readonly fan: Service;
  private readonly light?: Service;
  private values?: FanValues;
  private lastRefreshMs = 0;
  private refreshPromise?: Promise<FanValues>;
  private pollTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly platform: GoWacFansPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly device: Device,
  ) {
    this.client = new WacClient(device.host, platform.settings.requestTimeoutMs);
    this.fan =
      accessory.getService(platform.Service.Fanv2) ??
      accessory.addService(platform.Service.Fanv2);
    this.light = device.lightType
      ? accessory.getService(platform.Service.Lightbulb) ??
        accessory.addService(platform.Service.Lightbulb)
      : undefined;

    this.setInfo();
    this.bind();
    this.startPolling();
    this.refresh().catch((error: unknown) => this.logFailure(error));
  }

  private setInfo(): void {
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)
      ?.setCharacteristic(this.platform.Characteristic.Manufacturer, "WAC")
      .setCharacteristic(this.platform.Characteristic.Model, this.device.fanType)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.mac)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, this.device.firmwareVersion)
      .setCharacteristic(this.platform.Characteristic.Name, this.device.deviceName);

    this.fan.setCharacteristic(this.platform.Characteristic.Name, this.device.deviceName);
    this.light?.setCharacteristic(this.platform.Characteristic.Name, `${this.device.deviceName} Light`);
  }

  private bind(): void {
    this.fan.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(async () => (await this.get()).active)
      .onSet((value) => this.setFanActive(value));
    this.fan.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({ minStep: 100 / 6 })
      .onGet(async () => (await this.get()).speed)
      .onSet((value) => this.setSpeed(value));
    this.fan.getCharacteristic(this.platform.Characteristic.RotationDirection)
      .onGet(async () => (await this.get()).direction)
      .onSet((value) => this.set({ fanDirection: Number(value) === 1 ? "reverse" : "forward" }));

    this.light?.getCharacteristic(this.platform.Characteristic.On)
      .onGet(async () => (await this.get()).lightOn)
      .onSet((value) => this.set({ lightOn: Boolean(value) }));
    this.light?.getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(async () => (await this.get()).brightness)
      .onSet((value) => this.set({ lightOn: Number(value) > 0, lightBrightness: Number(value) }));
  }

  private startPolling(): void {
    if (this.platform.settings.pollIntervalMs === 0) {
      return;
    }

    this.pollTimer = setInterval(() => {
      this.refresh().catch((error: unknown) => this.logFailure(error));
    }, this.platform.settings.pollIntervalMs);

    this.pollTimer.unref?.();
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private async get(): Promise<FanValues> {
    if (this.values && Date.now() - this.lastRefreshMs < CACHE_TTL_MS) {
      return this.values;
    }

    return this.refresh();
  }

  private async refresh(): Promise<FanValues> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.client.getState()
      .then((state) => {
        const values = mapState(state);
        this.values = values;
        this.lastRefreshMs = Date.now();
        this.update(values);
        return values;
      })
      .finally(() => {
        this.refreshPromise = undefined;
      });

    return this.refreshPromise;
  }

  private async setFanActive(value: CharacteristicValue): Promise<void> {
    const active = Number(value) === 1;
    const current = await this.get();
    await this.set({ fanOn: active, fanSpeed: active ? speedFromHomeKit(current.speed || 16.7) : undefined });
  }

  private async setSpeed(value: CharacteristicValue): Promise<void> {
    const speed = Number(value);
    await this.set(speed <= 0 ? { fanOn: false } : { fanOn: true, fanSpeed: speedFromHomeKit(speed) });
  }

  private async set(change: FanChange): Promise<void> {
    try {
      this.platform.log.debug(`${this.device.deviceName}: ${JSON.stringify(change)}`);
      const state = await this.client.set(change);
      const values = mapState(state);
      this.values = values;
      this.lastRefreshMs = Date.now();
      this.update(values);
    } catch (error) {
      throw this.toHapError(error);
    }
  }

  private update(values: FanValues): void {
    this.fan.getCharacteristic(this.platform.Characteristic.Active).updateValue(values.active);
    this.fan.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(values.speed);
    this.fan.getCharacteristic(this.platform.Characteristic.RotationDirection).updateValue(values.direction);
    this.light?.getCharacteristic(this.platform.Characteristic.On).updateValue(values.lightOn);
    this.light?.getCharacteristic(this.platform.Characteristic.Brightness).updateValue(values.brightness);
  }

  private logFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.platform.log.warn(`${this.device.deviceName}: ${message}`);
  }

  private toHapError(error: unknown): Error {
    this.logFailure(error);
    return error instanceof WacError
      ? new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      : error instanceof Error ? error : new Error(String(error));
  }
}
