/* fitness-dayreview.js — Pulse Fitness Day Review: for a chosen day, see which
   muscle groups you focused on (from that day's workouts, highlighted on the
   figure) and log key points on the body map FOR THAT DAY. */
(function () {
  const { el, clear, toast, guard } = window.ui;
  const api = window.api;
  const P = window.PULSE;

  // muscle group → body-map region keys (for highlighting worked muscles)
  const MUSCLE_REGIONS = {
    Chest: ["chest"], Shoulders: ["r_shoulder", "l_shoulder"], "Rear Delts": ["r_shoulder", "l_shoulder"],
    Triceps: ["r_arm", "l_arm"], Biceps: ["r_arm", "l_arm"], Arms: ["r_arm", "l_arm", "r_hand", "l_hand"],
    Back: ["lower_back"], Core: ["core"], Quads: ["r_quad", "l_quad"], Hamstrings: ["r_quad", "l_quad"],
    Glutes: ["r_hip", "l_hip"], Calves: ["r_calf", "l_calf"], Legs: ["r_quad", "l_quad", "r_calf", "l_calf"],
  };

  let curDate = P.today();
  function shift(days) { const d = new Date(curDate + "T00:00:00"); d.setDate(d.getDate() + days); curDate = P.dateStr(d); }

  async function render(host) {
    async function reload() {
      const d = await guard(() => api.pulse.fitness.dayReview(curDate));
      clear(host);
      // date navigator
      const dateIn = el("input.mform-input", { type: "date", value: curDate, style: "width:150px" });
      dateIn.addEventListener("change", () => { curDate = dateIn.value; reload(); });
      host.appendChild(el("div.row", { style: "gap:8px;margin-bottom:16px;align-items:center" }, [
        el("button.btn-sm", { onclick: () => { shift(-1); reload(); }, text: "‹ prev" }),
        dateIn,
        el("button.btn-sm", { onclick: () => { shift(1); reload(); }, text: "next ›" }),
        el("button.btn-sm", { onclick: () => { curDate = P.today(); reload(); }, text: "today" }),
        el("span.sub", { text: P.fmtDay(curDate) }),
      ]));

      const worked = new Set();
      (d.muscle_groups || []).forEach((m) => (MUSCLE_REGIONS[m] || []).forEach((r) => worked.add(r)));

      const grid = el("div", { style: "display:grid;grid-template-columns:280px 1fr;gap:24px;align-items:start" });
      // left: figure — worked muscles highlighted + clickable to log the day's key points
      const left = el("div");
      left.appendChild(el("h3", { style: "margin:0 0 6px", text: "Body — this day" }));
      left.appendChild(window.FIT.buildBodySvg(d.body_points, (k, st, next) => guard(async () => {
        await api.pulse.fitness.setDayBody(k, { date: curDate, state: next }); reload();
      }), worked));
      left.appendChild(window.FIT.bodyLegend());
      grid.appendChild(left);

      // right: muscle focus, workouts, day note
      const right = el("div");
      right.appendChild(el("h3", { style: "margin:0 0 6px", text: "Muscle focus" }));
      if (d.muscle_groups.length) right.appendChild(el("div.row", { style: "gap:5px;flex-wrap:wrap;margin-bottom:14px" }, d.muscle_groups.map((m) => el("span.pulse-tag", { text: m }))));
      else right.appendChild(el("div.sub", { style: "margin-bottom:14px", text: "No workouts logged this day." }));

      if (d.workouts.length) {
        right.appendChild(el("div.mform-label", { text: "Workouts" }));
        d.workouts.forEach((w) => right.appendChild(el("div.sub", { style: "padding:3px 0", text: "• " + w.type + " · " + (w.duration || 0) + "min · " + (w.exercises ? w.exercises.length : 0) + " ex" })));
      }

      right.appendChild(el("div.mform-label", { style: "margin-top:14px", text: "Day note" }));
      const note = el("textarea.mform-input", { rows: "2", placeholder: "how the body felt, notes for this day…", style: "width:100%" });
      note.value = d.note || "";
      note.addEventListener("change", () => guard(async () => { await api.pulse.fitness.setDayNote({ date: curDate, text: note.value }); toast("day note saved"); }));
      right.appendChild(note);
      grid.appendChild(right);

      host.appendChild(grid);
    }
    reload();
  }

  window.FIT_TABS = window.FIT_TABS || [];
  window.FIT_TABS.push({ key: "dayreview", label: "Day Review", render });
})();
