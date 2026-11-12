/* Affichage des pesées en grammes entiers ; la précision des calculs est conservée. */
const gramsFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

export function formatGrams(value: number): string {
  if (!Number.isFinite(value)) return "—";
  // Ne pas afficher 0 g lorsqu'une petite dose (p. ex. levure) est nécessaire.
  if (value > 0 && value < 0.5) return "< 1 g";
  return gramsFormatter.format(Math.round(value)) + " g";
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
