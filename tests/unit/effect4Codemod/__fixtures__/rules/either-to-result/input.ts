import { Either } from "effect";

/** A port read from a setting, or why the setting is not one. */
export type PortReading = Either.Either<number, string>;

export function readPort(text: string): PortReading {
  const port = Number(text);
  if (Number.isInteger(port) && port > 0 && port < 65536) return Either.right(port);
  return Either.left(`not a port: ${text}`);
}

export function describePort(reading: PortReading): string {
  return Either.match(reading, {
    onLeft: (reason) => `refused (${reason})`,
    onRight: (port) => `port ${port}`,
  });
}

export function portOrDefault(reading: PortReading): number {
  return Either.getOrElse(reading, () => 8080);
}

export const defaultPort: number = Either.getOrThrow(readPort("8080"));

export function nextPort(reading: PortReading): PortReading {
  return Either.map(reading, (port) => port + 1);
}

export function underSetting(reading: PortReading, setting: string): PortReading {
  return Either.mapLeft(reading, (reason) => `${setting}: ${reason}`);
}

export function countRefused(readings: ReadonlyArray<PortReading>): number {
  return readings.filter((reading) => Either.isLeft(reading)).length;
}

export function countAccepted(readings: ReadonlyArray<PortReading>): number {
  return readings.filter((reading) => Either.isRight(reading)).length;
}
