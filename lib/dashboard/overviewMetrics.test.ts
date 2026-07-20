import { describe, expect, it } from "vitest";
import { getOverviewGenerationMetrics, TOTAL_SSCC_KPI_LABEL } from "@/lib/dashboard/overviewMetrics";

describe("getOverviewGenerationMetrics", () => {
  it("counts box-only SSCC records in the SSCC KPI", () => {
    expect(
      getOverviewGenerationMetrics({ units: 0, boxes: 5, cartons: 0, pallets: 0 }).totalSsccGenerated
    ).toBe(5);
  });

  it("counts carton-only SSCC records in the SSCC KPI", () => {
    expect(
      getOverviewGenerationMetrics({ units: 0, boxes: 0, cartons: 7, pallets: 0 }).totalSsccGenerated
    ).toBe(7);
  });

  it("counts pallet-only SSCC records in the SSCC KPI", () => {
    expect(
      getOverviewGenerationMetrics({ units: 0, boxes: 0, cartons: 0, pallets: 3 }).totalSsccGenerated
    ).toBe(3);
  });

  it("keeps the dashboard label aligned with the aggregated SSCC metric", () => {
    expect(TOTAL_SSCC_KPI_LABEL).toBe("Total SSCC Generated");
  });
});
