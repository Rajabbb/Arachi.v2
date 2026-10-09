import type { AuthResponse, ChatError } from "../../shared/protocol";

export type User = AuthResponse["user"];

/** arachi.co-nun ünvanı (giriş və "geri qayıt" linkləri). Başqa ünvan üçün quraşdırma zamanı VITE_ARACHI_SITE_URL verin. */
export const arachiSiteUrl: string = (import.meta.env.VITE_ARACHI_SITE_URL || "https://arachi.co").replace(/\/+$/, "");

async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as T | ChatError | null;
  if (!res.ok || !data || (typeof data === "object" && "error" in data)) {
    const error = new Error(data && typeof data === "object" && "error" in data ? data.error : "Serverlə əlaqə qurulmadı.");
    (error as Error & { status?: number }).status = res.status;
    throw error;
  }
  return data as T;
}

/** The signed-in user, or null when nobody is signed in. */
export async function currentUser(): Promise<User | null> {
  try {
    return (await request<AuthResponse>("/api/auth/me")).user;
  } catch (err) {
    if ((err as { status?: number }).status === 401) return null;
    throw err;
  }
}

/** Ends the session here and returns to the customer panel on arachi.co. */
export async function logout(): Promise<void> {
  await request("/api/auth/logout", {});
  // Inside arachi.co's panel (iframe) the whole page goes back, not just the frame.
  (window.top ?? window).location.href = `${arachiSiteUrl}/customer`;
}
