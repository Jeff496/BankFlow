import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { runWithContext } from "@/lib/logger/context";
import { log } from "@/lib/logger";
import { handleError } from "./error-handler";

// Route handlers in Next 15 receive params as a Promise. Routes without
// dynamic segments still receive an empty params Promise. See:
// https://nextjs.org/docs/app/api-reference/file-conventions/route
type RouteHandlerCtx<P = Record<string, string | string[]>> = {
  params: Promise<P>;
};
type Handler<P = Record<string, string | string[]>> = (
  req: NextRequest,
  ctx: RouteHandlerCtx<P>,
) => Promise<Response>;

export function withLogging<P = Record<string, string | string[]>>(
  handler: Handler<P>,
  routeName: string,
): Handler<P> {
  return async (req, routeCtx) => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    const start = performance.now();

    const context = {
      requestId,
      route: routeName,
      method: req.method,
    };

    return runWithContext(context, async () => {
      log().info({ event: "req.start" });

      let response: Response;
      try {
        response = await handler(req, routeCtx);
      } catch (err) {
        response = handleError(err);
      }

      const durationMs = Math.round(performance.now() - start);
      log().info({
        event: "req.end",
        status: response.status,
        durationMs,
      });

      // Echo request ID for support correlation
      response.headers.set("x-request-id", requestId);
      return response;
    });
  };
}
