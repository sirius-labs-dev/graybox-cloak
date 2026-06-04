import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import type { Store } from "./store/index.js";

declare module "hono" {
  interface ContextVariableMap {
    institution: import("./store/index.js").Institution;
  }
}

// Timing-safe string comparison — prevents API key enumeration via response time.
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function apiKeyAuth(store: Store) {
  return async (c: Context, next: Next) => {
    const key = c.req.header("x-api-key");
    if (!key) {
      return c.json({ error: "missing X-API-Key header" }, 401);
    }
    const inst = await store.findByApiKey(key, safeEqual);
    if (!inst) {
      return c.json({ error: "invalid api key" }, 401);
    }
    c.set("institution", inst);
    await next();
  };
}
