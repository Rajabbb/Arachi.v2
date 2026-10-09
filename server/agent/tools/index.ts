import { ToolRegistry } from "./registry";
import { currentDateTime } from "./datetime";
import { cancelWinner, offerHistory } from "./arachiTools";
import { importCarriers, listCategories, removeCarriers, setCarrierCategory } from "./carrierTools";
import { createCustomerQuote, exportRfqs } from "./documentTools";
import {
  addCarriers,
  compareOffers,
  createRfq,
  getDashboard,
  getQuoteLink,
  listCarriers,
  listOffers,
  listRfqs,
  selectWinner,
  sendReminders,
  sendRfqToCarriers,
} from "./arachiTools";

/**
 * Every tool the agent can use. They all work on the user's data on arachi.co
 * (see arachiTools.ts). To add a process, write an AgentTool and register it here.
 */
export const tools = new ToolRegistry()
  .register(currentDateTime)
  // RFQs
  .register(createRfq)
  .register(listRfqs)
  // Carrier base
  .register(listCarriers)
  .register(addCarriers)
  .register(importCarriers)
  .register(listCategories)
  .register(setCarrierCategory)
  .register(removeCarriers)
  // Sending (needs the user's "Bəli")
  .register(sendRfqToCarriers)
  .register(getQuoteLink)
  // Offers
  .register(listOffers)
  .register(compareOffers)
  .register(selectWinner)
  .register(cancelWinner)
  .register(offerHistory)
  .register(sendReminders)
  // Customer quote and reports (files for the user)
  .register(createCustomerQuote)
  .register(exportRfqs)
  // Numbers
  .register(getDashboard);
