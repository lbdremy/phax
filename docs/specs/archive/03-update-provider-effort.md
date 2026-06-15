# Update — Provider Effort / Thinking Enums

## Replace OpenAI naming

Use this OpenAI model family name everywhere:

```txt
openai-gpt
```

Do not use:

```txt
openai-chatgpt
```

Reason:

```txt
ChatGPT is the product name.
GPT is the model family naming PHAX should use.
```

The supported provider model families are now:

```txt
claude-haiku
claude-sonnet
claude-opus
mistral-medium
openai-gpt
```

---

# Provider-specific effort / thinking enums

PHAX must treat effort/thinking levels as provider-specific.

The normalized routing layer may compare them, but it must not assume all providers support the same enum.

## Mistral Vibe

Model family:

```txt
mistral-medium
```

Concrete current model:

```txt
mistral-medium-3.5
```

Supported thinking levels:

```txt
off
low
medium
high
max
```

Mistral Vibe model routing should use configured model aliases, for example:

```txt
phax-mistral-medium-3.5-off
phax-mistral-medium-3.5-low
phax-mistral-medium-3.5-medium
phax-mistral-medium-3.5-high
phax-mistral-medium-3.5-max
```

## OpenAI Codex

Model family:

```txt
openai-gpt
```

Concrete current model:

```txt
gpt-5.5
```

Supported thinking levels:

```txt
low
medium
high
xhigh
```

No `max` level should be assumed for OpenAI GPT through Codex.

## Claude Haiku

Model family:

```txt
claude-haiku
```

Supported effort levels:

```txt
none
```

Product rule:

```txt
Haiku has no PHAX effort level.
```

Haiku should be treated as a lightweight model family.

It must not be used as an automatic resolution for `claude-sonnet / low`.

## Claude Sonnet

Model family:

```txt
claude-sonnet
```

Concrete current model generation:

```txt
sonnet 4.6
```

Supported effort levels:

```txt
low
medium
high
max
```

Product rule:

```txt
claude-sonnet / low is still Sonnet.
```

It must never resolve to Haiku inside the Claude provider family.

## Claude Opus

Model family:

```txt
claude-opus
```

Concrete current model generation:

```txt
opus 4.8
```

Supported effort levels:

```txt
low
medium
high
xhigh
max
ultracode
```

Product rule:

```txt
Opus is the frontier family.
```

Opus requests should prefer Claude Opus unless fallback or downgrade is explicitly allowed.

`ultracode` has no default equivalent in Mistral Vibe or OpenAI Codex.

---

# Corrected mapping rules

## Same-family preservation

Effort does not change model family.

Invalid:

```txt
claude-sonnet / low
  → claude-haiku
```

Valid:

```txt
claude-sonnet / low
  → claude-sonnet / low
```

Invalid:

```txt
claude-opus / low
  → claude-sonnet / max
```

Valid:

```txt
claude-opus / low
  → claude-opus / low
```

A downgrade to another Claude family is allowed only if explicitly configured.

---

# Updated simplified equivalence table

This table is approximate and user-overridable.

| Claude reference request  | Mistral Vibe equivalent      | OpenAI Codex equivalent           | Notes                                        |
| ------------------------- | ---------------------------- | --------------------------------- | -------------------------------------------- |
| `claude-haiku`            | `mistral-medium / off`       | `openai-gpt / low`                | lightweight tasks                            |
| `claude-sonnet / low`     | `mistral-medium / low`       | `openai-gpt / low`                | Sonnet low remains Sonnet if Claude selected |
| `claude-sonnet / medium`  | `mistral-medium / medium`    | `openai-gpt / low` or `medium`    | normal implementation                        |
| `claude-sonnet / high`    | `mistral-medium / high`      | `openai-gpt / medium`             | strong implementation                        |
| `claude-sonnet / max`     | `mistral-medium / max`       | `openai-gpt / high`               | very strong implementation                   |
| `claude-opus / low`       | no strict Mistral equivalent | `openai-gpt / xhigh`              | fallback candidate                           |
| `claude-opus / medium`    | no strict Mistral equivalent | `openai-gpt / xhigh`              | fallback candidate                           |
| `claude-opus / high`      | no strict Mistral equivalent | `openai-gpt / xhigh` as downgrade | prefer Claude Opus                           |
| `claude-opus / xhigh`     | no strict Mistral equivalent | `openai-gpt / xhigh` as downgrade | prefer Claude Opus                           |
| `claude-opus / max`       | no strict Mistral equivalent | `openai-gpt / xhigh` as downgrade | prefer Claude Opus                           |
| `claude-opus / ultracode` | no default equivalent        | no default equivalent             | Claude Opus only by default                  |

