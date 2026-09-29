import { describe, expect, it } from "vitest";
import { getApiErrorMessage } from "./clientError";

describe("getApiErrorMessage", () => {
  it("reads normalized backend error messages", () => {
    expect(getApiErrorMessage({ success: false, error: { code: "BAD_REQUEST", message: "Plan invalid" } }, "Failed"))
      .toBe("Plan invalid");
  });

  it("reads the legacy message without stringifying an error object", () => {
    expect(getApiErrorMessage({ error: { code: "INTERNAL_ERROR" }, legacy_message: "Database write failed" }, "Failed"))
      .toBe("Database write failed");
  });

  it("uses a fallback for malformed error payloads", () => {
    expect(getApiErrorMessage({ error: { code: "UNKNOWN" } }, "Plan save failed")).toBe("Plan save failed");
  });
});
