export type LabelCodeType = "QR" | "DATAMATRIX";

export const LABEL_CODE_TYPE_OPTIONS: Array<{ value: LabelCodeType; label: string }> = [
  { value: "QR", label: "QR Code" },
  { value: "DATAMATRIX", label: "DataMatrix" },
];

export function normalizeLabelCodeType(value: unknown, fallback: LabelCodeType = "DATAMATRIX"): LabelCodeType {
  return value === "QR" || value === "DATAMATRIX" ? value : fallback;
}
