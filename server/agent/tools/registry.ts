import type { Confirmation, Download, UploadedFile } from "../../../shared/protocol";
import type { ToolDefinition } from "../providers/types";

/**
 * One parameter of an agent tool. A parameter with a `default` is optional:
 * the model only sets it when the user explicitly asked for a different value,
 * otherwise the default is used. A parameter without a default is required.
 */
export interface ParamSpec {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description: string;
  enum?: readonly (string | number)[];
  /** JSON schema of one element, for `array` parameters. */
  items?: Record<string, unknown>;
  /** JSON schema properties, for `object` parameters. */
  properties?: Record<string, unknown>;
  default?: unknown;
}

/** What a tool can see and produce besides its parameters. */
export interface ToolContext {
  /** Files the user attached to the current message. */
  files: UploadedFile[];
  /** The text of the user's current message. */
  text: string;
  /** Files the tool generated for the user to download. */
  downloads: Download[];
  /**
   * Set during a chat turn: stores an action for the user to confirm with
   * "Bəli" / "Xeyr". Tools with `confirm` then prepare instead of running.
   */
  askUser?: (tool: string, params: Record<string, unknown>, summary: string) => Promise<Confirmation>;
  /** Actions prepared in this turn, shown under the reply. */
  confirmations: Confirmation[];
}

/** What the user will be asked to confirm, and the exact parameters that will then run. */
export interface ConfirmPlan {
  summary: string;
  params: Record<string, unknown>;
}

export interface AgentTool {
  name: string;
  description: string;
  params: Record<string, ParamSpec>;
  run(params: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
  /**
   * For tools that send messages: what this call would do, for the user to
   * confirm; null when it would send nothing (it then just runs).
   */
  confirm?(params: Record<string, unknown>): Promise<ConfirmPlan | null>;
  /** One line for the chat after the user confirmed and the tool ran. */
  done?(result: unknown): string;
}

export interface ToolExecution {
  params: Record<string, unknown>;
  overrides: string[];
  ok: boolean;
  /** Text sent back to the model as the tool_result. */
  content: string;
}

export function emptyContext(files: UploadedFile[] = [], text = ""): ToolContext {
  return { files, text, downloads: [], confirmations: [] };
}

export class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  /** Provider-neutral tool definitions, in registration order. */
  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map(toDefinition);
  }

  async execute(
    name: string,
    input: unknown,
    ctx: ToolContext = emptyContext(),
  ): Promise<ToolExecution> {
    const tool = this.tools.get(name);
    if (!tool) {
      return failure({}, [], `Unknown tool: ${name}`);
    }

    const resolved = resolveParams(tool, input);
    if ("error" in resolved) {
      return failure({}, [], resolved.error);
    }

    try {
      if (tool.confirm && ctx.askUser) {
        const plan = await tool.confirm(resolved.params);
        if (plan) {
          // The same action asked twice in a turn gets one card, not two.
          const same = ctx.confirmations.find((c) => c.text === plan.summary);
          const confirmation = same ?? (await ctx.askUser(name, plan.params, plan.summary));
          if (!same) ctx.confirmations.push(confirmation);
          return {
            ...resolved,
            ok: true,
            content: JSON.stringify({
              status: "waiting_for_user",
              will_do: plan.summary,
              note:
                "Nothing has been sent yet. Under your reply the user sees exactly this with \"Bəli\" (yes) and \"Xeyr\" (no) buttons; " +
                "it runs only when they press Bəli. Say in one short sentence what will happen and ask them to press Bəli. " +
                "Don't call this tool again for the same action, even if they answer yes in text.",
            }),
          };
        }
      }
      const result = await tool.run(resolved.params, ctx);
      return {
        ...resolved,
        ok: true,
        content: typeof result === "string" ? result : JSON.stringify(result),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return failure(resolved.params, resolved.overrides, message);
    }
  }
}

function failure(
  params: Record<string, unknown>,
  overrides: string[],
  message: string,
): ToolExecution {
  return { params, overrides, ok: false, content: `Error: ${message}` };
}

function toDefinition(tool: AgentTool): ToolDefinition {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, spec] of Object.entries(tool.params)) {
    const description =
      spec.default === undefined
        ? spec.description
        : `${spec.description} Default: ${JSON.stringify(spec.default)}. ` +
          "Omit unless the user explicitly asked for a different value.";
    properties[key] = {
      type: spec.type,
      description,
      ...(spec.enum ? { enum: spec.enum } : {}),
      ...(spec.items ? { items: spec.items } : {}),
      ...(spec.properties ? { properties: spec.properties } : {}),
    };
    if (spec.default === undefined) required.push(key);
  }

  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  };
}

/**
 * Standard parameters first, user overrides on top: start from every
 * parameter's default and replace only what the model explicitly set.
 */
export function resolveParams(
  tool: AgentTool,
  input: unknown,
):
  | { params: Record<string, unknown>; overrides: string[] }
  | { error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { error: "Tool input must be an object" };
  }
  const given = input as Record<string, unknown>;

  const unknownKeys = Object.keys(given).filter((k) => !(k in tool.params));
  if (unknownKeys.length > 0) {
    return { error: `Unknown parameter(s): ${unknownKeys.join(", ")}` };
  }

  const params: Record<string, unknown> = {};
  const overrides: string[] = [];

  for (const [key, spec] of Object.entries(tool.params)) {
    const value = given[key];
    if (value === undefined || value === null) {
      if (spec.default === undefined) {
        return { error: `Missing required parameter: ${key}` };
      }
      params[key] = spec.default;
      continue;
    }
    const problem = checkValue(spec, value);
    if (problem) return { error: `Parameter "${key}": ${problem}` };
    params[key] = value;
    if (JSON.stringify(value) !== JSON.stringify(spec.default)) {
      overrides.push(key);
    }
  }

  return { params, overrides };
}

function checkValue(spec: ParamSpec, value: unknown): string | null {
  switch (spec.type) {
    case "string":
      if (typeof value !== "string") return "expected a string";
      break;
    case "boolean":
      if (typeof value !== "boolean") return "expected a boolean";
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return "expected a number";
      }
      break;
    case "integer":
      if (!Number.isInteger(value)) return "expected an integer";
      break;
    case "array":
      if (!Array.isArray(value)) return "expected an array";
      break;
    case "object":
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return "expected an object";
      }
      break;
  }
  if (spec.enum && !spec.enum.includes(value as string | number)) {
    return `expected one of ${spec.enum.join(", ")}`;
  }
  return null;
}
