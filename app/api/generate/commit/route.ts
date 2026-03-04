import { supabase } from "@/lib/supabase";
import { generateCanonicalGS1 } from "@/lib/gs1Canonical";
import { generateSSCC } from "@/lib/gs1";
import { generateSerial } from "@/lib/serial";
import { NextResponse } from "next/server";

const MAX_CODES_PER_REQUEST = 10000;
const BATCH_SIZE = 1000;

export async function POST(req: Request) {
  const body = await req.json();

  const { company, sku, gtin, batch, mfd, exp, mrp,
          quantity, packing_rule_id, printer_id, compliance_ack } = body;

  if (compliance_ack !== true) {
    return NextResponse.json({ error: "compliance_ack=true is required" }, { status: 400 });
  }

  if (!gtin || typeof gtin !== "string" || gtin.trim().length === 0) {
    return NextResponse.json({ error: "gtin is required (GS1 mode only) for commit route" }, { status: 400 });
  }

  const invalidQuantity =
    typeof quantity !== "number" ||
    !Number.isInteger(quantity) ||
    quantity <= 0 ||
    quantity > MAX_CODES_PER_REQUEST;

  if (invalidQuantity) {
    return NextResponse.json(
      {
        error: "Quantity must be an integer between 1 and 10,000.",
      },
      { status: 400 }
    );
  }

  const { data: job, error: jobError } = await supabase
    .from("label_jobs")
    .insert({
      company_id: company.id,
      sku_id: sku.id,
      packing_rule_id,
      printer_id,
      status: "committed"
    })
    .select()
    .single();

  if (jobError || !job) {
    return NextResponse.json(
      { error: "Database error while creating labels." },
      { status: 500 }
    );
  }

  const unitRows = [];
  for (let i = 0; i < quantity; i++) {
    const serial = generateSerial(job.id);

    const gs1 = generateCanonicalGS1({
      gtin,
      expiry: exp,
      mfgDate: mfd,
      batch,
      serial,
      mrp: mrp,
      sku: sku.code
    });

    unitRows.push({
      company_id: company.id,
      sku_id: sku.id,
      gtin,
      batch,
      mfd,
      expiry: exp,
      mrp: mrp || null,
      serial,
      gs1_payload: gs1,
      code_mode: "GS1",
      payload: gs1
    });
  }

  for (let i = 0; i < unitRows.length; i += BATCH_SIZE) {
    const chunk = unitRows.slice(i, i + BATCH_SIZE);
    const { error: insertError } = await supabase.from("labels_units").insert(chunk);

    if (insertError) {
      return NextResponse.json(
        { error: "Database error while creating labels." },
        { status: 500 }
      );
    }
  }

  const sscc = generateSSCC(company.prefix, generateSerial(job.id));
  const { error: palletError } = await supabase.from("labels_pallets").insert({
    job_id: job.id,
    sscc
  });

  if (palletError) {
    return NextResponse.json(
      { error: "Database error while creating labels." },
      { status: 500 }
    );
  }

  return NextResponse.json({ job_id: job.id });
}