Important rule:

```txt
Mistral Medium max is Sonnet-high / very-strong-like.
It is not a true Opus equivalent.
```

---

# Updated planning skill requirement

The `phax-planning` skill must expose the correct model/effort choices.

It should present this sample to the planning model:

```txt
Claude Haiku
  claude-haiku

Claude Sonnet 4.6
  claude-sonnet / low
  claude-sonnet / medium
  claude-sonnet / high
  claude-sonnet / max

Claude Opus 4.8
  claude-opus / low
  claude-opus / medium
  claude-opus / high
  claude-opus / xhigh
  claude-opus / max
  claude-opus / ultracode

Mistral Vibe Medium 3.5
  mistral-medium / off
  mistral-medium / low
  mistral-medium / medium
  mistral-medium / high
  mistral-medium / max

OpenAI Codex GPT 5.5
  openai-gpt / low
  openai-gpt / medium
  openai-gpt / high
  openai-gpt / xhigh
```

The planning skill should still prefer Claude-oriented naming when producing plans, because Claude is the routing reference scale.

PHAX can later resolve the requested family to Mistral or OpenAI according to provider priority.

---

# Updated acceptance criteria

Add or replace these acceptance criteria:

1. `openai-chatgpt` is removed from the spec and replaced by `openai-gpt`.
2. PHAX recognizes the following provider model families:
   - `claude-haiku`
   - `claude-sonnet`
   - `claude-opus`
   - `mistral-medium`
   - `openai-gpt`

3. PHAX recognizes the following Mistral Vibe thinking levels:
   - `off`
   - `low`
   - `medium`
   - `high`
   - `max`

4. PHAX recognizes the following OpenAI Codex GPT thinking levels:
   - `low`
   - `medium`
   - `high`
   - `xhigh`

5. PHAX treats Claude Haiku as having no effort level.
6. PHAX recognizes Claude Sonnet 4.6 effort levels:
   - `low`
   - `medium`
   - `high`
   - `max`

7. PHAX recognizes Claude Opus 4.8 effort levels:
   - `low`
   - `medium`
   - `high`
   - `xhigh`
   - `max`
   - `ultracode`

8. `claude-sonnet / low` never resolves to `claude-haiku`.
9. `claude-opus / low` never resolves to `claude-sonnet` unless explicit downgrade is enabled.
10. `claude-opus / ultracode` has no default equivalent and should prefer Claude Opus.
11. The `phax-planning` skill exposes the updated model/effort sample.
12. The routing table remains user-overridable in global PHAX config.

### E2E validation requirement

Codex and Mistral Vibe end-to-end tests already exist or are expected to exist.

They must be run as part of this correction.

Current known problems from manual usage:

Codex exits with error code 2 from the CLI.
Mistral Vibe execution also fails.

These failures must be investigated and fixed.

This spec explicitly requires the implementation agent to run the real E2E tests for:

Claude Code
Codex CLI
Mistral Vibe

The goal is not only to make unit tests pass.

The goal is to prove that provider execution works end to end.

### E2E test expectations

The E2E tests should verify that each provider can:

start a phase
receive the generated phase prompt
run in the correct worktree
produce usable output
return a captured session id if supported
allow resume if supported
complete a minimal phase
produce logs
surface clear errors when provider invocation fails

For Codex specifically, the tests must identify why the CLI exits with code 2.

For Mistral Vibe specifically, the tests must identify whether the failure comes from:

wrong arguments
wrong programmatic mode usage
wrong workdir/trust handling
wrong agent choice
wrong model alias
resume incompatibility
output parsing

The implementation is not complete until these E2E failures are diagnosed and fixed or explicitly documented as unsupported provider capabilities
