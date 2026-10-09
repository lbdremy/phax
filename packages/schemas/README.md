# @lbdremy/phax-schemas

The schemas of the files [phax](https://github.com/lbdremy/phax) writes — its run registry, run and phase status, `phax-plan.json`, compliance reviews, approval record files and the old approvals ledgers, spec and plan documents, and the records on the `phax/records/v1` branch — with a typed parse function for each. Read phax's files from a dashboard, a cockpit or a docs pipeline with phax's own types and verdicts, without phax installed.

```bash
npm install @lbdremy/phax-schemas
```

```js
import { readFileSync } from "node:fs";
import { parseDocument, parseRegistry } from "@lbdremy/phax-schemas";

const raw = JSON.parse(readFileSync(`${process.env.HOME}/.phax/registry.json`, "utf8"));

const parsed = parseRegistry(raw);
if (parsed.ok) console.log(parsed.shape, parsed.value.runs.length);
else console.error(parsed.error.path, parsed.error.message);

// A file written by phax 0.17.0 or later names its format and shape in `$schema`,
// so parseDocument identifies it from its content alone.
const any = parseDocument(raw); // { ok, format, shape, value } or { ok: false, error }
```

- A parse failure is a value, never an exception.
- Every file written from phax 0.17.0 on stays readable; an older shape is upgraded in memory by the format's `toLatest*` function, marking a fact it did not carry as `{ kind: "unknown" }`. A file written before 0.17.0 is read if its format's pre-0.17.0 shape accepts it, and reported unsupported otherwise. A file stamped with a release newer than the package asks you to upgrade the package.
- One draft-07 JSON Schema per format ships in `json/<format>.schema.json`.
- The package is published at the same version as the phax release that produced it, and depends only on `effect`.

The full list of formats, their files and parse functions, and how to read a record from the `phax/records/v1` branch, are in phax's README: [Read phax files from code](https://github.com/lbdremy/phax#read-phax-files-from-code).
