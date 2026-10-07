const short = ["Yan", "Fev", "Mar", "Apr", "May", "İyn", "İyl", "Avq", "Sen", "Okt", "Noy", "Dek"];
const long = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "İyun", "İyul", "Avqust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"];

/** "2026-10" → "Okt"; January also shows the year ("Yan 26") so a year change is visible on an axis. */
export function shortMonth(month: string): string {
  const [y, m] = month.split("-");
  return m === "01" ? `${short[0]} ${y.slice(2)}` : short[Number(m) - 1];
}

/** "2026-10" → "Oktyabr 2026" */
export function longMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${long[Number(m) - 1]} ${y}`;
}

/** The current month and the `n - 1` before it, newest first, in Baku time (UTC+4). */
export function recentMonths(n: number): string[] {
  const now = new Date(Date.now() + 4 * 3600_000);
  return Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7),
  );
}
