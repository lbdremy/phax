# Structured answers and providers

Some of phax's jobs end with an answer in a fixed shape: a headless spec or plan, a decide verdict, a plan extraction, a first reading, a closing handoff, a code review. Each of these is a JSON document with its own published schema. This page is for choosing which provider runs those roles: what each provider checks of an answer, and what phax checks after it.

## One schema, handed three ways

Every answer has one strict schema (closed objects, every key required), published by `@lbdremy/phax-schemas` and stated in full in the prompt. How the provider receives it depends on the provider and, on Claude Code, on the call.

| Call               | Claude Code     | Codex            | Mistral Vibe     |
| ------------------ | --------------- | ---------------- | ---------------- |
| `authoring`        | `--json-schema` | `--output-schema` | schema in prompt |
| `plan-extraction`  | `--json-schema` | `--output-schema` | schema in prompt |
| `decide-handback`  | `--json-schema` | `--output-schema` | schema in prompt |
| `decide-verdicts`  | `--json-schema` | `--output-schema` | schema in prompt |
| `first-turn`       | `--json-schema` | `--output-schema` | schema in prompt |
| `closing-turn`     | `--json-schema` | `--output-schema` | schema in prompt |
| `code-review`      | `--json-schema` | `--output-schema` | schema in prompt |

- **Claude Code** gets the schema inline on `--json-schema`, without its root `$schema` property: the API refuses a property key outside `^[a-zA-Z0-9_.-]{1,64}$`. phax sets the answer's `$schema` itself and tells the model to leave it out. A call whose cell reads `prompt` instead keeps the schema in the prompt alone: it is the fallback for a Claude Code combination (a `--resume`, the read-only tools, stream-json) that the real-CLI smoke test showed failing.
- **Codex** gets the whole schema in a temporary `answer.schema.json` on `--output-schema`, on `exec` and on `exec resume`, and the file is removed when the process ends.
- **Mistral Vibe** has no such option: it reads the schema in the prompt, like Claude Code on a `prompt` call.

The compliance review joins this table with the next release.

## phax's decoder is the only judge

A provider's check is a convenience, not the verdict. Whatever the provider enforced, phax reads the answer's JSON and decodes it with the format's schema plus the call's coherence checks, and only then accepts it. The providers differ in what they enforce (Codex's strict mode has no `minLength`, so phax's non-empty strings use a pattern; Claude Code enforces `minItems` and `exclusiveMinimum` client-side), so the same answer can pass on one and need a second look on another. The decoder makes the outcome identical on all three.

Some rules cannot be written in a schema every provider accepts. phax keeps them as coherence checks of the call:

- an authoring session returns open questions only, so a non-empty `arbitratedQuestions` is refused at its first entry;
- a plan document's `sourceSpec` and `completesSpec` must pair up;
- a test line's oracle must not contain ` — ` inside, start with `— ` or end with ` ·`.

## The one corrective resume

When the decoder refuses an answer, phax resumes the same session once with the refusal and asks again. For example, a headless plan authoring answers with a document whose `arbitratedQuestions` holds an entry. The schema lets that through; the authoring check refuses it, naming the first entry. The resume shows the model the refusal, it answers again with an empty list, and the second answer is the one phax writes. A second refusal fails the call and keeps the transcript.

The plan-extraction fallback (the extraction model reading `plan.md`) has no resume: its refusal is final.

## When Claude Code cannot meet the schema

Claude Code enforces `--json-schema` itself: the model answers through a tool whose validation refuses a value that breaks the schema, and the model retries. On 2026-10-30 a session whose model could not meet the schema ended `success` with a prose result and no `structured_output`. phax reads that prose as the answer text, refuses it as not JSON, and takes the one corrective resume.

When Claude Code gives up on its own retries, the result subtype is `error_max_structured_output_retries`. phax reports that as a `provider-error` and never resumes it.
