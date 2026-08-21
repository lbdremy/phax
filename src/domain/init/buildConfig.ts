import type { GateStep, PhaxConfig } from "../../schemas/phaxConfig.js";
import type { RecordsConfig } from "../../schemas/recordsConfig.js";

export type WizardAnswers = {
  readonly name: string;
  readonly gateCommands: ReadonlyArray<string>;
  readonly complianceEnabled: boolean;
  readonly publishAuto: boolean;
  readonly publishPushBranch: boolean;
  readonly publishCreatePr: boolean;
  readonly records?: RecordsConfig;
};

const GATE_PLACEHOLDER = "echo 'replace with your gate commands in phax.json'";

const toGateStep = (command: string): GateStep => ({
  command,
  surface: "local",
  firing: "every-phase",
});

export function buildPhaxConfig(answers: WizardAnswers): PhaxConfig {
  const rawCommands = answers.gateCommands.length > 0 ? answers.gateCommands : [GATE_PLACEHOLDER];
  const stepList: [GateStep, ...GateStep[]] = [
    toGateStep(rawCommands[0]!),
    ...rawCommands.slice(1).map(toGateStep),
  ];

  return {
    $schema: "./phax.schema.json",
    version: 1,
    name: answers.name,
    gateProfiles: { fast: stepList },
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
    ...(answers.records !== undefined ? { records: answers.records } : {}),
  };
}
