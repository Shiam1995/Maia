/* recovery.js — Pulse: Recovery. Log meditation / breathing / forest bathing and
   other recovery practices. Types are a config list you can extend. Each session
   snapshots its type + a per-session note; loose cross-cutting thoughts still go
   in the shared Mainframe Mind Dump. Pink cards, single top-level Pulse tab. */
(function () {
  const { el, clear, toast, guard, confirmDo } = window.ui;
  const api = window.api;
  const P = window.PULSE;

  const FEELS = ["", "😌 Calm", "🙂 Refreshed", "😐 Neutral", "😴 Sleepy", "😣 Tense", "💪 Energised"];
  const open = new Set();

  function logModal(types, reload) {
    if (!types.length) return toast("add a recovery type first", true);
    const type = el("select.mform-input", {}, types.map((t) => el("option", { value: t.id, text: (t.icon || "✨") + " " + t.name })));
    const date = el("input.mform-input", { type: "date", value: P.today() });
    const dur = el("input.mform-input", { type: "number", min: "0", placeholder: "minutes" });
    const feel = el("select.mform-input", {}, FEELS.map((f) => el("option", { value: f, text: f || "— how did it feel —" })));
    const notes = el("textarea.mform-input", { placeholder: "what you did, how it felt, where…" });
    const field = (l, n) => el("div.mform-full", {}, [el("div.mform-label", { text: l }), n]);
    P.modal("Log recovery session", [
      field("Type", type),
      el("div.mform-row-3", {}, [field("Date", date), field("Minutes", dur), field("Feel", feel)]),
      field("Note", notes),
    ], [
      { label: "Log", primary: true, onClick: (close) => guard(async () => {
        await api.pulse.recovery.logSession({
          type_id: type.value, date: date.value, duration: parseInt(dur.value) || 0,
          feel: feel.value, notes: notes.value.trim(),
        });
        close(); reload();
      }) },
      { label: "Cancel", onClick: (close) => close() },
    ]);
  }

  function typesModal(types, reload) {
    const host = el("div");
    const name = el("input.mform-input", { placeholder: "e.g. Sound bath" });
    const icon = el("input.mform-input", { placeholder: "emoji", maxLength: "3", style: "width:70px;text-align:center" });
    function paint() {
      clear(host);
      types.forEach((t) => host.appendChild(el("div.spread", { style: "padding:6px 0;border-bottom:1px solid var(--border)" }, [
        el("span", { text: (t.icon || "✨") + "  " + t.name + (t.custom ? "" : "  ·  default") }),
        el("button.btn-sm.btn-danger", { onclick: () => confirmDo("Remove “" + t.name + "”? Past sessions are kept.", async () => { await api.pulse.recovery.delType(t.id); await refresh(); }), text: "×" }),
      ])));
    }
    async function refresh() { types = await api.pulse.recovery.types(); paint(); reload(); }
    paint();
    P.modal("Recovery types", [
      host,
      el("div.mform-label", { style: "margin-top:12px", text: "Add a type" }),
      el("div.row", { style: "gap:8px" }, [icon, name]),
    ], [
      { label: "Add", primary: true, onClick: () => guard(async () => {
        if (!name.value.trim()) return toast("name it", true);
        await api.pulse.recovery.addType({ name: name.value.trim(), icon: icon.value.trim() });
        name.value = ""; icon.value = ""; await refresh();
      }) },
      { label: "Done", onClick: (close) => close() },
    ]);
  }

  function statCard(stats) {
    const cell = (label, value) => el("div", { style: "text-align:center" }, [
      el("div", { style: "font-size:24px;font-weight:700;color:var(--accent)", text: String(value) }),
      el("div.sub", { text: label }),
    ]);
    const card = el("div.pulse-card", {}, [
      el("div.row", { style: "justify-content:space-around;gap:16px" }, [
        cell("sessions this week", stats.week_sessions),
        cell("minutes this week", stats.week_minutes),
        cell("day streak", stats.streak),
        cell("sessions all-time", stats.total_sessions),
      ]),
    ]);
    if (stats.by_type && stats.by_type.length) {
      card.appendChild(el("div.row", { style: "gap:6px;flex-wrap:wrap;margin-top:12px;border-top:1px solid var(--border);padding-top:10px" },
        stats.by_type.map((b) => el("span.pulse-tag", { text: (b.icon || "✨") + " " + b.type + " · " + b.count + "×" + (b.minutes ? " · " + b.minutes + "m" : "") }))));
    }
    return card;
  }

  function sessionCard(s, reload) {
    const isOpen = open.has(s.id);
    const c = el("div.pulse-card", {}, [
      el("div.spread", { style: "cursor:pointer", onclick: () => { isOpen ? open.delete(s.id) : open.add(s.id); reload(); } }, [
        el("div.row", { style: "gap:8px" }, [
          el("span", { style: "font-size:18px", text: s.type_icon || "✨" }),
          el("span", { style: "font-weight:600", text: s.type_name || "Recovery" }),
          el("span.sub", { text: P.fmtDay((s.date || "").slice(0, 10)) }),
        ]),
        el("div.row", { style: "gap:6px" }, [
          s.duration ? el("span.pulse-tag", { text: s.duration + " min" }) : null,
          s.feel ? el("span.pulse-tag", { text: s.feel }) : null,
        ]),
      ]),
    ]);
    if (isOpen) {
      const body = el("div", { style: "margin-top:10px;border-top:1px solid var(--border);padding-top:10px" });
      if (s.notes) body.appendChild(el("p.sub", { style: "line-height:1.5;margin:0 0 8px", text: s.notes }));
      else body.appendChild(el("p.sub", { style: "margin:0 0 8px;font-style:italic", text: "No note." }));
      window.Images.mount(body, { module: "pulse", contextId: s.id, surface: "pulse-recovery", title: "Images" });
      body.appendChild(el("button.btn-sm.btn-danger", { onclick: () => confirmDo("Delete this session?", async () => { await api.pulse.recovery.delSession(s.id); reload(); }), text: "× delete" }));
      c.appendChild(body);
    }
    return c;
  }

  window.Views = window.Views || {};
  window.Views.recovery = {
    id: "recovery", label: "Recovery", scoped: false,
    async render(view) {
      clear(view);
      let types = [];
      view.appendChild(el("div.view-head", {}, [
        el("div", {}, [
          el("h1", { text: "Recovery" }),
          el("div.sub", { text: "Meditation, breathing, forest bathing and more. Loose thoughts → the shared Mind Dump." }),
        ]),
        el("div.row", { style: "gap:8px" }, [
          el("button.btn-sm", { onclick: () => typesModal(types, reload), text: "⚙ types" }),
          el("button.btn-primary", { onclick: () => logModal(types, reload), text: "＋ log session" }),
        ]),
      ]));
      const statHost = el("div"); view.appendChild(statHost);
      const listHost = el("div"); view.appendChild(listHost);
      async function reload() {
        const [t, stats, sessions] = await guard(() => Promise.all([
          api.pulse.recovery.types(), api.pulse.recovery.stats(), api.pulse.recovery.sessions(),
        ]));
        types = t;
        clear(statHost); statHost.appendChild(statCard(stats));
        clear(listHost);
        listHost.appendChild(el("div.mform-label", { style: "margin:16px 0 8px", text: "Recent sessions" }));
        if (!sessions.length) { listHost.appendChild(el("div.empty", { text: "No recovery sessions yet. Log one above." })); return; }
        sessions.forEach((s) => listHost.appendChild(sessionCard(s, reload)));
      }
      reload();
    },
  };
})();
