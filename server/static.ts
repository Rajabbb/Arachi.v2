import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { config } from "./config";

/**
 * What the page may load: only its own scripts, styles and API, so injected
 * markup cannot pull in or send data to another site. Styles allow inline
 * attributes (React's style prop); images allow data:/blob: previews.
 */
const pagePolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

async function fileAt(path: string): Promise<{ path: string; size: number } | null> {
  try {
    const s = await stat(path);
    return s.isFile() ? { path, size: s.size } : null;
  } catch {
    return null;
  }
}

/**
 * Serves the built UI (npm run build → dist/) from the same server as the API,
 * so production is one web service. A path that is not a file gets index.html
 * (the UI routes /quote/:token, /reset/:token, /panel itself). Returns false
 * when there is no build (development uses the Vite dev server instead).
 */
export async function serveStatic(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const root = resolve(config.staticDir);
  const index = await fileAt(join(root, "index.html"));
  if (!index) return false;

  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    decoded = "/";
  }
  const wanted = resolve(root, `.${decoded}`);
  const inside = wanted === root || wanted.startsWith(root + sep);
  const file = (inside && (await fileAt(wanted))) || index;
  const isIndex = file === index;
  // A missing asset (e.g. an old /assets/*.js after a deploy) is a real 404, not the page.
  // Other paths may contain dots (quote tokens), so they still get the page.
  if (isIndex && decoded.startsWith("/assets/")) return false;

  res.writeHead(200, {
    "content-type": types[extname(file.path).toLowerCase()] ?? "application/octet-stream",
    "content-length": file.size,
    // Vite puts a content hash in asset names, so they never change; the page itself must be re-checked.
    "cache-control": isIndex ? "no-cache" : decoded.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600",
    "x-content-type-options": "nosniff",
    ...(isIndex ? { "content-security-policy": pagePolicy } : {}),
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  await new Promise<void>((done, fail) => {
    createReadStream(file.path).on("error", fail).on("end", done).pipe(res);
  });
  return true;
}
