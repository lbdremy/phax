import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { upgradeConfigSchema } from "../../src/app/initProject.js";

let repoDir: string;

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "phax-schema-upgrade-test-"));
  execSync("git init", { cwd: repoDir, stdio: "ignore" });
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("upgradeConfigSchema", () => {
  it("returns no_config when there is no phax.json", () => {
    const result = upgradeConfigSchema(repoDir);
    expect(result.kind).toBe("no_config");
  });

  it("returns updated and writes both schema files when phax.json exists but no schemas", () => {
    writeFileSync(join(repoDir, "phax.json"), JSON.stringify({ version: 1 }));
    const result = upgradeConfigSchema(repoDir);
    expect(result.kind).toBe("updated");
    if (result.kind === "updated") {
      expect(result.schemaPath).toBe(join(repoDir, "phax.schema.json"));
      expect(result.userSchemaPath).toBe(join(repoDir, "phax.user.schema.json"));
    }
    const written = readFileSync(join(repoDir, "phax.schema.json"), "utf8");
    expect(written.length).toBeGreaterThan(0);
    const userWritten = readFileSync(join(repoDir, "phax.user.schema.json"), "utf8");
    expect(userWritten.length).toBeGreaterThan(0);
  });

  it("returns current on a second call when both schemas are already up to date", () => {
    writeFileSync(join(repoDir, "phax.json"), JSON.stringify({ version: 1 }));
    upgradeConfigSchema(repoDir);
    const result = upgradeConfigSchema(repoDir);
    expect(result.kind).toBe("current");
    if (result.kind === "current") {
      expect(result.schemaPath).toBe(join(repoDir, "phax.schema.json"));
      expect(result.userSchemaPath).toBe(join(repoDir, "phax.user.schema.json"));
    }
  });

  it("returns updated after the project schema file is mutated", () => {
    writeFileSync(join(repoDir, "phax.json"), JSON.stringify({ version: 1 }));
    upgradeConfigSchema(repoDir);
    writeFileSync(join(repoDir, "phax.schema.json"), "stale content");
    const result = upgradeConfigSchema(repoDir);
    expect(result.kind).toBe("updated");
  });

  it("returns updated after the user schema file is mutated", () => {
    writeFileSync(join(repoDir, "phax.json"), JSON.stringify({ version: 1 }));
    upgradeConfigSchema(repoDir);
    writeFileSync(join(repoDir, "phax.user.schema.json"), "stale content");
    const result = upgradeConfigSchema(repoDir);
    expect(result.kind).toBe("updated");
  });

  it("declares the gate step input key as gate-request only, with no default, leaving phax.json alone", () => {
    const phaxJson = JSON.stringify({
      version: 1,
      name: "example",
      gateProfiles: {
        standard: [{ command: "pnpm test", surface: "local", firing: "every-phase" }],
      },
    });
    writeFileSync(join(repoDir, "phax.json"), phaxJson);

    upgradeConfigSchema(repoDir);

    expect(readFileSync(join(repoDir, "phax.json"), "utf8")).toBe(phaxJson);
    type StepSchema = {
      required: string[];
      properties: Record<string, { enum?: unknown[]; default?: unknown; description?: string }>;
    };
    type ProfilesSchema = { patternProperties: Record<string, { items: StepSchema }> };
    for (const file of ["phax.schema.json", "phax.user.schema.json"]) {
      const schema = JSON.parse(readFileSync(join(repoDir, file), "utf8")) as {
        properties: {
          gateProfiles: ProfilesSchema;
          workspaces: { items: { properties: { gateProfiles: ProfilesSchema } } };
        };
      };
      const steps = [
        schema.properties.gateProfiles.patternProperties[""]!.items,
        schema.properties.workspaces.items.properties.gateProfiles.patternProperties[""]!.items,
      ];
      for (const step of steps) {
        const input = step.properties["input"];
        expect(input?.enum, file).toEqual(["gate-request"]);
        expect(input && "default" in input, file).toBe(false);
        expect(input?.description, file).toContain("checks-attempt-NN.request.json");
        expect(step.required, file).not.toContain("input");
      }
    }
  });

  it("describes the brief key with a required command and push in both schemas, leaving phax.json alone", () => {
    const phaxJson = JSON.stringify({
      version: 1,
      name: "example",
      gateProfiles: {
        standard: [{ command: "pnpm test", surface: "local", firing: "every-phase" }],
      },
    });
    writeFileSync(join(repoDir, "phax.json"), phaxJson);

    upgradeConfigSchema(repoDir);

    expect(readFileSync(join(repoDir, "phax.json"), "utf8")).toBe(phaxJson);
    for (const file of ["phax.schema.json", "phax.user.schema.json"]) {
      const schema = JSON.parse(readFileSync(join(repoDir, file), "utf8")) as {
        properties: Record<
          string,
          {
            required?: string[];
            properties?: Record<string, { description?: string; enum?: string[] }>;
          }
        >;
      };
      const brief = schema.properties["brief"];
      expect(brief, file).toBeDefined();
      expect(brief?.required, file).toEqual(["command", "push"]);
      expect(brief?.properties?.["command"]?.description, file).toContain("brief report");
      expect(brief?.properties?.["push"]?.enum, file).toEqual(["findings", "findings-and-rules"]);
    }
  });

  it("writes the schema even when phax.json contains invalid JSON", () => {
    writeFileSync(join(repoDir, "phax.json"), "not valid json {{");
    const result = upgradeConfigSchema(repoDir);
    expect(result.kind).toBe("updated");
    const written = readFileSync(join(repoDir, "phax.schema.json"), "utf8");
    expect(written.length).toBeGreaterThan(0);
  });
});
