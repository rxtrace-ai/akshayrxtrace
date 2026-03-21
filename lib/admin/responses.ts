import { NextResponse } from "next/server";

export function errorResponse(
  status: number,
  error: string,
  message: string,
  correlationId: string
) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: error,
        message,
      },
      // Backward-compatible fields
      legacy_error: error,
      legacy_message: message,
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
      success: true,
      data: payload,
      // Backward-compatible fields
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
