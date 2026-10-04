import { describe, expect, it } from "vitest";
import type { Fetch } from "../../../site/build/deploy-guard.js";
import { checkPreview, previewAlias, readUpload } from "../../../site/build/preview-check.js";

const PREVIEW = "https://v0-18-0-phax-docs.example.workers.dev";

// Shaped like wrangler 4's WRANGLER_OUTPUT_FILE_PATH entries.
const SESSION = JSON.stringify({
  version: 1,
  type: "wrangler-session",
  wrangler_version: "4.147.0",
  command_line_args: ["versions", "upload"],
  log_file_path: "/tmp/wrangler.log",
  timestamp: "2026-10-04T00:00:00.000Z",
});
const upload = (fields: Readonly<Record<string, unknown>>) =>
  JSON.stringify({
    type: "version-upload",
    version: 1,
    worker_name: "phax-docs",
    worker_tag: "abc123",
    preview_url: "https://0f1e2d3c-phax-docs.example.workers.dev",
    worker_name_overridden: false,
    timestamp: "2026-10-04T00:00:01.000Z",
    ...fields,
  });

describe("previewAlias", () => {
  it("turns a release tag into a DNS-safe alias", () => {
    expect(previewAlias("v0.18.0")).toBe("v0-18-0");
    expect(previewAlias("v10.2.33")).toBe("v10-2-33");
  });
});

describe("readUpload", () => {
  it("reads the version id and preview alias URL of the upload entry", () => {
    const ndjson = [
      SESSION,
      upload({ version_id: "0f1e2d3c-aaaa-bbbb-cccc-000000000000", preview_alias_url: PREVIEW }),
      "",
    ].join("\n");
    expect(readUpload(ndjson)).toEqual({
      versionId: "0f1e2d3c-aaaa-bbbb-cccc-000000000000",
      previewUrl: PREVIEW,
    });
  });

  it("takes the last upload entry", () => {
    const ndjson = [
      upload({ version_id: "old", preview_alias_url: `${PREVIEW}/old` }),
      upload({ version_id: "new", preview_alias_url: PREVIEW }),
    ].join("\n");
    expect(readUpload(ndjson).versionId).toBe("new");
  });

  it("fails without an upload entry", () => {
    expect(() => readUpload(`${SESSION}\n`)).toThrow("no version-upload entry");
    expect(() => readUpload("")).toThrow("no version-upload entry");
  });

  it("fails when the entry has no version id", () => {
    expect(() => readUpload(upload({ version_id: null, preview_alias_url: PREVIEW }))).toThrow(
      "no version_id",
    );
  });

  it("fails when the entry has no preview alias URL", () => {
    expect(() => readUpload(upload({ version_id: "id" }))).toThrow("no preview_alias_url");
  });
});

interface Site {
  readonly schemaStatus?: number;
  readonly contentType?: string;
  readonly cors?: string | undefined;
  readonly homeStatus?: number;
  readonly home?: string;
}

/** A fake preview answering the registry schema and the home page as `site` says. */
function previewSite(site: Site): { readonly fetch: Fetch; readonly urls: Array<string> } {
  const urls: Array<string> = [];
  const fetch: Fetch = async (url) => {
    urls.push(url);
    if (url === `${PREVIEW}/schemas/registry/0.18.0.json`) {
      const headers = new Headers({ "content-type": site.contentType ?? "application/json" });
      const cors = "cors" in site ? site.cors : "*";
      if (cors !== undefined) headers.set("access-control-allow-origin", cors);
      return new Response("{}", { status: site.schemaStatus ?? 200, headers });
    }
    if (url === `${PREVIEW}/`) {
      return new Response(site.home ?? '<nav><a href="…/v0.18.0">v0.18.0</a></nav>', {
        status: site.homeStatus ?? 200,
        headers: { "content-type": "text/html" },
      });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetch, urls };
}

const unreachable: Fetch = async () => {
  throw new TypeError("fetch failed");
};

function counter(): {
  readonly sleep: (ms: number) => Promise<void>;
  readonly sleeps: Array<number>;
} {
  const sleeps: Array<number> = [];
  return { sleep: async (ms) => void sleeps.push(ms), sleeps };
}

describe("checkPreview", () => {
  it("passes a preview serving the JSON schema with CORS and a page showing the version", async () => {
    const { fetch, urls } = previewSite({});
    const { sleep, sleeps } = counter();
    expect(
      await checkPreview({ fetch, sleep, previewUrl: PREVIEW, release: "0.18.0" }),
    ).toBeUndefined();
    expect(urls).toEqual([`${PREVIEW}/schemas/registry/0.18.0.json`, `${PREVIEW}/`]);
    expect(sleeps).toEqual([]);
  });

  it("accepts a JSON content type with a charset and a trailing slash on the preview URL", async () => {
    const { fetch } = previewSite({ contentType: "application/json; charset=utf-8" });
    const { sleep } = counter();
    expect(
      await checkPreview({ fetch, sleep, previewUrl: `${PREVIEW}/`, release: "0.18.0" }),
    ).toBeUndefined();
  });

  it("passes once the preview starts serving within the retries", async () => {
    let calls = 0;
    const { fetch: ready } = previewSite({});
    const fetch: Fetch = async (url, init) =>
      ++calls <= 2 ? new Response("", { status: 404 }) : ready(url, init);
    const { sleep, sleeps } = counter();
    expect(
      await checkPreview({ fetch, sleep, previewUrl: PREVIEW, release: "0.18.0" }),
    ).toBeUndefined();
    expect(sleeps).toHaveLength(2);
  });

  it.each<[string, Site, string]>([
    ["a 404", { schemaStatus: 404 }, "schemas/registry/0.18.0.json answered 404"],
    ["an HTML content type", { contentType: "text/html" }, "answered Content-Type text/html"],
    ["no CORS header", { cors: undefined }, "answered Access-Control-Allow-Origin (none)"],
    ["a home page that fails", { homeStatus: 500 }, `${PREVIEW}/ answered 500`],
    ["a page with another version", { home: "<nav>v0.17.0</nav>" }, "does not show v0.18.0"],
  ])("fails %s after the bounded retries, naming what it saw", async (_name, site, seen) => {
    const { fetch } = previewSite(site);
    const { sleep, sleeps } = counter();
    const failure = await checkPreview({
      fetch,
      sleep,
      previewUrl: PREVIEW,
      release: "0.18.0",
      attempts: 3,
    });
    expect(failure).toMatch(/^✗ preview check: after 3 attempts, /);
    expect(failure).toContain(seen);
    expect(sleeps).toHaveLength(2);
  });

  it("fails when every fetch throws", async () => {
    const { sleep } = counter();
    expect(
      await checkPreview({
        fetch: unreachable,
        sleep,
        previewUrl: PREVIEW,
        release: "0.18.0",
        attempts: 2,
      }),
    ).toBe(
      `✗ preview check: after 2 attempts, could not fetch the preview at ${PREVIEW}: fetch failed`,
    );
  });
});
