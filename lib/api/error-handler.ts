import type { PostgrestError } from "@supabase/supabase-js";
import { ZodError } from "zod";
import {
  AppError,
  ConflictError,
  InternalError,
  NotFoundError,
  RLSDeniedError,
  ValidationError,
} from "./errors";
import { log } from "@/lib/logger";

export function handleError(err: unknown): Response {
  const appErr = toAppError(err);

  log()[appErr.logLevel]({
    event: "req.error",
    code: appErr.code,
    message: appErr.message,
    statusCode: appErr.statusCode,
    context: appErr.context,
    stack: appErr.logLevel === "error" ? appErr.stack : undefined,
  });

  return Response.json(
    {
      error: {
        code: appErr.code,
        message: appErr.message,
      },
    },
    { status: appErr.statusCode },
  );
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new ValidationError("Request validation failed", {
      issues: err.issues,
    });
  }

  // Supabase PostgrestError mapping
  if (isPostgrestError(err)) {
    switch (err.code) {
      case "42501": // RLS policy violation
        return new RLSDeniedError(err.message, {
          pgCode: err.code,
          hint: err.hint,
        });
      case "23505": // unique_violation
        return new ConflictError("Duplicate record", {
          pgCode: err.code,
          detail: err.details,
        });
      case "23503": // foreign_key_violation
        return new ValidationError("Foreign key constraint failed", {
          pgCode: err.code,
        });
      case "23502": // not_null_violation
        return new ValidationError("Missing required field", {
          pgCode: err.code,
        });
      case "23514": // check_violation
        return new ValidationError("Check constraint failed", {
          pgCode: err.code,
        });
      case "PGRST116": // no rows returned from single()
        return new NotFoundError("Resource not found", { pgCode: err.code });
    }
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  return new InternalError(message, {
    originalName: err instanceof Error ? err.name : typeof err,
  });
}

function isPostgrestError(err: unknown): err is PostgrestError {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    "message" in err &&
    "details" in err
  );
}
