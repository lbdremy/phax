import { Result } from "effect";

/** A port read from a setting, or why the setting is not one. */
export type PortReading = Result.Result<number, string>;

export function readPort(text: string): PortReading {
  const port = Number(text);
  if (Number.isInteger(port) && port > 0 && port < 65536) return Result.succeed(port);
  return Result.fail(`not a port: ${text}`);
}

export function describePort(reading: PortReading): string {
  return Result.match(reading, {
    onFailure: (reason) => `refused (${reason})`,
    onSuccess: (port) => `port ${port}`,
  });
}

export function portOrDefault(reading: PortReading): number {
  return Result.getOrElse(reading, () => 8080);
}

export const defaultPort: number = Result.getOrThrow(readPort("8080"));

export function nextPort(reading: PortReading): PortReading {
  return Result.map(reading, (port) => port + 1);
}

export function underSetting(reading: PortReading, setting: string): PortReading {
  return Result.mapError(reading, (reason) => `${setting}: ${reason}`);
}

export function countRefused(readings: ReadonlyArray<PortReading>): number {
  return readings.filter((reading) => Result.isFailure(reading)).length;
}

export function countAccepted(readings: ReadonlyArray<PortReading>): number {
  return readings.filter((reading) => Result.isSuccess(reading)).length;
}
