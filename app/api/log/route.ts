import { z } from "zod";
import { withLogging } from "@/lib/api/with-logging";
import { log } from "@/lib/logger";
import { RateLimitError, ValidationError } from "@/lib/api/errors";
import type { NextRequest } from "next/server";

const clientLogSchema = z.object({
  level: z.enum(["warn", "error"]),
  message: z.string().max(500),
  stack: z.string().max(4000).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  url: z.string().url().max(500).optional(),
});

// Simple in-memory rate limiter (move to Upstash post-MVP)
const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_MINUTE = 20;

function rateLimit(key: string) {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_MINUTE) {
    throw new RateLimitError("Too many log events");
  }
  arr.push(now);
  hits.set(key, arr);
}

async function handler(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  rateLimit(ip);

  const body = await req.json();
  const parsed = clientLogSchema.safeParse(body);
  if (!parsed.success) throw new ValidationError("Invalid log payload");

  log()[parsed.data.level]({
    event: "client.error",
    source: "client",
    message: parsed.data.message,
    stack: parsed.data.stack,
    url: parsed.data.url,
    context: parsed.data.context,
  });

  return Response.json({ ok: true });
}

export const POST = withLogging(handler, "POST /api/log");
