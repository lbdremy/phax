import type { PhaxConfig, PhaxUserOverlay } from "../../schemas/phaxConfig.js";

type GateProfiles = PhaxConfig["gateProfiles"];

function unionStrings(...arrays: (readonly string[] | undefined)[]): readonly string[] | undefined {
  if (arrays.every((a) => a === undefined)) return undefined;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const arr of arrays) {
    for (const item of arr ?? []) {
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }
  }
  return result;
}

export function mergeConfigLayers(input: {
  readonly project: PhaxConfig;
  readonly globalUser?: PhaxUserOverlay;
  readonly localUser?: PhaxUserOverlay;
}): PhaxConfig {
  const { project, globalUser, localUser } = input;

  if (globalUser === undefined && localUser === undefined) {
    return project;
  }

  // state.root: scalar override (lowest → highest: project < globalUser < localUser)
  const stateRoot = localUser?.state?.root ?? globalUser?.state?.root ?? project.state?.root;

  // agent: independent scalar overrides per field
  const maxFixAttempts =
    localUser?.agent?.maxFixAttempts ??
    globalUser?.agent?.maxFixAttempts ??
    project.agent?.maxFixAttempts;
  const extractPlanModel =
    localUser?.agent?.extractPlan?.model ??
    globalUser?.agent?.extractPlan?.model ??
    project.agent?.extractPlan?.model;
  const extractPlanEffort =
    localUser?.agent?.extractPlan?.effort ??
    globalUser?.agent?.extractPlan?.effort ??
    project.agent?.extractPlan?.effort;
  const hasAgent =
    maxFixAttempts !== undefined ||
    extractPlanModel !== undefined ||
    extractPlanEffort !== undefined;
  const hasExtractPlan = extractPlanModel !== undefined || extractPlanEffort !== undefined;

  // fileReconciliation: scalar override
  const fileReconciliationMode =
    localUser?.fileReconciliation?.mode ??
    globalUser?.fileReconciliation?.mode ??
    project.fileReconciliation?.mode;

  // security: scalar overrides + allowlist unions
  const securityProfile =
    localUser?.security?.profile ?? globalUser?.security?.profile ?? project.security?.profile;
  const networkProfile =
    localUser?.security?.network?.profile ??
    globalUser?.security?.network?.profile ??
    project.security?.network?.profile;
  const mcpMode =
    localUser?.security?.mcp?.mode ??
    globalUser?.security?.mcp?.mode ??
    project.security?.mcp?.mode;
  const allowRead = unionStrings(
    project.security?.filesystem?.allowRead,
    globalUser?.security?.filesystem?.allowRead,
    localUser?.security?.filesystem?.allowRead,
  );
  const allowWrite = unionStrings(
    project.security?.filesystem?.allowWrite,
    globalUser?.security?.filesystem?.allowWrite,
    localUser?.security?.filesystem?.allowWrite,
  );
  const mcpAllow = unionStrings(
    project.security?.mcp?.allow,
    globalUser?.security?.mcp?.allow,
    localUser?.security?.mcp?.allow,
  );
  const agentCommands = unionStrings(
    project.security?.agentCommands,
    globalUser?.security?.agentCommands,
    localUser?.security?.agentCommands,
  );
  const hasSecurity =
    securityProfile !== undefined ||
    networkProfile !== undefined ||
    mcpMode !== undefined ||
    allowRead !== undefined ||
    allowWrite !== undefined ||
    mcpAllow !== undefined ||
    agentCommands !== undefined;
  const hasFilesystem = allowRead !== undefined || allowWrite !== undefined;
  const hasMcp = mcpMode !== undefined || mcpAllow !== undefined;

  // gateProfiles: union by key; higher layer's value wins per key
  const gateProfiles: GateProfiles = {
    ...project.gateProfiles,
    ...globalUser?.gateProfiles,
    ...localUser?.gateProfiles,
  };

  // publish: per-field scalar override (enabled is required when publish is present)
  const hasPublish =
    project.publish !== undefined ||
    globalUser?.publish !== undefined ||
    localUser?.publish !== undefined;
  const publishEnabled =
    localUser?.publish?.enabled ?? globalUser?.publish?.enabled ?? project.publish?.enabled;
  const publishRemote =
    localUser?.publish?.remote ?? globalUser?.publish?.remote ?? project.publish?.remote;
  const publishProvider =
    localUser?.publish?.provider ?? globalUser?.publish?.provider ?? project.publish?.provider;
  const publishPushBranch =
    localUser?.publish?.pushBranch ??
    globalUser?.publish?.pushBranch ??
    project.publish?.pushBranch;
  const publishCreatePullRequest =
    localUser?.publish?.createPullRequest ??
    globalUser?.publish?.createPullRequest ??
    project.publish?.createPullRequest;
  const publishBaseBranch =
    localUser?.publish?.baseBranch ??
    globalUser?.publish?.baseBranch ??
    project.publish?.baseBranch;
  const publishTitle =
    localUser?.publish?.title ?? globalUser?.publish?.title ?? project.publish?.title;

  // review.compliance: per-field scalar override (enabled is required when compliance is present)
  const hasCompliance =
    project.review?.compliance !== undefined ||
    globalUser?.review?.compliance !== undefined ||
    localUser?.review?.compliance !== undefined;
  const complianceEnabled =
    localUser?.review?.compliance?.enabled ??
    globalUser?.review?.compliance?.enabled ??
    project.review?.compliance?.enabled;
  const complianceModel =
    localUser?.review?.compliance?.model ??
    globalUser?.review?.compliance?.model ??
    project.review?.compliance?.model;
  const complianceEffort =
    localUser?.review?.compliance?.effort ??
    globalUser?.review?.compliance?.effort ??
    project.review?.compliance?.effort;

  // commands: per-field scalar override (higher layer replaces wholesale per field)
  const commandsSetup =
    localUser?.commands?.setup ?? globalUser?.commands?.setup ?? project.commands?.setup;
  const commandsCleanup =
    localUser?.commands?.cleanup ?? globalUser?.commands?.cleanup ?? project.commands?.cleanup;
  const hasCommands = commandsSetup !== undefined || commandsCleanup !== undefined;

  // workspaces: wholesale override (highest present layer wins)
  const workspaces = localUser?.workspaces ?? globalUser?.workspaces ?? project.workspaces;

  return {
    ...(project.$schema !== undefined ? { $schema: project.$schema } : {}),
    version: project.version,
    name: project.name,
    ...(stateRoot !== undefined ? { state: { root: stateRoot } } : {}),
    ...(hasAgent
      ? {
          agent: {
            ...(maxFixAttempts !== undefined ? { maxFixAttempts } : {}),
            ...(hasExtractPlan
              ? {
                  extractPlan: {
                    ...(extractPlanModel !== undefined ? { model: extractPlanModel } : {}),
                    ...(extractPlanEffort !== undefined ? { effort: extractPlanEffort } : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(hasCommands
      ? {
          commands: {
            ...(commandsSetup !== undefined ? { setup: commandsSetup } : {}),
            ...(commandsCleanup !== undefined ? { cleanup: commandsCleanup } : {}),
          },
        }
      : {}),
    ...(fileReconciliationMode !== undefined
      ? { fileReconciliation: { mode: fileReconciliationMode } }
      : {}),
    ...(hasSecurity
      ? {
          security: {
            ...(securityProfile !== undefined ? { profile: securityProfile } : {}),
            ...(hasFilesystem
              ? {
                  filesystem: {
                    ...(allowRead !== undefined ? { allowRead: [...allowRead] } : {}),
                    ...(allowWrite !== undefined ? { allowWrite: [...allowWrite] } : {}),
                  },
                }
              : {}),
            ...(networkProfile !== undefined ? { network: { profile: networkProfile } } : {}),
            ...(hasMcp
              ? {
                  mcp: {
                    ...(mcpMode !== undefined ? { mode: mcpMode } : {}),
                    ...(mcpAllow !== undefined ? { allow: [...mcpAllow] } : {}),
                  },
                }
              : {}),
            ...(agentCommands !== undefined ? { agentCommands: [...agentCommands] } : {}),
          },
        }
      : {}),
    ...(hasPublish && publishEnabled !== undefined
      ? {
          publish: {
            enabled: publishEnabled,
            ...(publishRemote !== undefined ? { remote: publishRemote } : {}),
            ...(publishProvider !== undefined ? { provider: publishProvider } : {}),
            ...(publishPushBranch !== undefined ? { pushBranch: publishPushBranch } : {}),
            ...(publishCreatePullRequest !== undefined
              ? { createPullRequest: publishCreatePullRequest }
              : {}),
            ...(publishBaseBranch !== undefined ? { baseBranch: publishBaseBranch } : {}),
            ...(publishTitle !== undefined ? { title: publishTitle } : {}),
          },
        }
      : {}),
    ...(hasCompliance && complianceEnabled !== undefined
      ? {
          review: {
            compliance: {
              enabled: complianceEnabled,
              ...(complianceModel !== undefined ? { model: complianceModel } : {}),
              ...(complianceEffort !== undefined ? { effort: complianceEffort } : {}),
            },
          },
        }
      : {}),
    gateProfiles,
    ...(workspaces !== undefined ? { workspaces } : {}),
  };
}
