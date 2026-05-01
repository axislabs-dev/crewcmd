import { NextResponse } from "next/server";

export type ApiErrorBody = {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
};

type ApiErrorOptions = {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
};

export function apiError({
  status,
  code,
  message,
  details,
  requestId,
}: ApiErrorOptions) {
  const body: ApiErrorBody = { code, message };

  if (details !== undefined) body.details = details;
  if (requestId) body.requestId = requestId;

  return NextResponse.json(body, { status });
}
