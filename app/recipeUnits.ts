/* Unités pratiques, sans perte des petites doses de levure ou de sel. */
const gramsFormatter = [
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }),
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }),
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }),
];

export function formatGrams(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  const places = magnitude >= 1 ? 0 : 2;
  return gramsFormatter[places].format(value) + " g";
}

export function formatKilograms(valueInGrams: number): string {
  if (!Number.isFinite(valueInGrams)) return "—";
  const rounded = Math.abs(valueInGrams) >= 1 ? Math.round(valueInGrams) : valueInGrams;
  const magnitude = Math.abs(rounded);
  const digits = magnitude >= 100 ? 3 : magnitude >= 10 ? 4 : magnitude >= 1 ? 5 : 6;
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: 0 })
    .format(rounded / 1000) + " kg";
}

export function formatDualQuantity(valueInGrams: number): string {
  return formatGrams(valueInGrams) + " · " + formatKilograms(valueInGrams);
}
