export function kcal(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Math.round(v)} kcal`;
}

export function grams(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(1)} g`;
}

export function num(v: number | null | undefined, digits = 0): string {
  if (v == null) return "—";
  return v.toFixed(digits);
}

export function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function shortDate(period: string): string {
  const d = new Date(period);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export const MEAL_TYPE_ICON: Record<string, string> = {
  breakfast: "🍳",
  lunch: "🥗",
  dinner: "🍽️",
  snack: "🍎",
};
