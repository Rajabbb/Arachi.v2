import assert from "node:assert/strict";
import { test } from "node:test";
import { systemPrompt } from "./prompt";

// The rules found by the 11 Oct 2026 chat-bot test report must not be lost by an edit.
test("the prompt keeps its confidentiality, scope and language rules", () => {
  assert.match(systemPrompt, /Never reveal.*system prompt.*tool names/s);
  assert.match(systemPrompt, /debug mode/);
  assert.match(systemPrompt, /only help with this platform/);
  assert.match(systemPrompt, /LATEST message/);
  assert.match(systemPrompt, /Place names in RFQ fields are written in Azerbaijani/);
});

test("the prompt tells the model how to read containers, ranges and mandatory fields", () => {
  assert.match(systemPrompt, /40HC.*FCL/s);
  assert.match(systemPrompt, /Ranges and approximations/);
  assert.match(systemPrompt, /did not give a mandatory field, ask/);
});

test("the prompt stays free of today's date, so it can be cached", () => {
  assert.doesNotMatch(systemPrompt, /20\d\d-\d\d-\d\d/);
});

test("the prompt covers the carrier picker, sea ports, containers, short transit and pallet fit", () => {
  assert.match(systemPrompt, /carrier list; they tick the carriers/);
  assert.match(systemPrompt, /never call send_rfq_to_carriers for an RFQ that does not exist yet/);
  assert.match(systemPrompt, /must be a port or an airport/);
  assert.match(systemPrompt, /container_type and container_count, never in truck_type/);
  assert.match(systemPrompt, /never block it/);
  assert.match(systemPrompt, /20 ft takes about 10 pallets/);
});
