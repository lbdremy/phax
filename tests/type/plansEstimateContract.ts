import type * as Schema from "effect/Schema";
import type { PlansEstimateOutput } from "../../src/cli/definitions/plansEstimate.js";
import type { EstimateReport } from "../../src/domain/cost/estimate.js";

// `phax plans estimate` answers the domain's EstimateReport through a hand-written output
// contract that refuses an extra key. A key the domain adds to the report, to a phase or to the
// windows, and the contract lacks, would make every call a defect at run time while still
// typechecking: these checks make it a type error instead.

type Contract = Schema.Schema.Type<typeof PlansEstimateOutput>;

/** Every key of every variant of a union. */
type Keys<T> = T extends unknown ? keyof T : never;

/** The keys `Domain` has and `Declared` lacks: `never` when the contract covers the domain. */
type Missing<Domain, Declared> = Exclude<Keys<Domain>, Keys<Declared>>;

const reportKeys: [Missing<EstimateReport, Contract>] extends [never] ? true : false = true;

const phaseKeys: [Missing<EstimateReport["phases"][number], Contract["phases"][number]>] extends [
  never,
]
  ? true
  : false = true;

const windowKeys: [
  Missing<NonNullable<EstimateReport["windows"]>, NonNullable<Contract["windows"]>>,
] extends [never]
  ? true
  : false = true;

const runKeys: [Missing<NonNullable<EstimateReport["run"]>, NonNullable<Contract["run"]>>] extends [
  never,
]
  ? true
  : false = true;

void reportKeys;
void phaseKeys;
void windowKeys;
void runKeys;
