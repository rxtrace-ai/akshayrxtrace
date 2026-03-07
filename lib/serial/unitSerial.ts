import { randomBytes } from "crypto";

const SERIAL_LENGTH = 18;

export function generateUnitSerial(_companyId?: string): string {
  let serial = "";

  while (serial.length < SERIAL_LENGTH) {
    serial += randomBytes(16).toString("base64").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  }

  return serial.slice(0, SERIAL_LENGTH);
}
