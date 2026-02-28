import { NextResponse } from "next/server";

export function errorResponse(
  status: number,
  error: string,
  message: string,
  correlationId: string
) {
  return NextResponse.json(
    {
      error,
      message,
      correlation_id: correlationId,
    },
    {
      status,
      headers: {
        "X-Correlation-Id": correlationId,
      },
    }
  );
}

export function successResponse<T extends Record<string, unknown>>(
  status: number,
  payload: T,
  correlationId: string
) {
  return NextResponse.json(
    {
      ...payload,
      correlation_id: correlationId,
    },
    {
      status,
      headers: {
        "X-Correlation-Id": correlationId,
      },
    }
  );
}
