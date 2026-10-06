import { ToolRegistry } from "./registry";
import { currentDateTime } from "./datetime";
import { createRfq, listRfqs } from "./rfq";
import { autofillRfq } from "./autofill";
import { listOutbox, sendRfqToCarriers } from "./send";
import { getQuoteLink } from "./quoteLink";
import { listOffers, recordOffer } from "./offers";
import { compareOffers, selectWinner } from "./compare";
import { sendReminders } from "./reminders";
import { offerHistory } from "./history";
import { createCustomerQuote, exportRfqs } from "./customerQuote";
import { getDashboard } from "./dashboard";
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
  .register(recordOffer)
  // 7. Compare and pick the winner
  .register(compareOffers)
  .register(selectWinner)
  // 8. Reminders
  .register(sendReminders)
  // 9. Offer version history
  .register(offerHistory)
  // 10. Customer quote PDF and Excel/PDF export
  .register(createCustomerQuote)
  .register(exportRfqs)
  // 11. Analytics panel
  .register(getDashboard);
