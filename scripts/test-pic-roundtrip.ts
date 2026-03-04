import { buildPicUnitPayload } from "@/lib/picPayload";
import { parsePayload } from "@/lib/parsePayload";

function assert(condition: any, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  const payload = buildPicUnitPayload({
    sku: "SKU001",
    batch: "BATCH123",
    expiryYYMMDD: "251231",
    mfgYYMMDD: "240115",
    serial: "UABCD123",
    mrp: "100.00",
  });

  const parsed = parsePayload(payload);
  assert(parsed.mode === "PIC", `expected PIC, got ${parsed.mode}`);
  if (parsed.mode !== "PIC") return;
  assert(parsed.parsed.serial === "UABCD123", "serial mismatch");
  assert(parsed.parsed.sku === "SKU001", "sku mismatch");
  assert(parsed.parsed.batch === "BATCH123", "batch mismatch");
  assert(parsed.parsed.expiryYYMMDD === "251231", "expiry mismatch");

  console.log("PIC roundtrip OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

