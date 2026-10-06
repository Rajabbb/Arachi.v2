import type { ChatError } from "../../shared/protocol";

/** GETs JSON from the server; an expired session reloads to the login screen. */
export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (res.status === 401) window.location.reload();
  const body = (await res.json().catch(() => null)) as T | ChatError | null;
  if (!res.ok || !body || (typeof body === "object" && "error" in body)) {
    throw new Error(body && typeof body === "object" && "error" in body ? body.error : "Serverlə əlaqə qurulmadı.");
  }
  return body as T;
}

export function money(amount: number, currency: string): string {
  return `${amount.toLocaleString("az-AZ", { maximumFractionDigits: 2 })} ${currency}`;
}
