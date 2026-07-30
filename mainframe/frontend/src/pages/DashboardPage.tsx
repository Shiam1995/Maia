import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AdvisoryResponse, Meal, TrendsResponse } from "../lib/types";
import LogMealForm from "../components/LogMealForm";
import MealCard from "../components/MealCard";
import TrendsChart from "../components/TrendsChart";
import MacroSummary from "../components/MacroSummary";
import AdvisoryPanel from "../components/AdvisoryPanel";
import { dayLabel } from "../lib/format";

type Granularity = "day" | "week" | "month";

export default function DashboardPage() {
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [trends, setTrends] = useState<TrendsResponse | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [advisory, setAdvisory] = useState<AdvisoryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, m, a] = await Promise.all([
        api.trends(granularity),
        api.listMeals({ limit: 50 }),
        api.advisory(),
      ]);
      setTrends(t);
      setMeals(m);
      setAdvisory(a);
    } finally {
      setLoading(false);
    }
  }, [granularity]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(id: string) {
    await api.deleteMeal(id);
    load();
  }

  // Group meals by calendar day for the timeline.
  const grouped = groupByDay(meals);

  return (
    <div className="dashboard">
      <section className="col col-main">
        {trends && (
          <>
            <div className="granularity">
              {(["day", "week", "month"] as Granularity[]).map((g) => (
                <button
                  key={g}
                  className={`gran-btn ${granularity === g ? "active" : ""}`}
                  onClick={() => setGranularity(g)}
                >
                  {g}
                </button>
              ))}
            </div>
            <MacroSummary
              totals={trends.averages}
              title={`Average per ${granularity}`}
            />
            <TrendsChart buckets={trends.buckets} />
          </>
        )}

        <div className="timeline">
          <h2 className="section-title">Recent meals</h2>
          {loading && meals.length === 0 && <div className="empty">Loading…</div>}
          {!loading && meals.length === 0 && (
            <div className="empty">No meals logged yet. Add one on the right →</div>
          )}
          {grouped.map(([day, dayMeals]) => (
            <div key={day} className="day-group">
              <div className="day-heading">{dayLabel(day)}</div>
              {dayMeals.map((meal) => (
                <MealCard key={meal.id} meal={meal} onDelete={handleDelete} />
              ))}
            </div>
          ))}
        </div>
      </section>

      <aside className="col col-side">
        <LogMealForm onLogged={load} />
        <AdvisoryPanel data={advisory} />
      </aside>
    </div>
  );
}

function groupByDay(meals: Meal[]): [string, Meal[]][] {
  const map = new Map<string, Meal[]>();
  for (const m of meals) {
    const key = new Date(m.eaten_at).toISOString().slice(0, 10);
    const arr = map.get(key) ?? [];
    arr.push(m);
    map.set(key, arr);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}
