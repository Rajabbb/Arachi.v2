import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { asTestUser, freshDb } from "../test/helpers";
import { AgentError, runTurn as runTurnUnscoped } from "./loop";

// The agent always runs for a signed-in user.
const runTurn = ((...args: Parameters<typeof runTurnUnscoped>) =>
  asTestUser(() => runTurnUnscoped(...args))) as typeof runTurnUnscoped;
import type { ModelProvider, ModelStep, ToolCallResult } from "./providers/types";

beforeEach(freshDb);

type Msg = { fake: string; results?: ToolCallResult[] };

/** A provider that replays scripted steps, to test the loop without any API. */
function fakeProvider(steps: ModelStep<Msg>[]): ModelProvider<Msg> & { seen: Msg[][] } {
  const seen: Msg[][] = [];
  return {
    name: "anthropic",
    model: "fake",
    seen,
    ownsTranscript: (t): t is Msg[] => t.every((m) => typeof m === "object" && m !== null && "fake" in m),
    userMessage: (text, attachments) => ({ fake: `user:${text}:${attachments.length}` }),
    dropAttachments: (m) => ({ fake: m.fake.replace(/:\d+$/, ":0") }),
    async generate(_system, messages) {
      seen.push([...messages]);
      return steps.shift() ?? { kind: "stopped", reason: "other" };
    },
    toolResults: (results) => ({ fake: "results", results }),
    describeError: () => null,
  };
}

test("runs parallel tool calls, then answers", async () => {
  const provider = fakeProvider([
    {
      kind: "tool_calls",
      message: { fake: "calls" },
      calls: [
        { id: "1", name: "create_rfq", input: { origin: "Bakı", destination: "Milan", cargo_type: "Xalça", weight_kg: 500, currency: "EUR" } },
        { id: "2", name: "list_rfqs", input: {} },
      ],
    },
    { kind: "continue", message: { fake: "paused" } },
    { kind: "answer", message: { fake: "answer" }, text: "  Hazırdır: RFQ #1  " },
  ]);

  const res = await runTurn([], "RFQ yarat", [], provider);

  assert.equal(res.reply, "Hazırdır: RFQ #1");
  assert.deepEqual(res.transcript.map((m) => (m as Msg).fake), ["user:RFQ yarat:0", "calls", "results", "paused", "answer"]);
  const create = res.toolCalls.find((c) => c.name === "create_rfq")!;
  assert.deepEqual(create.overrides, ["origin", "destination", "cargo_type", "weight_kg", "currency"]);
  const results = (res.transcript[2] as Msg).results!;
  assert.deepEqual(results.map((r) => [r.call.id, r.ok]), [["1", true], ["2", true]]);
});

test("stops after too many steps without changing the transcript", async () => {
  const loop: ModelStep<Msg> = { kind: "continue", message: { fake: "again" } };
  const provider = fakeProvider(Array.from({ length: 20 }, () => loop));
  const earlier: Msg[] = [{ fake: "old" }];
  const res = await runTurn(earlier, "x", [], provider);
  assert.match(res.reply, /çox addım/);
  assert.deepEqual(res.transcript, earlier);
});

test("rejects an empty message", async () => {
  await assert.rejects(runTurn([], "  ", [], fakeProvider([])), AgentError);
});
