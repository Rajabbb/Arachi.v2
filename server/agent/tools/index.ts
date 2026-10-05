import { ToolRegistry } from "./registry";
import { currentDateTime } from "./datetime";
import { createRfq, listRfqs } from "./rfq";

/**
 * Every tool the agent can use. To add a process, write an AgentTool
 * (see datetime.ts) and register it here; nothing else needs to change.
 */
export const tools = new ToolRegistry()
  .register(currentDateTime)
  // 1. RFQ
  .register(createRfq)
  .register(listRfqs);
