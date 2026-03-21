import { NextResponse } from "next/server";

type ApiErrorBody = {
  code: string;
  message: string;
};

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(
    {
      success: true,
      data,
    },
    { status }
  );
}

export function fail(code: string, message: string, status = 400) {
  const error: ApiErrorBody = { code, message };
  return NextResponse.json(
    {
      success: false,
      error,
    },
    { status }
  );
}

function normalizeErrorCode(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "REQUEST_FAILED";
  return /^[A-Z0-9_]+$/.test(raw) ? raw : "REQUEST_FAILED";
}

function getErrorMessage(payload: any): string {
  if (payload?.error && typeof payload.error === "object" && typeof payload.error.message === "string") {
    return payload.error.message;
  }
  if (typeof payload?.error === "string" && payload.error.trim()) {
    return payload.error;
  }
  if (typeof payload?.message === "string" && payload.message.trim()) {
    return payload.message;
  }
  return "Request failed";
}

export function apiJson(payload: any, init?: ResponseInit) {
  const status = init?.status ?? 200;

  // Already normalized.
  if (
    payload &&
    typeof payload === "object" &&
    typeof payload.success === "boolean" &&
    (payload.success ? "data" in payload : payload.error?.code && payload.error?.message)
  ) {
    return NextResponse.json(payload, init);
  }

  if (status >= 400) {
    const code =
      payload?.error && typeof payload.error === "object" && typeof payload.error.code === "string"
        ? normalizeErrorCode(payload.error.code)
        : normalizeErrorCode(payload?.error);
    const message = getErrorMessage(payload);
    return fail(code, message, status);
  }

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return NextResponse.json(
      {
        success: true,
        data: payload,
        ...payload,
      },
      { status }
    );
  }

  return ok(payload, status);
}
