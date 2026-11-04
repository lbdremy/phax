// `phax security status` as the runner reads it: the security capabilities of each provider and
// whether it is available. The group is held whole by the runner, so `phax security` alone is the
// group's help and a refusal like every group (q-security-bare: refuse-bare); `--verbose` and
// `--trace` are the program's options, and the command declares none of its own.
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { loadProviderConfig } from "../../app/loadRouting.js";
import { formatSecurityStatusReport, getSecurityStatus } from "../../app/securityStatus.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { NodeShellLayer } from "../../infra/shell.js";
import { defineCommand, defineGroup, reject } from "../commandLibrary/contract/index.js";
import { exposeMessage, MessageFields } from "./shared.js";

const SecurityStatusOutput = Schema.Struct({
  providers: Schema.Array(
    Schema.Struct({
      provider: Schema.Literal("claude-code", "codex-cli", "mistral-vibe"),
      available: Schema.Boolean,
      filesystemJail: Schema.String,
      mcpAllowlist: Schema.String,
      defaultSecureSupported: Schema.Boolean,
    }),
  ),
});

const securityStatusCommand = defineCommand({
  name: "status",
  summary: "Show provider security capabilities and availability",
  input: {},
  output: reject(SecurityStatusOutput),
  run: () =>
    Effect.gen(function* () {
      const providerConfig = yield* loadProviderConfig().pipe(
        Effect.provide(NodeFileSystemLayer),
        Effect.provide(NodeShellLayer),
      );
      return yield* getSecurityStatus(providerConfig).pipe(Effect.provide(NodeShellLayer));
    }).pipe(Effect.mapError(exposeMessage)),
  exits: { ConfigValidationError: 2 },
  errors: { ConfigValidationError: MessageFields },
  texts: {
    ConfigValidationError: (error) => `Failed to load provider config: ${error.message}`,
  },
  render: (value) => formatSecurityStatusReport(value),
});

export const securityGroup = defineGroup({
  name: "security",
  summary: "Security-related commands",
  commands: [securityStatusCommand],
});
