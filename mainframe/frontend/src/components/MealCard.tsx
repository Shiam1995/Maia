import { useState } from "react";
import type { Meal } from "../lib/types";
import { mediaUrl } from "../lib/api";
import { kcal, timeOfDay, MEAL_TYPE_ICON } from "../lib/format";

export default function MealCard({
  meal,
  onDelete,
}: {
  meal: Meal;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const photo = mediaUrl(meal.photo_url);

  return (
    <div className="card meal-card">
      <div className="meal-head" onClick={() => setOpen((o) => !o)}>
        <span className="meal-icon">{MEAL_TYPE_ICON[meal.meal_type] ?? "🍴"}</span>
        <div className="meal-main">
          <div className="meal-desc">{meal.description}</div>
          <div className="meal-sub">
            {meal.meal_type} · {timeOfDay(meal.eaten_at)}
            {meal.source !== "web" ? ` · ${meal.source}` : ""}
          </div>
        </div>
        <div className="meal-kcal">{kcal(meal.total_calories)}</div>
      </div>

      <div className="macro-row">
        <MacroPill label="P" value={meal.total_protein_g} accent="p" />
        <MacroPill label="C" value={meal.total_carbs_g} accent="c" />
        <MacroPill label="F" value={meal.total_fat_g} accent="f" />
        <MacroPill label="Sugar" value={meal.total_sugar_g} accent="s" />
        <MacroPill label="Fibre" value={meal.total_fibre_g} accent="fi" />
      </div>

      {photo && <img className="meal-photo" src={photo} alt={meal.description} />}

      {open && (
        <div className="meal-detail">
          {meal.items.length === 0 && <div className="muted">No parsed items.</div>}
          {meal.items.map((it) => (
            <div key={it.id} className="item-row">
              <span className="item-name">
                {it.name}
                {!it.matched && <span className="badge-unmatched">no match</span>}
              </span>
              <span className="item-macros">
                {it.estimated_grams ? `${it.estimated_grams.toFixed(0)}g · ` : ""}
                {it.calories == null ? "—" : `${Math.round(it.calories)} kcal`}
              </span>
            </div>
          ))}
          {meal.notes && <div className="meal-notes">📝 {meal.notes}</div>}
          <button className="btn btn-danger btn-sm" onClick={() => onDelete(meal.id)}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function MacroPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | null;
  accent: string;
}) {
  return (
    <span className={`pill pill-${accent}`}>
      <b>{label}</b> {value == null ? "—" : `${value.toFixed(0)}g`}
    </span>
  );
}
