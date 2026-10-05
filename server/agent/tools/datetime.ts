import type { AgentTool } from "./registry";

/**
 * Example tool. It is deliberately generic (not an Arachi business process)
 * and exists to show the shape every tool follows: parameters with defaults
 * that the user can override in plain language ("show it in Tokyo time").
 */
export const currentDateTime: AgentTool = {
  name: "get_current_datetime",
  description:
    "Returns the current date and time. Use it whenever the answer depends on today's date or the current time.",
  params: {
    timezone: {
      type: "string",
      description: "IANA time zone name, e.g. Europe/London.",
      default: "Asia/Baku",
    },
    locale: {
      type: "string",
      description: "BCP 47 locale used to format the result, e.g. en-GB.",
      default: "az-AZ",
    },
  },
  async run({ timezone, locale }) {
    const now = new Date();
    const formatted = new Intl.DateTimeFormat(locale as string, {
      dateStyle: "full",
      timeStyle: "long",
      timeZone: timezone as string,
    }).format(now);
    return { iso: now.toISOString(), timezone, locale, formatted };
  },
};
