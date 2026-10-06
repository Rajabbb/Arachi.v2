import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveParams, type AgentTool } from "./registry";

const tool: AgentTool = {
  name: "t",
  description: "",
  params: {
    id: { type: "integer", description: "" },
    tags: { type: "array", description: "", default: ["a"] },
  },
  async run() {},
};

test("defaults apply and only real changes count as overrides", () => {
  assert.deepEqual(resolveParams(tool, { id: 1 }), { params: { id: 1, tags: ["a"] }, overrides: ["id"] });
  assert.deepEqual(resolveParams(tool, { id: 1, tags: ["a"] }), { params: { id: 1, tags: ["a"] }, overrides: ["id"] });
  assert.deepEqual(resolveParams(tool, { id: 1, tags: ["b"] }), { params: { id: 1, tags: ["b"] }, overrides: ["id", "tags"] });
  assert.ok("error" in resolveParams(tool, { id: 1, tags: "b" }));
  assert.ok("error" in resolveParams(tool, {}));
});
