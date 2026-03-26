import { apiJson } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  console.warn("[skus_ensure] deprecated_endpoint_rejected");
  return apiJson(
    {
      error:
        "This endpoint is deprecated. Create SKU Master records through SKU Master APIs and generate Unit codes using unit_sku_master_id.",
      code: "DEPRECATED_ENDPOINT",
    },
    { status: 410 }
  );
}
