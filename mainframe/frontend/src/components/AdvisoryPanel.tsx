import type { AdvisoryResponse } from "../lib/types";

const ICON: Record<string, string> = {
  info: "ℹ️",
  warning: "⚠️",
  positive: "✅",
};

export default function AdvisoryPanel({ data }: { data: AdvisoryResponse | null }) {
  if (!data) return null;
  return (
    <div className="card advisory">
      <div className="advisory-head">
        <h2 className="card-title">Advisor</h2>
        <span className="advisory-tag">{data.generated_by}</span>
      </div>
      <ul className="advice-list">
        {data.advice.map((a, i) => (
          <li key={i} className={`advice advice-${a.severity}`}>
            <span className="advice-icon">{ICON[a.severity] ?? "•"}</span>
            {a.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
