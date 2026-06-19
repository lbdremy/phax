export const REQUIRED_HANDOFF_SECTIONS = [
  "## What was delivered",
  "## Key decisions and why",
  "## Exact locations (file paths and exported names)",
  "## What the next phase needs to know",
] as const;

// Injected into every phase prompt so the agent needs no external file.
// Total length: 150–400 words in the generated handoff. Keep guidance tight.
export const HANDOFF_GUIDANCE_LINES: readonly string[] = [
  "### What was delivered",
  "One sentence per significant artifact: what exists now that did not before.",
  "Name files and exported symbols. Do not summarise the phase objective — the reader already has `plan.md`.",
  "",
  "### Key decisions and why",
  "List only decisions a future reader would find surprising or that constrain the next phase.",
  "Include the reason. Omit decisions the code makes obvious.",
  "",
  "### Exact locations (file paths and exported names)",
  "A flat list of every file and symbol the next phase imports, e.g.:",
  "  src/ports/fs.ts  — FileSystem port (ReadFileSystem, WriteFileSystem)",
  "",
  "### What the next phase needs to know",
  "Facts not derivable from reading the code: invariants, known gaps, ordering constraints,",
  "deliberate non-implementations, and workarounds that look odd but are intentional.",
  "If the file-plan deviation report above lists any deviations, justify each one here.",
  "",
  "Tone: short sentences, bullet lists, 150–400 words total.",
  "No transcript summaries — write decisions and facts only.",
  "Never say 'I implemented X' — state what exists.",
];

export function buildHandoffGuidanceBlock(): string {
  return [
    "The file must include these four sections in order:",
    ...REQUIRED_HANDOFF_SECTIONS.map((s) => `- \`${s}\``),
    "",
    "Guidance for each section:",
    ...HANDOFF_GUIDANCE_LINES,
  ].join("\n");
}
