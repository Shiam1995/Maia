/* tasks.js — the Mainframe task system (TASKS_SPEC).
   A task is a living journal. Three views (list / tree / graph), nesting,
   per-entry time that accumulates, filters, hide/park. Hand-rolled, zero libs.
   Talks to /api/tasks (Mainframe-level, not /api/synapse). */
(function () {
  const { el, clear, toast, guard, confirmDo } = window.ui;
  const api = window.api;

  const HZ = {
    long:   { c: "var(--purple)", bg: "var(--purple-d)", l: "LONG" },
    medium: { c: "var(--amber)",  bg: "var(--amber-d)",  l: "MED" },
    short:  { c: "var(--teal)",   bg: "var(--teal-d)",   l: "SHORT" },
  };
  const MOD_C = { synapse: "var(--teal)", vitality: "var(--green)", cortex: "var(--blue)", inventory: "var(--dim)" };
  // Tasks use the TASKS_SPEC module names; a work row uses the app's own
  // modules. Anything without a clear counterpart logs as Mainframe-level.
  const WORK_MOD = { synapse: "synapse", vitality: "pulse", cortex: "synapse", inventory: "mainframe" };
  const ENTRY_LABELS = { initial_idea: "Initial idea", progress: "Progress", note: "Note", blocker: "Blocker", reflection: "Reflection", completed: "Completed" };
  const ENTRY_TYPES = ["progress", "note", "blocker", "reflection", "completed"];

  let tasks = [], view = "list", filter = "all", host = null;
  const gpos = {}; // graph node positions by task id (session-only)

  /* Completed tasks are hidden by default — a finished task is clutter in a
     list of what's left. Kept in localStorage so the choice survives a reload;
     the "Done" filter chip still shows them on demand. */
  const SHOW_DONE_KEY = "mf.tasks.showDone";
  // Read through to storage rather than caching in a variable — a cached copy
  // goes stale the moment the setting changes anywhere else (another tab, the
  // console), and the list would then disagree with its own toggle.
  const showDone = () => localStorage.getItem(SHOW_DONE_KEY) === "1";
  const setShowDone = (v) => localStorage.setItem(SHOW_DONE_KEY, v ? "1" : "0");

  /* How long a task has been alive: opened_at → done_at, or → now while it's
     still open. That span is what makes a task short or long in practice,
     which is not the same thing as the horizon you filed it under. */
  const DAY = 86400000;
  const PACE = [
    { key: "sameday", max: 1,        label: "same day" },
    { key: "days",    max: 7,        label: "days" },
    { key: "weeks",   max: 31,       label: "weeks" },
    { key: "months",  max: 366,      label: "months" },
    { key: "years",   max: Infinity, label: "a year+" },
  ];

  function span(t) {
    const from = t.opened_at || t.created_at;
    if (!from) return null;
    const start = new Date(from).getTime();
    if (isNaN(start)) return null;
    const endIso = t.done ? (t.done_at || null) : null;
    // An open task is measured to now; a done one with no recorded finish can't
    // be measured at all — better to show nothing than to imply it's still running.
    if (t.done && !endIso) return null;
    const end = endIso ? new Date(endIso).getTime() : Date.now();
    if (isNaN(end)) return null;
    const ms = Math.max(0, end - start);
    const days = ms / DAY;
    return { ms, days, pace: PACE.find((p) => days < p.max), running: !t.done };
  }

  function fmtSpan(s) {
    if (!s) return "";
    const mins = Math.round(s.ms / 60000);
    if (mins < 60) return mins + "m";
    if (s.days < 1) return Math.round(mins / 60) + "h";
    if (s.days < 31) return Math.round(s.days) + "d";
    if (s.days < 366) return Math.round(s.days / 30.44) + "mo";
    return (s.days / 365.25).toFixed(1) + "y";
  }

  // ---- formatting helpers ----
  const todayStr = () => new Date().toISOString().slice(0, 10);
  function fmtMins(m) {
    m = m || 0; const h = Math.floor(m / 60), r = m % 60;
    return (h ? h + "h " : "") + r + "m";
  }
  function dateFmt(iso) { if (!iso) return ""; try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { return String(iso).slice(0, 10); } }
  function timeFmt(iso) { if (!iso || String(iso).length <= 10) return ""; try { return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } }
  const overdue = (t) => !t.done && t.due_date && t.due_date < todayStr();
  const childrenOf = (id) => tasks.filter((t) => t.parent_id === id);
  const roots = (list) => list.filter((t) => !t.parent_id || !tasks.find((x) => x.id === t.parent_id));

  // ---- data ----
  async function reload() { tasks = await guard(() => api.get("/api/tasks")); render(); }

  function passesFilter(t) {
    // "Done" is the one filter that's explicitly about completed tasks, so it
    // ignores the toggle; everywhere else the toggle decides.
    if (filter === "done") return t.done && t.status !== "hidden";
    if (t.done && !showDone()) return false;
    if (filter === "all") return t.status !== "hidden";
    if (filter === "hidden") return t.status === "hidden";
    if (filter === "active") return !t.done && t.status !== "hidden";
    if (filter === "long" || filter === "medium" || filter === "short") return t.horizon === filter && t.status !== "hidden";
    return true;
  }
  const filtered = () => tasks.filter(passesFilter);
  const inFilter = (id) => filtered().some((x) => x.id === id);

  // ---- modal helper ----
  function openModal(titleText, fields, submitLabel, onSubmit, submitClass) {
    const overlay = el("div.modal-overlay");
    const close = () => overlay.remove();
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
    const body = fields.map((f) => (f && f.node) || f); // field-obj → .node, raw node → itself
    const card = el("div.modal", {}, [
      el("div.modal-title", { text: titleText }),
      ...body,
      el("div.row", { style: "margin-top:16px;gap:8px" }, [
        el("button.tk-btn." + (submitClass || "teal"), { text: submitLabel, onclick: () => onSubmit(close) }),
        el("button.tk-btn", { text: "Cancel", onclick: close }),
      ]),
    ]);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const first = card.querySelector("input,select,textarea");
    if (first) first.focus();
  }
  // field builders → { node, get() }
  function fText(label, ph, val) {
    const input = el("input.mform-input", { placeholder: ph || "", value: val || "" });
    return { node: el("div.mform-full", {}, [el("div.mform-label", { text: label }), input]), get: () => input.value.trim(), input };
  }
  function fArea(label, ph) {
    const input = el("textarea.mform-input", { placeholder: ph || "" });
    return { node: el("div.mform-full", {}, [el("div.mform-label", { text: label }), input]), get: () => input.value.trim(), input };
  }
  function fSelect(label, options, val) {
    const input = el("select.mform-input", {}, options.map((o) => el("option", { value: o.v, text: o.t })));
    if (val) input.value = val;
    return { node: el("div", {}, [el("div.mform-label", { text: label }), input]), get: () => input.value, input };
  }
  function fDate(label, val) {
    const input = el("input.mform-input", { type: "date", value: val || "" });
    return { node: el("div", {}, [el("div.mform-label", { text: label }), input]), get: () => input.value, input };
  }
  function fTime(label, val) {
    const input = el("input.mform-input", { type: "time", value: val || "" });
    return { node: el("div", {}, [el("div.mform-label", { text: label }), input]), get: () => input.value, input };
  }
  function fNumber(label, ph) {
    const input = el("input.mform-input", { type: "number", min: "0", placeholder: ph || "" });
    return { node: el("div", {}, [el("div.mform-label", { text: label }), input]), get: () => parseInt(input.value) || 0, input };
  }
  const rowWrap = (cls, kids) => el("div." + cls, {}, kids.map((k) => k.node));

  // ---- modals: new task / entry / subtask ----
  function newTaskModal(parentId) {
    const title = fText("What needs doing?", "e.g. Implement multi-head attention");
    const hz = fSelect("Horizon", [{ v: "short", t: "Short-term" }, { v: "medium", t: "Medium-term" }, { v: "long", t: "Long-term" }]);
    const module = fSelect("Module", [{ v: "synapse", t: "Synapse" }, { v: "vitality", t: "Vitality" }, { v: "cortex", t: "Cortex" }, { v: "inventory", t: "Inventory" }]);
    const est = fText("Est. time", "e.g. 2hrs");
    const due = fDate("Due date (optional)");
    // Defaults to today, but a task written down now may have started last
    // week — this is the point the "how long has this been going" clock runs from.
    const started = fDate("Started on", todayStr());
    const parentOpts = [{ v: "", t: "— none (top level) —" }, ...tasks.filter((t) => t.horizon !== "short").map((t) => ({ v: t.id, t: t.title.slice(0, 40) + " (" + t.horizon + ")" }))];
    const parent = fSelect("Parent task (optional)", parentOpts, parentId || "");
    const notes = fArea("Initial idea / notes", "Why this task? The thinking behind it?");
    openModal("New Task", [title, rowWrap("mform-row-3", [hz, module, est]), rowWrap("mform-row", [started, due]), rowWrap("mform-row", [parent]), notes], "Create task", (close) => {
      if (!title.get()) return toast("enter a task title", true);
      guard(async () => {
        await api.post("/api/tasks", { title: title.get(), horizon: hz.get(), module: module.get(), est_time: est.get() || null, due_date: due.get() || null, parent_id: parent.get() || null, notes: notes.get() || null,
          // date only → midnight, so a same-day task reads as minutes not hours
          opened_at: started.get() ? started.get() + "T" + window.ui.nowHM() + ":00" : null });
        close(); toast("task created"); reload();
      });
    });
  }

  function addEntryModal(t) {
    const date = fDate("Date", todayStr());
    const tod = fTime("Time", new Date().toTimeString().slice(0, 5));
    const type = fSelect("Entry type", ENTRY_TYPES.map((x) => ({ v: x, t: ENTRY_LABELS[x] })));
    const mins = fNumber("Time spent (minutes)", "e.g. 45");
    const label = fText("Time spent (label)", "e.g. 45min, 1.5hrs");
    const notes = fArea("What did you do?", "Describe what you worked on...");
    const learned = fArea("What did you learn? (optional)", "Insights, surprises, connections...");
    const next = fText("What's next? (optional)", "Next step or follow-up...");
    openModal("Add entry to: " + t.title, [rowWrap("mform-row-3", [date, tod, type]), rowWrap("mform-row", [mins, label]), notes, learned, next], "Add entry", (close) => {
      if (!notes.get()) return toast("write what you did", true);
      const d = date.get(), tm = tod.get();
      const dateStr = d ? (tm ? d + "T" + tm + ":00" : d) : new Date().toISOString();
      guard(async () => {
        await api.post("/api/tasks/" + t.id + "/entries", { type: type.get(), date: dateStr, time_of_day: tm || null, time_spent_mins: mins.get(), time_spent_label: label.get() || null, notes: notes.get(), learned: learned.get() || null, next_step: next.get() || null });
        close(); toast("entry added"); reload();
      });
    }, "amber");
  }

  function addSubModal(parent) {
    const title = fText("Subtask", "e.g. Read section 3");
    const hz = fSelect("Horizon", [{ v: "short", t: "Short" }, { v: "medium", t: "Medium" }], parent.horizon === "long" ? "medium" : "short");
    const est = fText("Est. time", "e.g. 30min");
    openModal("Add subtask to: " + parent.title, [title, rowWrap("mform-row", [hz, est])], "Add subtask", (close) => {
      if (!title.get()) return toast("enter a subtask", true);
      guard(async () => {
        await api.post("/api/tasks", { title: title.get(), horizon: hz.get(), module: parent.module || "synapse", est_time: est.get() || null, parent_id: parent.id });
        close(); toast("subtask added"); reload();
      });
    });
  }

  // ---- actions ----
  const toggleDone = (t) => guard(async () => { await api.patch("/api/tasks/" + t.id, { done: !t.done }); reload(); });
  const toggleHidden = (t) => guard(async () => { await api.patch("/api/tasks/" + t.id, { hidden: t.status !== "hidden" }); reload(); });
  function deleteTask(t) {
    const kids = childrenOf(t.id).length;
    const msg = kids ? `Delete "${t.title}" and its ${kids} subtask${kids > 1 ? "s" : ""}?\n\nOK = delete subtasks too · Cancel = keep them (move to top level).` : `Delete "${t.title}" and all its entries?`;
    if (kids) {
      const cascade = window.confirm(msg);
      guard(async () => { await api.del("/api/tasks/" + t.id + "?cascade=" + cascade); toast("task deleted"); reload(); });
    } else {
      confirmDo(msg, async () => { await api.del("/api/tasks/" + t.id); toast("task deleted"); reload(); });
    }
  }

  // ---- render dispatch ----
  function render() { if (!host) return; clear(host); if (view === "list") renderList(); else if (view === "tree") renderTree(); else renderGraph(); }

  // ---- list view ----
  function taskItem(t, indent) {
    const hz = HZ[t.horizon] || HZ.short;
    const kids = childrenOf(t.id);
    const s = span(t);
    // The tint comes from how long it has actually been alive, not the horizon
    // it was filed under — a "short" task still open after a month should look
    // different from one closed the same afternoon.
    const paceCls = s ? " pace-" + s.pace.key + (s.running ? " pace-running" : "") : "";
    const item = el("div.task-item.hz-" + t.horizon + (t.status === "hidden" ? ".is-hidden" : "") + paceCls,
      indent ? { style: "margin-left:" + indent + "px" } : {});

    const check = el("button.task-check" + (t.done ? ".done" : ""), { text: t.done ? "✓" : "", onclick: (e) => { e.stopPropagation(); toggleDone(t); } });
    const meta = el("div.task-meta", {}, [
      el("span.tk-tag", { style: `background:${hz.bg};color:${hz.c}`, text: hz.l }),
      el("span.tk-tag", { style: `background:var(--raised);color:${MOD_C[t.module] || "var(--dim)"}`, text: t.module }),
      t.est_time ? el("span", { text: "Est: " + t.est_time }) : null,
      t.due_date ? el("span", { style: overdue(t) ? "color:var(--red)" : "", text: (overdue(t) ? "⚠ " : "") + t.due_date }) : null,
      s ? el("span.tk-span", {
        title: (t.done ? "took " : "open for ") + fmtSpan(s) + " — "
             + dateFmt(t.opened_at || t.created_at)
             + (t.done && t.done_at ? " → " + dateFmt(t.done_at) + " " + timeFmt(t.done_at) : " → still open"),
        text: (t.done ? "took " : "open ") + fmtSpan(s),
      }) : null,
      t.entries.length ? el("span", { text: t.entries.length + (t.entries.length === 1 ? " entry" : " entries") }) : null,
      t.total_mins ? el("span", { style: "color:var(--teal)", text: "⏱ " + fmtMins(t.total_mins) }) : null,
      kids.length ? el("span", { text: kids.length + " subtask" + (kids.length > 1 ? "s" : "") }) : null,
    ]);
    const detail = el("div.task-detail");
    const header = el("div.task-header", { onclick: () => detail.classList.toggle("open") }, [
      check,
      el("div.task-tbody", {}, [el("div.task-title" + (t.done ? ".done" : ""), { text: t.title }), meta]),
      el("div.task-actions", {}, [
        el("button.tk-btn.amber.sm", { title: "Add entry", text: "+📝", onclick: (e) => { e.stopPropagation(); addEntryModal(t); } }),
        el("button.tk-btn.teal.sm", { title: "Add subtask", text: "+⬇", onclick: (e) => { e.stopPropagation(); addSubModal(t); } }),
        el("button.tk-btn.sm", { title: t.status === "hidden" ? "Show" : "Hide", text: t.status === "hidden" ? "👁" : "🙈", onclick: (e) => { e.stopPropagation(); toggleHidden(t); } }),
        el("button.tk-btn.red.sm", { text: "×", onclick: (e) => { e.stopPropagation(); deleteTask(t); } }),
      ]),
    ]);
    buildJournal(detail, t);
    // push time on this specific task into the work database
    const wlHost = el("div", { style: "margin-top:8px" });
    detail.appendChild(el("div.row", { style: "gap:6px;margin-top:8px" }, [
      window.WorkLog.button({
        mountInto: wlHost,
        module: WORK_MOD[t.module] || "mainframe",
        ref_kind: "task", ref_id: t.id, ref_title: t.title, lockRef: true,
      }, () => reload(), "+ log time"),
    ]));
    detail.appendChild(wlHost);
    item.appendChild(header); item.appendChild(detail);
    return item;
  }

  /* Started / finished, both editable.
     Split into a date and a time input rather than one datetime-local: you
     nearly always know the day and often not the hour, and a date alone is a
     perfectly good answer. The time is optional and defaults to midnight. */
  function lifespanRow(t) {
    const split = (iso) => {
      if (!iso) return ["", ""];
      const d = new Date(iso);
      if (isNaN(d)) return [String(iso).slice(0, 10), ""];
      return [window.ui.todayISO(d), window.ui.nowHM(d)];
    };
    const [od, ot] = split(t.opened_at || t.created_at);
    const [dd, dt] = split(t.done_at);

    const mk = (type, val) => el("input.mform-input", { type, value: val, style: "width:auto" });
    const openD = mk("date", od), openT = mk("time", ot);
    const doneD = mk("date", dd), doneT = mk("time", dt);

    const readOut = el("span.mono", { style: "font-size:11px;color:var(--dim)" });
    const iso = (d, tm) => (d ? d + "T" + (tm || "00:00") + ":00" : null);
    const preview = () => {
      const a = iso(openD.value, openT.value), b = iso(doneD.value, doneT.value);
      if (!a) { readOut.textContent = ""; return; }
      const s = span({ opened_at: a, done_at: b, done: !!b });
      readOut.textContent = s ? (b ? "took " : "open ") + fmtSpan(s) : "";
    };
    [openD, openT, doneD, doneT].forEach((i) => i.addEventListener("change", preview));
    preview();

    const save = el("button.tk-btn.teal.sm", { text: "save dates", onclick: () => guard(async () => {
      if (!openD.value) return toast("a start date is needed to measure anything", true);
      const done_at = iso(doneD.value, doneT.value);
      await api.patch("/api/tasks/" + t.id, {
        opened_at: iso(openD.value, openT.value),
        done_at,
        // Recording a finish time IS completing it — otherwise a task could
        // claim it ended while still sitting in the active list.
        ...(done_at && !t.done ? { done: true, done_at } : {}),
        ...(!done_at && t.done ? { done: false } : {}),
      });
      toast("dates saved");
      reload();
    }) });

    // One press closes it off: date and time together, since a finish time
    // without its date is meaningless. (Each field also has its own today/now
    // button from ui.js, for filling one in on its own.)
    const finishNow = el("button.now-btn.now-btn-go", { type: "button",
      title: "stamp the finish as right now", text: "■ finish now" });
    finishNow.addEventListener("click", (e) => {
      e.preventDefault();
      window.ui.stampNow(doneD); window.ui.stampNow(doneT);
      preview();
    });

    const fld = (label, node) => el("label.wl-field", { style: "flex:0 0 auto" },
      [el("span.wl-label", { text: label }), node]);
    return el("div.task-life", {}, [
      el("div.row", { style: "gap:8px;flex-wrap:wrap;align-items:flex-end" }, [
        fld("started", openD), fld("at", openT),
        el("span.tk-life-sep", { text: "→" }),
        fld("finished", doneD), fld("at", doneT),
        finishNow, save, readOut,
      ]),
    ]);
  }

  function buildJournal(detail, t) {
    detail.appendChild(lifespanRow(t));
    if (t.total_mins > 0) {
      detail.appendChild(el("div.total-time-bar", {}, [
        el("span.mono", { style: "font-size:10px;color:var(--dim);letter-spacing:1px", text: "TOTAL TIME:" }),
        el("span.mono", { style: "font-size:14px;font-weight:600;color:var(--teal)", text: fmtMins(t.total_mins) }),
        el("span.mono", { style: "font-size:11px;color:var(--dim)", text: `(${t.total_mins} mins across ${t.entries.filter((e) => e.time_spent_mins > 0).length} sessions)` }),
        t.est_time ? el("span.mono", { style: "font-size:11px;color:var(--amber);margin-left:auto", text: "Est: " + t.est_time }) : null,
      ]));
    }
    t.entries.forEach((e) => detail.appendChild(entryItem(e)));
    // screenshots / diagrams / whiteboard photos attached to this task
    window.Images.mount(detail, { module: "tasks", contextId: t.id, surface: "tasks", title: "Images" });
    detail.appendChild(el("div.row", { style: "gap:6px;margin-top:4px" }, [
      el("button.tk-btn.amber.sm", { text: "+ Add entry", onclick: () => addEntryModal(t) }),
      el("button.tk-btn.teal.sm", { text: "+ Add subtask", onclick: () => addSubModal(t) }),
    ]));
  }

  // images attached to one journal entry (spec calls these out: screenshots,
  // diagrams, whiteboard photos)
  function entryImages(e) {
    const host = el("div");
    window.Images.mount(host, { module: "tasks", contextId: e.id, surface: "task-entry", title: "Images" });
    return host;
  }

  function entryItem(e) {
    const when = dateFmt(e.date) + (timeFmt(e.date) ? " " + timeFmt(e.date) : "");
    return el("div.entry-item.type-" + e.type, {}, [
      el("div.entry-date", {}, [el("span", { text: when }), el("span.tk-tag", { style: "background:var(--raised);color:var(--dim)", text: ENTRY_LABELS[e.type] || e.type })]),
      el("div.entry-text", { text: e.notes }),
      e.learned ? el("div.entry-learned", {}, [el("span.entry-kv", { text: "LEARNED: " }), document.createTextNode(e.learned)]) : null,
      entryImages(e),
      e.next_step ? el("div.entry-next", {}, [el("span.entry-kv", { text: "NEXT: " }), document.createTextNode(e.next_step)]) : null,
      (e.time_spent_mins || e.time_spent_label) ? el("div.entry-time", { text: "⏱ " + (e.time_spent_mins ? e.time_spent_mins + " mins" : "") + (e.time_spent_mins && e.time_spent_label ? " · " : "") + (e.time_spent_label || "") }) : null,
    ]);
  }

  function renderList() {
    const list = filtered();
    if (!list.length) { host.appendChild(el("div.empty", { text: 'No tasks yet. Click "+ New task" to start.' })); return; }
    roots(list).forEach((t) => {
      host.appendChild(taskItem(t, 0));
      childrenOf(t.id).filter((c) => inFilter(c.id)).forEach((c) => {
        host.appendChild(taskItem(c, 32));
        childrenOf(c.id).filter((g) => inFilter(g.id)).forEach((g) => host.appendChild(taskItem(g, 64)));
      });
    });
  }

  // ---- tree view ----
  function treeChildren(parentId) {
    const kids = childrenOf(parentId).filter((c) => inFilter(c.id));
    if (!kids.length) return null;
    return el("div.tree-node", {}, kids.map((c) => {
      const hz = HZ[c.horizon] || HZ.short;
      return el("div", {}, [
        el("div.tree-row", {}, [
          el("button.task-check" + (c.done ? ".done" : ""), { style: "width:16px;height:16px;min-width:16px;font-size:9px", text: c.done ? "✓" : "", onclick: () => toggleDone(c) }),
          el("span.tk-tag", { style: `background:${hz.bg};color:${hz.c};font-size:9px`, text: hz.l }),
          el("span", { style: c.done ? "font-size:13px;text-decoration:line-through;color:var(--dim)" : "font-size:13px", text: c.title }),
          c.entries.length ? el("span", { style: "font-size:10px;color:var(--dim)", text: c.entries.length + " entries" }) : null,
        ]),
        treeChildren(c.id),
      ]);
    }));
  }
  function renderTree() {
    const list = filtered();
    if (!roots(list).length) { host.appendChild(el("div.empty", { text: "No tasks to display in tree." })); return; }
    roots(list).forEach((t) => {
      const hz = HZ[t.horizon] || HZ.short;
      host.appendChild(el("div.card", { style: `border-left:3px solid ${hz.c};margin-bottom:12px` }, [
        el("div.tree-row", {}, [
          el("button.task-check" + (t.done ? ".done" : ""), { style: "width:18px;height:18px;min-width:18px;font-size:10px", text: t.done ? "✓" : "", onclick: () => toggleDone(t) }),
          el("span.tk-tag", { style: `background:${hz.bg};color:${hz.c}`, text: hz.l }),
          el("span", { style: t.done ? "font-size:14px;font-weight:500;text-decoration:line-through;color:var(--dim)" : "font-size:14px;font-weight:500", text: t.title }),
        ]),
        treeChildren(t.id),
      ]));
    });
  }

  // ---- graph view ----
  let drag = null, dragOff = { x: 0, y: 0 };
  function renderGraph() {
    const list = filtered();
    if (!list.length) { host.appendChild(el("div.empty", { text: "No tasks to display." })); return; }
    const canvas = el("div.graph-canvas", { id: "tk-graph" });
    list.forEach((t, i) => {
      const hz = HZ[t.horizon] || HZ.short;
      if (!gpos[t.id]) gpos[t.id] = { x: 60 + (i % 5) * 180, y: 40 + Math.floor(i / 5) * 74 };
      const p = gpos[t.id];
      const node = el("div.graph-node", { style: `left:${p.x}px;top:${p.y}px;background:${hz.bg};border-color:${hz.c};color:${hz.c}`, text: t.title.slice(0, 26) });
      node.addEventListener("mousedown", (e) => { drag = t.id; const r = node.getBoundingClientRect(); dragOff.x = e.clientX - r.left; dragOff.y = e.clientY - r.top; e.preventDefault(); });
      canvas.appendChild(node);
    });
    // edges
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("style", "position:absolute;top:0;left:0;width:100%;height:100%;z-index:0");
    list.forEach((t) => {
      if (t.parent_id && gpos[t.parent_id] && gpos[t.id]) {
        const a = gpos[t.parent_id], b = gpos[t.id];
        const ln = document.createElementNS(svgNS, "line");
        ln.setAttribute("x1", a.x + 50); ln.setAttribute("y1", a.y + 14); ln.setAttribute("x2", b.x + 50); ln.setAttribute("y2", b.y + 14);
        ln.setAttribute("stroke", "rgba(255,255,255,.1)"); ln.setAttribute("stroke-width", "1");
        svg.appendChild(ln);
      }
    });
    canvas.appendChild(svg);
    host.appendChild(el("div.sub", { style: "margin-bottom:8px", text: "Drag nodes to arrange. Lines connect parent → child." }));
    host.appendChild(canvas);
  }
  document.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const c = document.getElementById("tk-graph"); if (!c) return;
    const cr = c.getBoundingClientRect();
    gpos[drag] = { x: Math.max(0, e.clientX - cr.left - dragOff.x), y: Math.max(0, e.clientY - cr.top - dragOff.y) };
    if (view === "graph") render();
  });
  document.addEventListener("mouseup", () => { drag = null; });

  // ---- view registration ----
  window.Views = window.Views || {};
  window.Views.tasks = {
    id: "tasks", label: "Tasks", scoped: false,
    async render(viewEl, PM) {
      clear(viewEl);
      viewEl.appendChild(el("div.view-head", {}, [
        el("div", {}, [el("h1", { text: "Tasks" }), el("div.sub", { text: "Long-term arcs, medium projects, short actions. Nest them. Journal them." })]),
        el("button.btn-primary", { text: "+ New task", onclick: () => newTaskModal() }),
      ]));
      // view toggle + filters
      const viewBtns = {};
      const toggle = el("div.view-toggle", {}, ["list", "tree", "graph"].map((v) => {
        const b = el("button.view-btn" + (v === view ? ".active" : ""), { text: v[0].toUpperCase() + v.slice(1), onclick: () => { view = v; Object.values(viewBtns).forEach((x) => x.classList.remove("active")); b.classList.add("active"); render(); } });
        viewBtns[v] = b; return b;
      }));
      const chips = {};
      // Completed tasks are off by default and the choice is remembered. It's a
      // toggle rather than another chip because it cuts across all of them —
      // "Short" should mean short and unfinished unless you say otherwise.
      const doneToggle = el("button.filter-chip.done-toggle");
      const paintToggle = () => {
        const on = showDone();
        doneToggle.classList.toggle("active", on);
        doneToggle.textContent = on ? "✓ completed shown" : "completed hidden";
        doneToggle.title = on ? "hide completed tasks" : "show completed tasks too";
      };
      doneToggle.addEventListener("click", () => { setShowDone(!showDone()); paintToggle(); render(); });
      paintToggle();
      const fbar = el("div.filter-bar", {}, [el("span.mono", { style: "font-size:10px;color:var(--dim);letter-spacing:1px", text: "SHOW:" }),
        ...["all", "long", "medium", "short", "active", "done", "hidden"].map((f) => {
          const c = el("button.filter-chip" + (f === filter ? ".active" : ""), { text: f[0].toUpperCase() + f.slice(1), onclick: () => { filter = f; Object.values(chips).forEach((x) => x.classList.remove("active")); c.classList.add("active"); render(); } });
          chips[f] = c; return c;
        }),
        doneToggle]);
      viewEl.appendChild(el("div.tasks-bar", {}, [toggle, fbar]));
      host = el("div"); viewEl.appendChild(host);
      await reload();
    },
  };
})();
