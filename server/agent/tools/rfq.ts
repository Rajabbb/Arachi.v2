import type { AgentTool } from "./registry";
import { addDays, currencies, insertRfq, transportTypes, type Currency } from "../../domain/rfqs";
import { db } from "../../db";
import { currentUserId } from "../../auth/current";

/** Process 1: create a freight request for quotation (RFQ). */
export const createRfq: AgentTool = {
  name: "create_rfq",
  description:
    "Creates a new freight RFQ (request for quotation) and returns it with its number (RFQ #id). Use it when the user wants to get prices for moving cargo.",
  params: {
    origin: { type: "string", description: "Loading place (city, country or full address)." },
    destination: { type: "string", description: "Unloading place (city, country or full address)." },
    cargo_type: { type: "string", description: "What the cargo is, e.g. textile, furniture, food." },
    weight_kg: { type: "number", description: "Gross weight in kilograms (convert tonnes to kg)." },
    volume_m3: { type: "number", description: "Volume in cubic metres; 0 means not specified.", default: 0 },
    pallets: { type: "integer", description: "Number of pallets; 0 means not specified.", default: 0 },
    transport_type: {
      type: "string",
      description: "Transport mode: Quru (road), Dəniz (sea), Hava (air), Dəmiryolu (rail).",
      enum: transportTypes,
      default: "Quru",
    },
    loading_date: {
      type: "string",
      description: "Loading date, YYYY-MM-DD; empty means flexible.",
      default: "",
    },
    delivery_date: {
      type: "string",
      description: "Required delivery date, YYYY-MM-DD; empty means flexible.",
      default: "",
    },
    currency: { type: "string", description: "Currency carriers should quote in.", enum: currencies, default: "USD" },
    offer_deadline_days: {
      type: "integer",
      description: "How many days carriers have to send an offer.",
      default: 3,
    },
    notes: { type: "string", description: "Extra requirements for carriers.", default: "" },
  },
  async run(p) {
    return insertRfq({
      origin: p.origin as string,
      destination: p.destination as string,
      cargo_type: p.cargo_type as string,
      weight_kg: p.weight_kg as number,
      volume_m3: p.volume_m3 as number,
      pallets: p.pallets as number,
      transport_type: p.transport_type as string,
      loading_date: p.loading_date as string,
      delivery_date: p.delivery_date as string,
      currency: p.currency as Currency,
      offer_deadline: addDays(p.offer_deadline_days as number),
      notes: p.notes as string,
      source: "chat",
    });
  },
};

export const listRfqs: AgentTool = {
  name: "list_rfqs",
  description: "Lists the user's RFQs, newest first. Use it to find an RFQ number or check what exists.",
  params: {
    status: {
      type: "string",
      description: "Filter by status: open, awarded (winner chosen), closed, or all.",
      enum: ["all", "open", "awarded", "closed"],
      default: "all",
    },
    limit: { type: "integer", description: "Maximum number of RFQs to return.", default: 20 },
  },
  async run({ status, limit }) {
    const where = status === "all" ? "" : "AND status = ?";
    const args = status === "all" ? [limit as number] : [status as string, limit as number];
    return db().all(`SELECT * FROM rfqs WHERE user_id = ? ${where} ORDER BY id DESC LIMIT ?`, currentUserId(), ...args);
  },
};
