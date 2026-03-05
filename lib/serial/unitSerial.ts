import { randomUUID } from "crypto";

export function generateUnitSerial(companyId: string): string {
  const prefix = String(companyId || "").slice(0, 4);
  const uuid = randomUUID().replace(/-/g, "");
  return `U${prefix}${uuid.slice(0, 20)}`.toUpperCase();
}

