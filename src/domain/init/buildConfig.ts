import type { PhaxConfig } from "../../schemas/phaxConfig.js";

export type WizardAnswers = {
  readonly name: string;
  readonly gateCommands: ReadonlyArray<string>;
  readonly complianceEnabled: boolean;
  readonly publishAuto: boolean;
  readonly publishPushBranch: boolean;
  readonly publishCreatePr: boolean;
};

const GATE_PLACEHOLDER = "echo 'replace with your gate commands in phax.json'";

export function buildPhaxConfig(answers: WizardAnswers): PhaxConfig {
  const rawCommands = answers.gateCommands.length > 0 ? answers.gateCommands : [GATE_PLACEHOLDER];
  const commandList: [string, ...string[]] = [rawCommands[0]!, ...rawCommands.slice(1)];

  return {
    $schema: "./phax.schema.json",
    version: 1,
    name: answers.name,
    gateProfiles: { fast: commandList },
    ...(answers.complianceEnabled ? { review: { compliance: { enabled: true } } } : {}),
    ...(answers.publishAuto
      ? {
          publish: {
            auto: true,
            pushBranch: answers.publishPushBranch,
            createPullRequest: answers.publishCreatePr,
          },
        }
      : {}),
  };
}
