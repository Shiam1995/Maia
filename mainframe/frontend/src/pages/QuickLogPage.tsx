import { useRef, useState } from "react";
import { api } from "../lib/api";
import type { Meal, MealType } from "../lib/types";
import { kcal } from "../lib/format";

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

function guessMealType(): MealType {
  const h = new Date().getHours();
  if (h < 11) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

/**
 * Simplified single-column quick-log, designed for a phone browser:
 * one text field, a big meal-type selector, an optional photo, and a
 * confirmation of what was logged.
 */
export default function QuickLogPage() {
  const [description, setDescription] = useState("");
  const [mealType, setMealType] = useState<MealType>(guessMealType());
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<Meal | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!description.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("description", description);
      form.append("meal_type", mealType);
      form.append("source", "phone");
      if (photo) form.append("photo", photo);
      const meal = await api.quickLog(form);
      setLast(meal);
      setDescription("");
      setPhoto(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="quicklog">
      <h1 className="ql-title">Quick log</h1>

      <textarea
        className="input textarea ql-input"
        placeholder="What did you eat?"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        autoFocus
      />

      <div className="ql-types">
        {MEAL_TYPES.map((t) => (
          <button
            key={t}
            className={`ql-type ${mealType === t ? "active" : ""}`}
            onClick={() => setMealType(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <label className="ql-photo">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
        />
        <span>{photo ? `📷 ${photo.name}` : "📷 Add photo (optional)"}</span>
      </label>

      <button className="btn btn-primary ql-submit" onClick={submit} disabled={busy}>
        {busy ? "Logging…" : "Log it"}
      </button>

      {error && <div className="error">{error}</div>}

      {last && (
        <div className="ql-confirm">
          <div className="ql-check">✓ Logged</div>
          <div className="ql-summary">
            {last.description} · <b>{kcal(last.total_calories)}</b>
          </div>
          <div className="ql-items">
            {last.items.map((it) => (
              <span key={it.id} className="ql-chip">
                {it.name}
                {it.calories != null ? ` (${Math.round(it.calories)})` : ""}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
