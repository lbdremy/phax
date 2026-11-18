// `phax finding list`: the stub the acceptance tests of tests/integration/findingList.test.ts
// load against. Phase-06 replaces it with the command. Not part of `phaxProgram` yet.
import { Effect } from "effect";
import { defineCommand, defineGroup } from "../commandLibrary/contract/index.js";

const listCommand = defineCommand({
  name: "list",
  summary: "List a run's findings with their ids and fates",
  input: {},
  run: () => Effect.die("not implemented: phax finding list (phase-06)"),
  exits: {},
});

export const findingGroup = defineGroup({
  name: "finding",
  summary: "Read the findings of a run's reviews and their fates",
  commands: [listCommand],
});
