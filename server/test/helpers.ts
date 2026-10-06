import type { UploadedFile } from "../../shared/protocol";
import { openDatabase } from "../db";
import { emptyContext, type ToolContext } from "../agent/tools/registry";
import { tools } from "../agent/tools";

/** Fresh in-memory database for one test. */
export function freshDb() {
  return openDatabase(":memory:");
}

/** Runs a registered tool the way the agent loop does and parses its JSON result. */
export async function call(
  name: string,
  input: Record<string, unknown> = {},
  ctx: ToolContext = emptyContext(),
) {
  const run = await tools.execute(name, input, ctx);
  if (!run.ok) throw new Error(run.content);
  return { ...run, result: JSON.parse(run.content) };
}

export function textFile(name: string, text: string, type = "text/plain"): UploadedFile {
  return { name, type, data: Buffer.from(text).toString("base64") };
}
