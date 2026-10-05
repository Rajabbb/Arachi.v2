import { ToolRegistry } from "./registry";
import { currentDateTime } from "./datetime";
import { createRfq, listRfqs } from "./rfq";
import { autofillRfq } from "./autofill";
import { listOutbox, sendRfqToCarriers } from "./send";
import { getQuoteLink } from "./quoteLink";
import { listOffers, recordOffer } from "./offers";
import { addCarriers, importCarriers, listCarriers, removeCarriers } from "./carriers";

/**
 * Every tool the agent can use. To add a process, write an AgentTool
 * (see datetime.ts) and register it here; nothing else needs to change.
 */
export const tools = new ToolRegistry()
  .register(currentDateTime)
  // 1. RFQ
  .register(createRfq)
  .register(listRfqs)
  // 2. AI auto-fill from documents
  .register(autofillRfq)
  // 3. Send to carriers
  .register(sendRfqToCarriers)
  .register(listOutbox)
  // 4. Carrier base
  .register(addCarriers)
  .register(importCarriers)
  .register(listCarriers)
  .register(removeCarriers)
  // 5. Carrier quote page
  .register(getQuoteLink)
  // 6. Incoming offers and statuses
  .register(listOffers)
  .register(recordOffer);
