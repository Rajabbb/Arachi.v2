import type Anthropic from "@anthropic-ai/sdk";
import type { Download, UploadedFile } from "../../../shared/protocol";

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
  /** Files the tool generated for the user to download. */
  downloads: Download[];
}

export interface AgentTool {
  name: string;
  description: string;
  params: Record<string, ParamSpec>;
  run(params: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

export interface ToolExecution {
  params: Record<string, unknown>;
  overrides: string[];
  ok: boolean;
  /** Text sent back to the model as the tool_result. */
  content: string;
}

export function emptyContext(files: UploadedFile[] = []): ToolContext {
  return { files, downloads: [] };
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

  /** Tool definitions for the Claude API, in registration order. */
  definitions(): Anthropic.Beta.BetaTool[] {
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

function toDefinition(tool: AgentTool): Anthropic.Beta.BetaTool {
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
    input_schema: {
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
