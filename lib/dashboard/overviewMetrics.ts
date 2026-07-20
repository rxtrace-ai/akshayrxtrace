export const TOTAL_SSCC_KPI_LABEL = "Total SSCC Generated";

export function getOverviewGenerationMetrics(params: {
  units: number;
  boxes: number;
  cartons: number;
  pallets: number;
}) {
  const units = Math.max(0, Math.trunc(params.units || 0));
  const boxes = Math.max(0, Math.trunc(params.boxes || 0));
  const cartons = Math.max(0, Math.trunc(params.cartons || 0));
  const pallets = Math.max(0, Math.trunc(params.pallets || 0));

  return {
    totalLabelsGenerated: units + boxes + cartons + pallets,
    totalSsccGenerated: boxes + cartons + pallets,
  };
}
