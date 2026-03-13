export const INDUSTRY_OPTIONS = [
  'Pharmaceutical',
  'Biotechnology',
  'Medical Devices',
  'Healthcare',
  'Food & Beverage',
  'Cosmetics & Personal Care',
  'Agriculture & Seeds',
  'Chemicals',
  'Electronics',
  'Automotive',
  'Consumer Goods',
  'Logistics & Distribution',
] as const;

export const industries = INDUSTRY_OPTIONS;

export type IndustryOption = (typeof INDUSTRY_OPTIONS)[number];

export function isIndustryOption(value: string): value is IndustryOption {
  return INDUSTRY_OPTIONS.includes(value as IndustryOption);
}
