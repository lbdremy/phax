import { archivePathFor, classifyArtifactPath } from "../artifact/document.js";

/** The run's plan as the pull request names it. */
export type PrPlanRef =
  | { readonly kind: "permalink"; readonly path: string; readonly url: string }
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "unrecorded" };

/** The plan's source spec as the pull request names it. */
export type PrSpecRef =
  | { readonly kind: "permalink"; readonly path: string; readonly url: string }
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "none" };

/** One agent assignment and how many of the run's phases it ran. */
export interface PrAgentGroup {
  readonly provider: string;
  readonly model: string;
  readonly effort: string;
  readonly phases: number;
}

/** The facts the pull request footer states. */
export interface PrFooterInput {
  readonly version: string;
  readonly plan: PrPlanRef;
  readonly spec: PrSpecRef;
  readonly agents: readonly PrAgentGroup[];
  readonly qualifiedName: string;
}

/**
 * Where a recorded artifact path lives in a commit's tree: the path itself
 * when the tree holds it, else its `archive/` counterpart when the tree holds
 * that, else null. A path outside `docs/plans/` and `docs/specs/` is never
 * mapped to an archive.
 */
export function locateAtHead(recorded: string, headPaths: ReadonlySet<string>): string | null {
  if (headPaths.has(recorded)) return recorded;
  if (classifyArtifactPath(recorded) === null) return null;
  const archived = archivePathFor(recorded);
  return headPaths.has(archived) ? archived : null;
}

/** `<webUrl>/blob/<sha>/<path>`, each path segment URI-encoded. */
export function permalink(webUrl: string, sha: string, path: string): string {
  const base = webUrl.replace(/\/+$/, "");
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${base}/blob/${sha}/${encoded}`;
}

/** Groups agent assignments in order of first appearance, counting each. */
export function groupAgents(
  phases: ReadonlyArray<{
    readonly provider: string;
    readonly model: string;
    readonly effort: string;
  }>,
): PrAgentGroup[] {
  const groups: PrAgentGroup[] = [];
  for (const { provider, model, effort } of phases) {
    const index = groups.findIndex(
      (g) => g.provider === provider && g.model === model && g.effort === effort,
    );
    if (index === -1) {
      groups.push({ provider, model, effort, phases: 1 });
    } else {
      const group = groups[index]!;
      groups[index] = { ...group, phases: group.phases + 1 };
    }
  }
  return groups;
}

/** A plan ref as Markdown: a linked code span, a code span, or `loose plan`. */
export function renderPlanRef(plan: PrPlanRef): string {
  if (plan.kind === "unrecorded") return "loose plan";
  return renderLocated(plan);
}

function renderLocated(ref: Exclude<PrPlanRef, { readonly kind: "unrecorded" }>): string {
  return ref.kind === "permalink" ? `[\`${ref.path}\`](${ref.url})` : `\`${ref.path}\``;
}

/**
 * The footer that ends every pull request phax creates: a rule, the
 * generated line, then one fact per line (plan and spec, agents, run).
 */
export function renderPrFooter(input: PrFooterInput): string {
  const planAndSpec =
    `**Plan** ${renderPlanRef(input.plan)}` +
    (input.spec.kind === "none" ? "" : ` · **Spec** ${renderLocated(input.spec)}`);
  const lines = [
    `🛤️ Generated with [phax](https://docs.phax.run) ${input.version} — the golden path, just facts`,
    planAndSpec,
    ...(input.agents.length > 0
      ? [`**Agents** ${input.agents.map(renderAgentGroup).join("; ")}`]
      : []),
    `**Run** \`${input.qualifiedName}\``,
  ];
  // A trailing backslash is a Markdown hard break, as in the summary.
  return `---\n\n${lines.join("\\\n")}`;
}

function renderAgentGroup(group: PrAgentGroup): string {
  const noun = group.phases === 1 ? "phase" : "phases";
  return `${group.provider} \`${group.model}\` at ${group.effort}: ${group.phases} ${noun}`;
}
