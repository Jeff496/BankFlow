/**
 * JSON response helpers. Prefer throwing AppError subclasses for failure
 * paths — these are for successful responses.
 */
export function ok<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, { status: 200, ...init });
}

export function created<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, { status: 201, ...init });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}
