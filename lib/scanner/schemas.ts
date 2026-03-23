import { z } from "zod";

export const MAX_SCANNER_RAW_LENGTH = 4096;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

const deviceContextValueSchema = z.union([z.string().max(256), z.number(), z.boolean(), z.null()]);

export const scannerDeviceContextSchema = z
  .record(z.string().max(64), deviceContextValueSchema)
  .refine((value) => Object.keys(value).length <= 20, "Too many device_context fields")
  .optional();

export const scanRequestBodySchema = z
  .object({
    raw: z.string().trim().min(1).max(MAX_SCANNER_RAW_LENGTH),
    company_id: z.string().uuid().optional(),
    device_context: scannerDeviceContextSchema,
    idempotency_key: z.string().trim().min(8).max(MAX_IDEMPOTENCY_KEY_LENGTH).optional(),
  })
  .strict();

export const verifyRequestBodySchema = z
  .object({
    raw: z.string().trim().min(1).max(MAX_SCANNER_RAW_LENGTH).optional(),
    gs1_raw: z.string().trim().min(1).max(MAX_SCANNER_RAW_LENGTH).optional(),
    code: z.string().trim().min(1).max(MAX_SCANNER_RAW_LENGTH).optional(),
    qr: z.string().trim().min(1).max(MAX_SCANNER_RAW_LENGTH).optional(),
    company_id: z.string().uuid().optional(),
    device_context: scannerDeviceContextSchema,
    idempotency_key: z.string().trim().min(8).max(MAX_IDEMPOTENCY_KEY_LENGTH).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.raw || value.gs1_raw || value.code || value.qr), {
    message: "One of raw, gs1_raw, code, or qr is required",
  });

export function extractVerifyRawInput(body: z.infer<typeof verifyRequestBodySchema>): string {
  return String(body.gs1_raw || body.raw || body.code || body.qr || "").trim();
}

