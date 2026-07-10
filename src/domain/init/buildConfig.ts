import type { GateStep, PhaxConfig } from "../../schemas/phaxConfig.js";

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
  const firstStep: GateStep = { command: rawCommands[0]!, surface: "local", firing: "every-phase" };
  const restSteps: GateStep[] = rawCommands
    .slice(1)
    .map((command) => ({ command, surface: "local", firing: "every-phase" as const }));
  const stepList: [GateStep, ...GateStep[]] = [firstStep, ...restSteps];

  return {
    $schema: "./phax.schema.json",
    version: 1,
    name: answers.name,
    gateProfiles: { standard: stepList },
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
