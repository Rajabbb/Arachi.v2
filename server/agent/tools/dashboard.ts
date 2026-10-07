import type { AgentTool } from "./registry";
import { dashboard } from "../../domain/dashboard";
import { publicUrl } from "../../links";

/** Process 11: the analytics panel, as numbers the agent can report. */
export const getDashboard: AgentTool = {
  name: "get_dashboard",
  description:
    "Returns the analytics panel numbers: active RFQs, booked (awarded) shipments, carrier count, offers received, carrier response rate, delivery statuses as a funnel where each stage includes the later ones (sent ⊇ delivered ⊇ viewed ⊇ offered; failed is separate; an email counts as Çatdırıldı only once Resend confirms delivery; bounced emails are Çatdırılmadı), the latest failed deliveries with their reason, awarded value, the latest offers, and the last 12 months month by month (RFQs, offers, sends, response rate, wins; Baku-time calendar months). Also gives the link to the visual panel.",
  params: {
    period_days: { type: "integer", description: "Period in days for offers, statuses and created RFQs.", default: 30 },
  },
  async run(p) {
    return { ...(await dashboard(p.period_days as number)), panel_url: publicUrl(`/panel?days=${p.period_days}`) };
  },
};
