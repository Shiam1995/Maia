/* fitness-program.js — Pulse Fitness Program: training cycles with a clickable
   week grid (current week highlighted, completed weeks filled). */
(function () {
  const { el, clear, toast, guard, confirmDo } = window.ui;
  const api = window.api;
  const P = window.PULSE;
  const PHASES = ["Hypertrophy", "Strength", "Power", "Endurance", "Deload", "Cut", "Bulk", "Maintenance", "Rehab"];

  function newCycleModal(reload) {
    const name = el("input.mform-input", { placeholder: "e.g. Hypertrophy Block" });
    const weeks = el("input.mform-input", { type: "number", min: "1", value: "12" });
    const start = el("input.mform-input", { type: "date", value: P.today() });
    const phase = el("select.mform-input", {}, PHASES.map((p) => el("option", { value: p, text: p })));
    const goals = el("textarea.mform-input", { placeholder: "what do you want to achieve?" });
    const notes = el("textarea.mform-input", { placeholder: "split, frequency, key lifts, deload schedule" });
    const field = (l, n) => el("div.mform-full", {}, [el("div.mform-label", { text: l }), n]);
    P.modal("New cycle", [
      field("Name", name), el("div.mform-row-3", {}, [field("Weeks", weeks), field("Start", start), field("Phase", phase)]),
      field("Goals", goals), field("Notes", notes),
    ], [
      { label: "Create", primary: true, onClick: (close) => guard(async () => {
        if (!name.value.trim()) return toast("name it", true);
        await api.pulse.fitness.createCycle({ name: name.value.trim(), weeks: parseInt(weeks.value) || 12, start_date: start.value, phase: phase.value, goals: goals.value.trim(), notes: notes.value.trim() });
        close(); reload();
      }) },
      { label: "Cancel", onClick: (close) => close() },
    ]);
  }

  function cycleCard(c, reload) {
    const done = c.weeks_done || [];
    const completed = c.status === "completed";
    const card = el("div.pulse-card" + (completed ? ".exp-done" : ""), {}, [
      el("div.spread", {}, [
        el("div.row", { style: "gap:6px" }, [
          el("span", { style: "font-weight:600;font-size:15px", text: c.name }),
          el("span.pulse-tag", { text: c.phase }),
          el("span.pulse-tag", { text: c.weeks + " wk" }),
          c.current_week ? el("span.pulse-tag", { text: "week " + c.current_week }) : null,
          el("span.sub", { text: done.length + "/" + c.weeks + " done" }),
        ]),
        el("div.row", { style: "gap:6px" }, [
          completed ? null : el("button.btn-sm.btn-primary", { onclick: () => guard(async () => { await api.pulse.fitness.updateCycle(c.id, { status: "completed" }); reload(); }), text: "complete" }),
          el("button.btn-sm.btn-danger", { onclick: () => confirmDo("Delete cycle “" + c.name + "”?", async () => { await api.pulse.fitness.delCycle(c.id); reload(); }), text: "×" }),
        ]),
      ]),
    ]);
    // week grid
    const grid = el("div.week-grid");
    for (let i = 1; i <= c.weeks; i++) {
      const cls = i === c.current_week ? ".current" : done.includes(i) ? ".done" : "";
      const sq = el("div.week-sq" + cls, { title: "week " + i, text: String(i) });
      sq.addEventListener("click", () => guard(async () => {
        const next = done.includes(i) ? done.filter((x) => x !== i) : done.concat(i);
        await api.pulse.fitness.updateCycle(c.id, { weeks_done: next }); reload();
      }));
      grid.appendChild(sq);
    }
    card.appendChild(grid);
    if (c.goals) card.appendChild(el("p.sub", { style: "margin-top:10px", text: "Goals: " + c.goals }));
    if (c.notes) card.appendChild(el("p.sub", { style: "margin-top:4px", text: c.notes }));
    window.Images.mount(card, { module: "pulse", contextId: c.id, surface: "pulse-cycle", title: "Images" });
    return card;
  }

  async function render(host) {
    async function reload() {
      const cycles = await guard(() => api.pulse.fitness.cycles());
      clear(host);
      host.appendChild(el("div.row", { style: "justify-content:flex-end;margin-bottom:12px" }, [
        el("button.btn-primary", { onclick: () => newCycleModal(reload), text: "＋ new cycle" }),
      ]));
      if (!cycles.length) { host.appendChild(el("div.empty", { text: "No training cycles yet. Start one above." })); return; }
      cycles.forEach((c) => host.appendChild(cycleCard(c, reload)));
    }
    reload();
  }

  window.FIT_TABS = window.FIT_TABS || [];
  window.FIT_TABS.push({ key: "program", label: "Program", render });
})();
