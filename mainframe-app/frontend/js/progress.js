/* progress.js — work overview & reflection (TASKS_SPEC "Progress tab").
   Stats row + an editable ACTIVE section (set priority, add notes on in-flight
   work) + the COMPLETED history. Priority saves via PATCH, notes via POST entry;
   both re-draw in place. Reads /api/tasks. */
(function () {
  const { el, clear, guard, toast } = window.ui;
  const api = window.api;

  const ENTRY_LABELS = { initial_idea: "Initial idea", progress: "Progress", note: "Note", blocker: "Blocker", reflection: "Reflection", completed: "Completed" };
  const NOTE_TYPES = ["note", "reflection", "progress", "blocker"];
  const PRIORITIES = ["low", "medium", "high"];

  function fmtMins(m) { m = m || 0; const h = Math.floor(m / 60), r = m % 60; return (h ? h + "h " : "") + r + "m"; }
  function dateFmt(iso) { if (!iso) return ""; try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { return String(iso).slice(0, 10); } }
  function isOverdue(t) { if (!t.due_date || t.done) return false; try { return new Date(t.due_date) < new Date(new Date().toDateString()); } catch { return false; } }

  // Which task cards are expanded — kept across re-draws so a note-add doesn't collapse the card.
  const open = new Set();

  function statBox(val, label, color) {
    return el("div.prog-box", {}, [el("div.prog-val", { style: "color:" + color, text: String(val) }), el("div.prog-label", { text: label })]);
  }

  function stop(e) { e.stopPropagation(); }

  // Editable priority dropdown — colored by level, saves instantly.
  function prioritySelect(t, reload) {
    const cur = t.priority || "medium";
    const sel = el("select", { class: "prio-sel prio-" + cur, onclick: stop }, PRIORITIES.map((p) => {
      const o = el("option", { value: p, text: p });
      if (p === cur) o.setAttribute("selected", "");
      return o;
    }));
    sel.addEventListener("change", async () => {
      sel.className = "prio-sel prio-" + sel.value;
      await guard(() => api.patch("/api/tasks/" + t.id, { priority: sel.value }));
      toast("priority → " + sel.value);
      t.priority = sel.value;
    });
    return sel;
  }

  // Inline "+ note" adder — appends a note/reflection entry to the task.
  function noteAdder(t, reload) {
    const wrap = el("span.prog-note");
    const btn = el("button.btn-sm", { text: "+ note", onclick: (e) => { stop(e); toggle(); } });
    wrap.appendChild(btn);
    let form = null;
    function toggle() {
      if (form) { form.remove(); form = null; btn.textContent = "+ note"; return; }
      btn.textContent = "× close";
      const type = el("select.mform-input", { style: "max-width:150px", onclick: stop }, NOTE_TYPES.map((x) => el("option", { value: x, text: ENTRY_LABELS[x] })));
      const ta = el("textarea.mform-input", { placeholder: "What happened / a thought…", rows: "2", onclick: stop });
      const save = el("button.btn-primary.btn-sm", { text: "save note", onclick: async (e) => {
        stop(e);
        if (!ta.value.trim()) return toast("write a note first", true);
        await guard(() => api.post("/api/tasks/" + t.id + "/entries", { type: type.value, notes: ta.value.trim(), time_spent_mins: 0 }));
        toast("note added");
        open.add(t.id);
        reload();
      } });
      form = el("div.prog-note-form", { onclick: stop }, [type, ta, el("div.row", { style: "gap:8px" }, [save])]);
      wrap.appendChild(form);
      ta.focus();
    }
    return wrap;
  }

  function entryItem(e) {
    return el("div.entry-item.type-" + e.type, { style: "margin-bottom:6px" }, [
      el("div.entry-date", {}, [el("span", { text: dateFmt(e.date) }), el("span.tk-tag", { style: "background:var(--raised);color:var(--dim)", text: ENTRY_LABELS[e.type] || e.type })]),
      el("div.entry-text", { text: e.notes }),
      e.learned ? el("div.entry-learned", {}, [el("span.entry-kv", { text: "LEARNED: " }), document.createTextNode(e.learned)]) : null,
      e.next_step ? el("div.entry-next", {}, [el("span.entry-kv", { text: "NEXT: " }), document.createTextNode(e.next_step)]) : null,
      (e.time_spent_mins || e.time_spent_label) ? el("div.entry-time", { text: "⏱ " + (e.time_spent_mins ? e.time_spent_mins + " mins" : "") + (e.time_spent_label ? " · " + e.time_spent_label : "") }) : null,
    ]);
  }

  // One editable task card (expandable). `completed` toggles the done styling.
  function taskCard(t, completed, reload) {
    const isOpen = open.has(t.id);
    const overdue = isOverdue(t);
    const titleStyle = "font-size:14px;font-weight:500;" + (completed ? "color:var(--dim);text-decoration:line-through" : "color:var(--text)");

    const header = el("div.prog-row", { onclick: () => { if (isOpen) open.delete(t.id); else open.add(t.id); reload(); } }, [
      el("span.prog-caret", { text: isOpen ? "▾" : "▸" }),
      el("span", { style: titleStyle, text: t.title }),
      el("div.prog-row-meta", {}, [
        el("span.tk-tag", { style: "background:var(--raised);color:var(--dim)", text: t.horizon }),
        el("span.tk-tag", { style: "background:var(--blue-d);color:var(--blue)", text: t.module }),
        t.entries.length ? el("span.sub", { text: t.entries.length + (t.entries.length === 1 ? " entry" : " entries") }) : null,
        t.total_mins ? el("span.sub", { style: "color:var(--teal)", text: "⏱ " + fmtMins(t.total_mins) }) : null,
        completed && t.done_at ? el("span.tk-tag", { style: "background:var(--green-d);color:var(--green)", text: "Done " + dateFmt(t.done_at) }) : null,
        overdue ? el("span.tk-tag", { style: "background:var(--red-d);color:var(--red)", text: "overdue" }) : null,
      ]),
      el("div.prog-row-edit", {}, [
        el("span.prog-prio-wrap", {}, [el("span.sub", { text: "priority" }), prioritySelect(t, reload)]),
        noteAdder(t, reload),
      ]),
    ]);

    const card = el("div.prog-card" + (completed ? "" : ".active"), {}, [header]);
    if (isOpen) {
      if (t.entries.length) t.entries.forEach((e) => card.appendChild(entryItem(e)));
      else card.appendChild(el("div.empty", { style: "padding:10px 0", text: "No journal entries yet — add a note above." }));
    }
    return card;
  }

  function sectionHead(text) {
    return el("div", { class: "mono", style: "font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--dim);margin:24px 0 14px;padding-bottom:10px;border-bottom:1px solid var(--border)", text });
  }

  async function draw(viewEl) {
    clear(viewEl);
    viewEl.appendChild(el("div.view-head", {}, [el("div", {}, [
      el("h1", { text: "Progress" }), el("div.sub", { text: "Edit priorities, add notes, and review completed work." })])]));

    const tasks = await guard(() => api.get("/api/tasks"));
    const reload = () => draw(viewEl);
    const done = tasks.filter((t) => t.done);
    const active = tasks.filter((t) => !t.done && t.status !== "hidden");
    const totalEntries = tasks.reduce((a, t) => a + t.entries.length, 0);
    const totalMins = tasks.reduce((a, t) => a + (t.total_mins || 0), 0);
    const longArcs = tasks.filter((t) => t.horizon === "long").length;

    viewEl.appendChild(el("div.prog-grid", {}, [
      statBox(done.length, "Completed", "var(--teal)"),
      statBox(active.length, "Active", "var(--amber)"),
      statBox(totalEntries, "Journal entries", "var(--purple)"),
      statBox(fmtMins(totalMins), "Total time logged", "var(--teal)"),
      statBox(longArcs, "Long arcs", "var(--blue)"),
    ]));

    // Priority order high → medium → low so the most important work sits on top.
    const rank = { high: 0, medium: 1, low: 2 };
    const byPriority = (a, b) => (rank[a.priority || "medium"] - rank[b.priority || "medium"]);

    viewEl.appendChild(sectionHead("Active tasks — editable"));
    if (!active.length) viewEl.appendChild(el("div.empty", { text: "No active tasks. Create one from the Tasks tab." }));
    else active.slice().sort(byPriority).forEach((t) => viewEl.appendChild(taskCard(t, false, reload)));

    viewEl.appendChild(sectionHead("Completed tasks"));
    if (!done.length) viewEl.appendChild(el("div.empty", { text: "No completed tasks yet. They'll appear here with their full entry history." }));
    else done.slice().sort(byPriority).forEach((t) => viewEl.appendChild(taskCard(t, true, reload)));
  }

  window.Views = window.Views || {};
  window.Views.progress = {
    id: "progress", label: "Progress", scoped: false,
    async render(viewEl) { await draw(viewEl); },
  };
})();
