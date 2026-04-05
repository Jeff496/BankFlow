import pino from "pino";
import { getContext } from "./context";
import { redactPaths } from "./redact";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  base: {
    service: "bankflow-api",
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "HH:MM:ss.l" },
    },
  }),
});

/**
 * Returns a child logger bound to the current request context.
 * Use this inside route handlers. Falls back to root logger outside a request.
 */
export function log() {
  const ctx = getContext();
  return ctx ? logger.child(ctx) : logger;
}
