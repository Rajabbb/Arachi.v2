import type { AuthResponse, ChatError } from "../../shared/protocol";

export type User = AuthResponse["user"];

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

export async function login(email: string, password: string): Promise<User> {
  return (await request<AuthResponse>("/api/auth/login", { email, password })).user;
}

export async function register(name: string, email: string, password: string): Promise<User> {
  return (await request<AuthResponse>("/api/auth/register", { name, email, password })).user;
}

export async function forgotPassword(email: string): Promise<void> {
  await request("/api/auth/forgot", { email });
}

export async function resetPassword(token: string, password: string): Promise<User> {
  return (await request<AuthResponse>("/api/auth/reset", { token, password })).user;
}

export async function logout(): Promise<void> {
  await request("/api/auth/logout", {});
  window.location.href = "/";
}
