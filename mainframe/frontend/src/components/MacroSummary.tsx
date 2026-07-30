import type { NutrientTotals } from "../lib/types";

const MACROS: {
  key: keyof NutrientTotals;
  label: string;
  unit: string;
  color: string;
}[] = [
  { key: "calories", label: "Calories", unit: "kcal", color: "#7dd3fc" },
  { key: "protein_g", label: "Protein", unit: "g", color: "#86efac" },
  { key: "carbs_g", label: "Carbs", unit: "g", color: "#fcd34d" },
  { key: "fat_g", label: "Fat", unit: "g", color: "#fca5a5" },
  { key: "sugar_g", label: "Sugar", unit: "g", color: "#f0abfc" },
  { key: "fibre_g", label: "Fibre", unit: "g", color: "#a5b4fc" },
];

export default function MacroSummary({
  totals,
  title,
}: {
  totals: NutrientTotals;
  title: string;
}) {
  return (
    <div className="card">
      <h2 className="card-title">{title}</h2>
      <div className="stat-grid">
        {MACROS.map((m) => (
          <div key={m.key} className="stat">
            <div className="stat-value" style={{ color: m.color }}>
              {Math.round(totals[m.key])}
              <span className="stat-unit">{m.unit}</span>
            </div>
            <div className="stat-label">{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
