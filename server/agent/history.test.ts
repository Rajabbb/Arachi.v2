import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config";
import { remember, usableTurns } from "./history";
import type { ModelProvider } from "./providers/types";

type Msg = { fake: string; file?: boolean };

const provider = {
  ownsTranscript: (t: unknown[]): t is Msg[] => t.every((m) => typeof m === "object" && m !== null && "fake" in m),
  dropAttachments: (m: Msg): Msg => ({ fake: m.fake }),
} as ModelProvider<Msg>;

const turn = (n: number): Msg[] => [{ fake: `user ${n}`, file: true }, { fake: `answer ${n}` }];

test("keeps the latest turns, whole, and drops files from older ones", () => {
  let turns: Msg[][] = [];
  for (let n = 1; n <= config.historyTurns + 5; n++) turns = remember(turns, turn(n), provider);

  assert.equal(turns.length, config.historyTurns);
  assert.equal(turns[0][0].fake, "user 6"); // every kept turn starts at the user's message
  assert.deepEqual(turns.at(-1), turn(config.historyTurns + 5));
  const withFiles = turns.filter((t) => t[0].file).length;
  assert.equal(withFiles, config.attachmentTurns);
  assert.ok(turns.slice(-config.attachmentTurns).every((t) => t[0].file));
});

test("a turn that added nothing (refused, cut off) is not stored", () => {
  assert.deepEqual(remember([turn(1)], [], provider), [turn(1)]);
});

test("another provider's saved transcript starts over", () => {
  assert.deepEqual(usableTurns([[{ parts: [] }]], provider), []);
  assert.deepEqual(usableTurns([turn(1)], provider), [turn(1)]);
});
