/* fitness-workouts.js — Pulse Fitness Workouts: log via ONE exercises textarea
   (name / detail per line), colour-coded intensity, interrupted flag. Exposes
   window.FIT.workoutCard for History to reuse. */
(function () {
  const { el, clear, toast, guard, confirmDo } = window.ui;
  const api = window.api;
  const P = window.PULSE;
  const TYPES = ["Push", "Pull", "Legs", "Upper", "Lower", "Full Body", "Cardio", "HIIT", "Sport", "Other"];
  const INTERRUPTED = ["no", "yes — pain", "yes — time", "yes — fatigue"];

  function intensityClass(n) { return n <= 4 ? "intensity-lo" : n <= 7 ? "intensity-mid" : "intensity-hi"; }
  function parseExercises(text) {
    return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const i = l.indexOf("/");
      return i === -1 ? { name: l, detail: "" } : { name: l.slice(0, i).trim(), detail: l.slice(i + 1).trim() };
    });
  }

  const open = new Set();
  function workoutCard(w, reload) {
    const isOpen = open.has(w.id);
    const card = el("div.pulse-card", {}, [
      el("div.spread", { style: "cursor:pointer", onclick: () => { isOpen ? open.delete(w.id) : open.add(w.id); reload(); } }, [
        el("div.row", { style: "gap:8px" }, [
          el("span.sub", { text: P.fmtDay((w.date || "").slice(0, 10)) }),
          el("span.pulse-tag", { text: w.type }),
          el("span.sub", { text: (w.duration || 0) + "min" }),
          el("span", { class: "mono " + intensityClass(w.intensity), style: "font-size:11px", text: "⚡" + w.intensity }),
          w.interrupted && w.interrupted !== "no" ? el("span.pulse-tag", { style: "background:var(--red-d);color:var(--red)", text: "⚠ " + w.interrupted.replace("yes — ", "") }) : null,
        ]),
        el("span.sub", { text: (w.exercises ? w.exercises.length : 0) + " ex" }),
      ]),
    ]);
    if (isOpen) {
      const body = el("div", { style: "margin-top:10px;border-top:1px solid var(--border);padding-top:10px" });
      (w.exercises || []).forEach((e) => body.appendChild(el("div", { style: "padding:3px 0", text: "• " + e.name + (e.detail ? "  — " + e.detail : "") })));
      if (w.notes) body.appendChild(el("p.sub", { style: "margin-top:8px", text: w.notes }));
      window.Images.mount(body, { module: "pulse", contextId: w.id, surface: "pulse-workout", title: "Images" });
      body.appendChild(el("button.btn-sm.btn-danger", { style: "margin-top:8px", onclick: () => confirmDo("Delete this workout?", async () => { await api.pulse.fitness.delWorkout(w.id); reload(); }), text: "× delete" }));
      card.appendChild(body);
    }
    return card;
  }
  window.FIT = window.FIT || {};
  window.FIT.workoutCard = workoutCard;

  function logModal(reload) {
    const date = el("input.mform-input", { type: "date", value: P.today() });
    const type = el("select.mform-input", {}, TYPES.map((t) => el("option", { value: t, text: t })));
    const dur = el("input.mform-input", { type: "number", min: "0", placeholder: "minutes" });
    const inten = el("input.mform-input", { type: "number", min: "1", max: "10", value: "6" });
    const intr = el("select.mform-input", {}, INTERRUPTED.map((i) => el("option", { value: i, text: i })));
    const ex = el("textarea.mform-input", { rows: "6", placeholder: "Bench Press / 4x8 @ 80kg\nIncline DB Press / 3x10 @ 30kg\nCable Fly / 3x12 @ 15kg" });
    const notes = el("textarea.mform-input", { placeholder: "how it felt, energy, form notes, PRs" });
    const field = (l, n) => el("div.mform-full", {}, [el("div.mform-label", { text: l }), n]);
    P.modal("Log workout", [
      el("div.mform-row-3", {}, [field("Date", date), field("Type", type), field("Duration", dur)]),
      el("div.mform-row", {}, [field("Intensity 1-10", inten), field("Interrupted?", intr)]),
      field("Exercises (one per line: name / detail)", ex), field("Notes", notes),
    ], [
      { label: "Log", primary: true, onClick: (close) => guard(async () => {
        await api.pulse.fitness.createWorkout({
          date: date.value, type: type.value, duration: parseInt(dur.value) || 0,
          intensity: Math.min(10, Math.max(1, parseInt(inten.value) || 6)), interrupted: intr.value,
          notes: notes.value.trim(), exercises: parseExercises(ex.value),
        });
        close(); reload();
      }) },
      { label: "Cancel", onClick: (close) => close() },
    ]);
  }

  async function render(host) {
    async function reload() {
      const workouts = await guard(() => api.pulse.fitness.workouts());
      clear(host);
      host.appendChild(el("div.row", { style: "justify-content:flex-end;margin-bottom:12px" }, [
        el("button.btn-primary", { onclick: () => logModal(reload), text: "＋ log workout" }),
      ]));
      if (!workouts.length) { host.appendChild(el("div.empty", { text: "No workouts yet. Log your first above." })); return; }
      workouts.forEach((w) => host.appendChild(workoutCard(w, reload)));
    }
    reload();
  }

  window.FIT_TABS = window.FIT_TABS || [];
  window.FIT_TABS.push({ key: "workouts", label: "Workouts", render });
})();
