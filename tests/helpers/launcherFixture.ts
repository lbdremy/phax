// The npm launcher (`npm/bin/phax`) as tests drive it: the file loaded through `require`, which
// starts nothing and exports its functions, and a local HTTP server standing in for GitHub.
//
//   const launcher = loadLauncher();
//   const server = await startFixtureServer();
//   server.route("/releases/download/v0.43.0/phax-darwin-arm64", { kind: "bytes", body });
//   const config = testConfig(home, server);
//   await launcher.ensureBinary(config, "phax-darwin-arm64");
//
// The server speaks plain HTTP on 127.0.0.1, so `testConfig` swaps the transport, the scheme and
// the allowed hosts; every other value stays the shipped one unless a test overrides it.
import { createRequire } from "node:module";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const LAUNCHER_PATH = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "npm",
  "bin",
  "phax",
);

interface LauncherConfig {
  readonly version: string;
  readonly home: string;
  readonly releaseBase: string;
  readonly updateUrl: string;
  readonly transport: unknown;
  readonly scheme: string;
  readonly allowedHosts: {
    readonly exact: readonly string[];
    readonly suffixes: readonly string[];
  };
  readonly maxRedirects: number;
  readonly connectTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly updateTimeoutMs: number;
}

interface Launcher {
  productionConfig(): LauncherConfig;
  getBinaryName(platform: string, arch: string): string;
  releaseUrls(config: LauncherConfig, name: string): { binary: string; checksum: string };
  cachePath(config: LauncherConfig, name: string): string;
  checkRedirect(config: LauncherConfig, fromUrl: string, location: string): string;
  ensureBinary(config: LauncherConfig, name: string): Promise<string>;
  startBinary(
    binPath: string,
    args: readonly string[],
  ): Promise<
    | { readonly code: number | null; readonly signal: string | null }
    | { readonly error: { readonly code: string; readonly message: string } }
  >;
  refreshUpdateCache(config: LauncherConfig): Promise<void>;
}

/** The shipped launcher, loaded without running it. */
export function loadLauncher(): Launcher {
  const load: (id: string) => Launcher = createRequire(import.meta.url);
  return load(LAUNCHER_PATH);
}

/** The absolute path of the shipped launcher. */
export const LAUNCHER_SOURCE = LAUNCHER_PATH;

type Route =
  | { readonly kind: "bytes"; readonly body: string | Buffer }
  | { readonly kind: "redirect"; readonly status: number; readonly location: string }
  | { readonly kind: "status"; readonly status: number }
  /** Accept the request and never answer. */
  | { readonly kind: "hold" }
  /** Send the headers and `body`, announcing more bytes, then never send them. */
  | { readonly kind: "partial"; readonly body: string | Buffer }
  /** Send `body` in `chunks` pieces, one every `intervalMs`. */
  | {
      readonly kind: "trickle";
      readonly body: string | Buffer;
      readonly chunks: number;
      readonly intervalMs: number;
    }
  /** Hold every request on the path until `count` have arrived, then serve them all. */
  | { readonly kind: "barrier"; readonly count: number; readonly body: string | Buffer };

interface FixtureServer {
  /** `http://127.0.0.1:<port>`. */
  readonly origin: string;
  readonly port: number;
  /** Every request received, in order. */
  readonly log: readonly { readonly method: string; readonly path: string }[];
  route(path: string, route: Route): void;
  close(): Promise<void>;
}

/** A fixture server on 127.0.0.1 and a free port. A path with no route answers 404. */
export async function startFixtureServer(): Promise<FixtureServer> {
  const routes = new Map<string, Route>();
  const log: { method: string; path: string }[] = [];
  const held = new Set<IncomingMessage>();
  const waiting = new Map<string, ServerResponse[]>();

  const serve = (res: ServerResponse, body: string | Buffer): void => {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(body);
  };

  const server = http.createServer((req, res) => {
    const path = req.url ?? "/";
    log.push({ method: req.method ?? "", path });
    const route = routes.get(path);
    if (route === undefined) {
      res.writeHead(404).end();
      return;
    }
    switch (route.kind) {
      case "bytes":
        serve(res, route.body);
        return;
      case "redirect":
        res.writeHead(route.status, { Location: route.location }).end();
        return;
      case "status":
        res.writeHead(route.status).end();
        return;
      case "hold":
        held.add(req);
        req.on("close", () => held.delete(req));
        return;
      case "partial": {
        const body = Buffer.from(route.body);
        held.add(req);
        req.on("close", () => held.delete(req));
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": body.length + 1024,
        });
        res.write(body);
        return;
      }
      case "trickle": {
        const body = Buffer.from(route.body);
        const size = Math.ceil(body.length / route.chunks);
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        let sent = 0;
        const timer = setInterval(() => {
          res.write(body.subarray(sent, sent + size));
          sent += size;
          if (sent >= body.length) {
            clearInterval(timer);
            res.end();
          }
        }, route.intervalMs);
        res.on("close", () => clearInterval(timer));
        return;
      }
      case "barrier": {
        const queue = waiting.get(path) ?? [];
        queue.push(res);
        waiting.set(path, queue);
        if (queue.length >= route.count) {
          waiting.delete(path);
          for (const pending of queue) serve(pending, route.body);
        }
        return;
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === "string")
    throw new Error("fixture server has no port");
  const { port } = address;

  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    log,
    route: (path, route) => {
      routes.set(path, route);
    },
    close: async () => {
      for (const req of held) req.socket.destroy();
      for (const queue of waiting.values()) for (const res of queue) res.socket?.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** The shipped config, pointed at `server` with `home` as the user's home. */
export function testConfig(
  home: string,
  server: FixtureServer,
  overrides: Partial<LauncherConfig> = {},
): LauncherConfig {
  return {
    ...loadLauncher().productionConfig(),
    home,
    releaseBase: `${server.origin}/releases/download`,
    updateUrl: `${server.origin}/repos/lbdremy/phax/releases/latest`,
    transport: http,
    scheme: "http:",
    allowedHosts: { exact: ["127.0.0.1"], suffixes: [] },
    ...overrides,
  };
}
