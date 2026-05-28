import { InMemoryTelemetry } from "../telemetry/inMemory.js";
import { Layer } from "effect";
import { SystemTelemetry } from "../../ports/systemTelemetry.js";

export const makeFakeSystemTelemetry = () => {
  const impl = new InMemoryTelemetry();
  const layer = Layer.succeed(SystemTelemetry, impl);
  return { impl, layer } as const;
};
