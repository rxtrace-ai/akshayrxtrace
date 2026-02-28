import { describe, expect, it } from "vitest";
import { errorResponse, successResponse } from "./responses";

describe("admin response helpers", () => {
  it("includes correlation id in error body and header", async () => {
    const response = errorResponse(409, "CONFLICT", "Test conflict", "corr-1");
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(response.headers.get("X-Correlation-Id")).toBe("corr-1");
    expect(body.correlation_id).toBe("corr-1");
  });

  it("includes correlation id in success body and header", async () => {
    const response = successResponse(200, { success: true }, "corr-2");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Correlation-Id")).toBe("corr-2");
    expect(body.correlation_id).toBe("corr-2");
  });
});
