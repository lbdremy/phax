// The golden path on the home page: spec and plan, the phases with a gate cut
// into the rail between each, then compliance, review and the pull request.
// Drawn once at build time from the constants below; colours come from the
// theme variables (site/theme/home.css), so both themes follow the tokens.

interface Step {
  readonly label: string;
  readonly kind: "artifact" | "phase" | "check";
  /** The label of the rail leading into this step; a gate is drawn as a cut. */
  readonly edge?: string;
}

const STEPS: ReadonlyArray<Step> = [
  { label: "spec", kind: "artifact" },
  { label: "plan", kind: "artifact", edge: "approve" },
  { label: "phase-01", kind: "phase", edge: "lint · approve" },
  { label: "phase-02", kind: "phase", edge: "gate" },
  { label: "phase-NN", kind: "phase", edge: "gate" },
  { label: "compliance", kind: "check", edge: "gate" },
  { label: "review", kind: "artifact", edge: "verdict" },
  { label: "pull request", kind: "artifact", edge: "publish" },
];

const WIDTH = 1120;
const HEIGHT = 140;
const BOX_Y = 44;
const BOX_HEIGHT = 40;
const RAIL_Y = BOX_Y + BOX_HEIGHT / 2;
/** Half the clear gap a gate cuts into the rail. */
const CUT = 7;

const widths = STEPS.map((step) => Math.max(92, step.label.length * 8.6 + 30));
const gap = (WIDTH - widths.reduce((sum, width) => sum + width, 0)) / (STEPS.length - 1);
const lefts = widths.map(
  (_, index) => widths.slice(0, index).reduce((sum, width) => sum + width, 0) + index * gap,
);
const phases = STEPS.flatMap((step, index) => (step.kind === "phase" ? [index] : []));
const recordsFrom = lefts[phases[0] ?? 0] ?? 0;
const recordsTo = (lefts[phases.at(-1) ?? 0] ?? 0) + (widths[phases.at(-1) ?? 0] ?? 0);

function Rail({ index, edge }: { readonly index: number; readonly edge: string }) {
  const from = (lefts[index - 1] ?? 0) + (widths[index - 1] ?? 0);
  const to = lefts[index] ?? 0;
  const middle = (from + to) / 2;
  if (edge !== "gate") {
    return (
      <g>
        <line className="phax-path__rail" x1={from} y1={RAIL_Y} x2={to} y2={RAIL_Y} />
        <text className="phax-path__edge" x={middle} y={BOX_Y - 10} textAnchor="middle">
          {edge}
        </text>
      </g>
    );
  }
  return (
    <g>
      <line className="phax-path__rail" x1={from} y1={RAIL_Y} x2={middle - CUT} y2={RAIL_Y} />
      <line className="phax-path__rail" x1={middle + CUT} y1={RAIL_Y} x2={to} y2={RAIL_Y} />
      <text className="phax-path__gate" x={middle} y={BOX_Y - 10} textAnchor="middle">
        gate
      </text>
    </g>
  );
}

export function GoldenPath() {
  return (
    <section className="phax-path" aria-label="The golden path">
      <div className="phax-path__scroll">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="spec, plan, phases separated by gates, compliance, review, pull request"
        >
          {STEPS.map((step, index) =>
            step.edge === undefined ? null : (
              <Rail key={`rail-${step.label}`} index={index} edge={step.edge} />
            ),
          )}
          {STEPS.map((step, index) => (
            <g key={step.label} className={`phax-path__step phax-path__step--${step.kind}`}>
              <rect x={lefts[index]} y={BOX_Y} width={widths[index]} height={BOX_HEIGHT} rx={6} />
              <text
                x={(lefts[index] ?? 0) + (widths[index] ?? 0) / 2}
                y={BOX_Y + 25}
                textAnchor="middle"
              >
                {step.label}
              </text>
            </g>
          ))}
          <line
            className="phax-path__records"
            x1={recordsFrom}
            y1={BOX_Y + BOX_HEIGHT + 30}
            x2={recordsTo}
            y2={BOX_Y + BOX_HEIGHT + 30}
          />
          <text className="phax-path__edge" x={recordsFrom} y={BOX_Y + BOX_HEIGHT + 50}>
            one record per phase → phax/records/v1
          </text>
        </svg>
      </div>
    </section>
  );
}
