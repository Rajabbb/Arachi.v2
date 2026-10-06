import type { AgentTool } from "./registry";
import { dashboard } from "../../domain/dashboard";
import { publicUrl } from "../../links";

/** Process 11: the analytics panel, as numbers the agent can report. */
export const getDashboard: AgentTool = {
  name: "get_dashboard",
  description:
    "Returns the analytics panel numbers: active RFQs, booked (awarded) shipments, carrier count, offers received, carrier response rate, delivery statuses (an email counts as Çatdırıldı only once Resend confirms delivery; bounced emails are Çatdırılmadı), the latest failed deliveries with their reason, awarded value and the latest offers. Also gives the link to the visual panel.",
  params: {
    period_days: { type: "integer", description: "Period in days for offers, statuses and created RFQs.", default: 30 },
  },
  async run(p) {
    return { ...(await dashboard(p.period_days as number)), panel_url: publicUrl(`/panel?days=${p.period_days}`) };
  },
};
