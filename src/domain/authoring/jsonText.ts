// A model sometimes wraps JSON output in a ```json fence despite the prompt
// forbidding it. Strip a single leading/trailing fence so JSON.parse succeeds.
// Shared by plan extraction and headless authoring, whose sessions both return
// a JSON object as their final message.
export function stripJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i;
  const match = trimmed.match(fence);
  return match?.[1]?.trim() ?? trimmed;
}
