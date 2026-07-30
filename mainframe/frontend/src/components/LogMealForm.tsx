import { useState } from "react";
import { api } from "../lib/api";
import type { FoodItem, MealType } from "../lib/types";
import { kcal, grams } from "../lib/format";

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

function guessMealType(): MealType {
  const h = new Date().getHours();
  if (h < 11) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

export default function LogMealForm({ onLogged }: { onLogged: () => void }) {
  const [description, setDescription] = useState("");
  const [mealType, setMealType] = useState<MealType>(guessMealType());
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<FoodItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runPreview() {
    if (!description.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const items = await api.preview({
        description,
        meal_type: mealType,
        source: "web",
      });
      setPreview(items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!description.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createMeal({ description, meal_type: mealType, notes, source: "web" });
      setDescription("");
      setNotes("");
      setPreview(null);
      onLogged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const previewTotal = preview?.reduce((s, i) => s + (i.calories ?? 0), 0) ?? 0;

  return (
    <div className="card log-form">
      <h2 className="card-title">Log a meal</h2>
      <textarea
        className="input textarea"
        placeholder="Describe your meal — e.g. “chicken breast with rice and spinach”"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
      />
      <div className="row">
        <div className="segmented">
          {MEAL_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={`seg ${mealType === t ? "seg-active" : ""}`}
              onClick={() => setMealType(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <input
        className="input"
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <div className="row actions">
        <button className="btn btn-ghost" onClick={runPreview} disabled={busy}>
          {busy ? "Parsing…" : "Preview"}
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          Log meal
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {preview && (
        <div className="preview">
          <div className="preview-head">
            <span>Parsed items</span>
            <span className="preview-total">{kcal(previewTotal)}</span>
          </div>
          <table className="items-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Portion</th>
                <th>Cal</th>
                <th>P</th>
                <th>C</th>
                <th>F</th>
                <th>Src</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((it, i) => (
                <tr key={i} className={it.matched ? "" : "unmatched"}>
                  <td>{it.name}</td>
                  <td>{grams(it.estimated_grams)}</td>
                  <td>{it.calories == null ? "—" : Math.round(it.calories)}</td>
                  <td>{it.protein_g == null ? "—" : it.protein_g.toFixed(0)}</td>
                  <td>{it.carbs_g == null ? "—" : it.carbs_g.toFixed(0)}</td>
                  <td>{it.fat_g == null ? "—" : it.fat_g.toFixed(0)}</td>
                  <td className="src">{it.source_db ?? "?"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
