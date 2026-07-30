/* fitness-stretch.js — Pulse Fitness Stretching: log sessions (stretches one per
   line). Purple-bordered cards, expandable. Separate from workouts. */
(function () {
  const { el, clear, guard, confirmDo } = window.ui;
  const api = window.api;
  const P = window.PULSE;

  const open = new Set();

  function logModal(reload) {
    const date = el("input.mform-input", { type: "date", value: P.today() });
    const dur = el("input.mform-input", { type: "number", min: "0", placeholder: "minutes" });
    const focus = el("input.mform-input", { placeholder: "e.g. Hips and hamstrings" });
    const stretches = el("textarea.mform-input", { rows: "5", placeholder: "Hamstring stretch 30s each side\nHip flexor 45s each\nPigeon pose 60s each" });
    const notes = el("textarea.mform-input", { placeholder: "how it felt, improvements, tightness" });
    const field = (l, n) => el("div.mform-full", {}, [el("div.mform-label", { text: l }), n]);
    P.modal("Log stretch session", [
      el("div.mform-row", {}, [field("Date", date), field("Duration", dur)]), field("Focus", focus),
      field("Stretches (one per line)", stretches), field("Notes", notes),
    ], [
      { label: "Log", primary: true, onClick: (close) => guard(async () => {
        await api.pulse.fitness.logStretch({
          date: date.value, duration: parseInt(dur.value) || 0, focus: focus.value.trim(),
          stretches: stretches.value.split("\n").map((s) => s.trim()).filter(Boolean), notes: notes.value.trim(),
        });
        close(); reload();
      }) },
      { label: "Cancel", onClick: (close) => close() },
    ]);
  }

  function card(s, reload) {
    const isOpen = open.has(s.id);
    const c = el("div.pulse-card.stretch-card", {}, [
      el("div.spread", { style: "cursor:pointer", onclick: () => { isOpen ? open.delete(s.id) : open.add(s.id); reload(); } }, [
        el("div.row", { style: "gap:8px" }, [
          el("span.sub", { text: P.fmtDay((s.date || "").slice(0, 10)) }),
          el("span.sub", { text: (s.duration || 0) + "min" }),
          s.focus ? el("span.pulse-tag", { style: "background:var(--purple-d);color:var(--purple)", text: s.focus }) : null,
        ]),
        el("span.sub", { text: (s.stretches ? s.stretches.length : 0) + " stretches" }),
      ]),
    ]);
    if (isOpen) {
      const body = el("div", { style: "margin-top:10px;border-top:1px solid var(--border);padding-top:10px" });
      (s.stretches || []).forEach((x) => body.appendChild(el("div", { style: "padding:3px 0", text: "• " + x })));
      if (s.notes) body.appendChild(el("p.sub", { style: "margin-top:8px", text: s.notes }));
      window.Images.mount(body, { module: "pulse", contextId: s.id, surface: "pulse-stretch", title: "Images" });
      body.appendChild(el("button.btn-sm.btn-danger", { style: "margin-top:8px", onclick: () => confirmDo("Delete this session?", async () => { await api.pulse.fitness.delStretch(s.id); reload(); }), text: "× delete" }));
      c.appendChild(body);
    }
    return c;
  }

  async function render(host) {
    async function reload() {
      const sessions = await guard(() => api.pulse.fitness.stretching());
      clear(host);
      host.appendChild(el("div.row", { style: "justify-content:flex-end;margin-bottom:12px" }, [
        el("button.btn-primary", { onclick: () => logModal(reload), text: "＋ log session" }),
      ]));
      if (!sessions.length) { host.appendChild(el("div.empty", { text: "No stretch sessions yet." })); return; }
      sessions.forEach((s) => host.appendChild(card(s, reload)));
    }
    reload();
  }

  window.FIT_TABS = window.FIT_TABS || [];
  window.FIT_TABS.push({ key: "stretch", label: "Stretching", render });
})();
