/* Unités pratiques, sans perte des petites doses de levure ou de sel. */
const gramsFormatter = [
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }),
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }),
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }),
];

export function formatGrams(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  const places = magnitude >= 1 ? 0 : magnitude >= 0.1 ? 1 : 2;
  return gramsFormatter[places].format(value) + " g";
}

export function formatKilograms(valueInGrams: number): string {
  if (!Number.isFinite(valueInGrams)) return "—";
  const magnitude = Math.abs(valueInGrams);
  const digits = magnitude >= 1000 ? 3 : magnitude >= 1 ? 3 : magnitude >= 0.1 ? 4 : 5;
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: 0 })
    .format(valueInGrams / 1000) + " kg";
}

export function formatDualQuantity(valueInGrams: number): string {
  return formatGrams(valueInGrams) + " · " + formatKilograms(valueInGrams);
}
