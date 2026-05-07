export interface FanInfo {
  readonly clientId: string;
  readonly mac: string;
  readonly deviceName: string;
  readonly fanType: string;
  readonly firmwareVersion: string;
  readonly lightType: string;
}

export interface FanState {
  readonly clientId: string;
  readonly fanOn: boolean;
  readonly fanSpeed: number;
  readonly fanDirection: "forward" | "reverse";
  readonly lightOn: boolean;
  readonly lightBrightness: number;
}

export interface FanValues {
  readonly active: number;
  readonly speed: number;
  readonly direction: number;
  readonly lightOn: boolean;
  readonly brightness: number;
}

export type FanChange = Partial<Pick<FanState, "fanOn" | "fanSpeed" | "fanDirection" | "lightOn" | "lightBrightness">>;

export class WacError extends Error {
  constructor(message: string, public readonly host: string, public readonly cause?: unknown) {
    super(message);
    this.name = "WacError";
  }
}

export class WacClient {
  constructor(public readonly host: string, private readonly timeoutMs: number) {}

  async getInfo(): Promise<FanInfo> {
    return parseInfo(await this.request({ queryStaticShadowData: 1 }));
  }

  async getState(): Promise<FanState> {
    return parseState(await this.request({ queryDynamicShadowData: 1 }));
  }

  async set(change: FanChange): Promise<FanState> {
    return parseState(await this.request(change));
  }

  private async request(payload: object): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`http://${this.host}/mf`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }

      return response.json();
    } catch (error) {
      throw toWacError(this.host, "Fan request failed", error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function mapState(state: FanState): FanValues {
  return {
    active: state.fanOn ? 1 : 0,
    speed: state.fanOn ? (state.fanSpeed * 100) / 6 : 0,
    direction: state.fanDirection === "forward" ? 0 : 1,
    lightOn: state.lightOn,
    brightness: state.lightBrightness
  };
}

export function speedFromHomeKit(value: number): number {
  return Math.min(Math.max(Math.round((value / 100) * 6), 1), 6);
}

function parseInfo(data: unknown): FanInfo {
  const record = requireRecord(data);
  return {
    clientId: readString(record.clientId, ""),
    mac: readString(record.mac, readString(record.clientId, "")),
    deviceName: readString(record.deviceName, "WAC Fan"),
    fanType: readString(record.fanType, "Fan"),
    firmwareVersion: readString(record.firmwareVersion, ""),
    lightType: readString(record.lightType, "")
  };
}

function parseState(data: unknown): FanState {
  const record = requireRecord(data);
  return {
    clientId: readString(record.clientId, ""),
    fanOn: readBool(record.fanOn, false),
    fanSpeed: readNumber(record.fanSpeed, 1),
    fanDirection: readString(record.fanDirection, "forward") === "reverse" ? "reverse" : "forward",
    lightOn: readBool(record.lightOn, false),
    lightBrightness: readNumber(record.lightBrightness, 100)
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("Fan response was not an object");
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toWacError(host: string, message: string, error: unknown): WacError {
  if (error instanceof WacError) {
    return error;
  }

  if (error instanceof Error) {
    return new WacError(`${message}: ${error.message}`, host, error);
  }

  return new WacError(message, host, error);
}
