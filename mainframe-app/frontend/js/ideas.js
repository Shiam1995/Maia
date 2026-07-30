/* ideas.js — spreadsheet-like idea table, hand-rolled (zero external JS libs).
   Inline-edit cells (blur/Enter saves), add rows, sort by column, filter by
   category/priority/status, add custom columns, export CSV/JSON. Rows expand
   into a roomy detail panel and can be dragged up/down into a manual order
   (the default order when no column sort is active). Custom columns persist as
   flexible properties on the :Idea node. */
(function () {
  const { el, clear, toast, guard, confirmDo } = window.ui;
  const api = window.api;

  const BASE_COLS = ["title", "description", "category", "priority", "status", "paper_id", "notes"];
  const HIDDEN = new Set(["id", "created_at", "position"]);
  // "category" is the KIND of idea. The kinds and their colours are managed by
  // IdeaKinds (server-backed, user-extensible) rather than hard-coded here.
  const PRIOS = ["low", "medium", "high"];
  const STATUSES = ["raw", "exploring", "in-progress", "done", "parked"];
  const BIG_COLS = ["description", "notes"];  // get textareas in the detail panel

  let rows = [], cols = [], sortBy = null, sortDir = 1;
  let filter = { category: "", priority: "", status: "" };
  const openRows = new Set();  // expanded row ids, kept across re-renders
  let editors = {};            // id → col → [inputs], so the cell and the
                               // detail panel stay in step while editing

  function visibleCols() {
    const set = [];
    BASE_COLS.forEach((c) => set.push(c));
    cols.forEach((c) => { if (!HIDDEN.has(c) && !set.includes(c)) set.push(c); });
    return set;
  }

  function register(rowId, col, input) {
    editors[rowId] = editors[rowId] || {};
    (editors[rowId][col] = editors[rowId][col] || []).push(input);
  }

  function syncEditors(rowId, col, val, except) {
    ((editors[rowId] || {})[col] || []).forEach((i) => { if (i !== except) i.value = val; });
  }

  function cellEditor(row, col, papers, opts) {
    const o = opts || {};
    const val = row[col] == null ? "" : String(row[col]);
    const cls = o.cls === undefined ? "cellinput" : o.cls;
    let input;
    // the kind picker tints itself (and its options) with each kind's colour
    if (col === "category") input = window.IdeaKinds.select(val, null, cls);
    else if (col === "priority") input = selectEl(PRIOS, val, false, cls);
    else if (col === "status") input = selectEl(STATUSES, val, false, cls);
    else if (col === "paper_id") {
      input = el("select", { class: cls }, [ el("option", { value: "", text: "—" }),
        ...papers.map((p) => el("option", { value: p.id, text: p.title.slice(0, 26) })) ]);
      input.value = val;
    } else if (o.big) {
      input = el("textarea", { class: cls, rows: "4", style: "width:100%" });
      input.value = val;
    } else {
      input = el("input", { class: cls, value: val });
    }
    const save = () => guard(async () => {
      const nv = input.value;
      if (String(row[col] == null ? "" : row[col]) === nv) return;
      await api.patch("/api/synapse/ideas/" + row.id, { [col]: nv });
      row[col] = nv;
      syncEditors(row.id, col, nv, input);
    });
    input.addEventListener("blur", save);
    if (input.tagName === "SELECT") input.addEventListener("change", save);
    else input.addEventListener("keydown", (e) => { if (e.key === "Enter" && input.tagName !== "TEXTAREA") input.blur(); });
    register(row.id, col, input);
    return input;
  }

  function selectEl(options, val, allowCustom, cls) {
    const opts = options.slice();
    if (allowCustom && val && !opts.includes(val)) opts.push(val);
    const s = el("select", { class: cls }, opts.map((o) => el("option", { value: o, text: o })));
    s.value = val || options[0];
    return s;
  }

  async function reload(papers) {
    const [data, colInfo] = await guard(() => Promise.all([ api.get("/api/synapse/ideas"), api.get("/api/synapse/ideas/columns") ]));
    rows = data; cols = colInfo.columns;
    render(papers);
  }

  function applyFilterSort() {
    let r = rows.filter((row) =>
      (!filter.category || row.category === filter.category) &&
      (!filter.priority || row.priority === filter.priority) &&
      (!filter.status || row.status === filter.status));
    if (sortBy) r = r.slice().sort((a, b) => (String(a[sortBy]||"") > String(b[sortBy]||"") ? 1 : -1) * sortDir);
    return r;
  }

  /* Swap a row with its neighbour in the manual order. Only meaningful when no
     column sort is active — a sorted view has no manual "next row". */
  function move(row, dir) {
    if (sortBy) return toast("clear the column sort to reorder rows", true);
    const view = applyFilterSort();
    const vj = view.indexOf(row) + dir;
    if (vj < 0 || vj >= view.length) return;
    const other = view[vj];
    const a = rows.indexOf(row), b = rows.indexOf(other);
    rows[a] = other; rows[b] = row;
    const ids = dir < 0 ? [row.id, other.id] : [other.id, row.id];
    render(papersRef);
    guard(() => api.post("/api/synapse/ideas/reorder", { ids }));
  }

  const fmtMins = (m) => (window.WorkLog ? window.WorkLog.fmtMins(m) : String(m || 0) + "m");

  /* Time spent on this idea — the totals, every instance logged, and the form
     that pushes a new one into the work database. */
  function timeSection(row, reload) {
    const sessions = row.sessions || [];
    const wrap = el("div.idea-time");

    const stat = (v, l, c) => el("div.prog-box", {}, [
      el("div.prog-val", { style: "color:" + c + ";font-size:19px", text: v }),
      el("div.prog-label", { text: l }),
    ]);
    const active = sessions.filter((s) => s.focus === "active").reduce((n, s) => n + (s.mins || 0), 0);
    const passive = sessions.filter((s) => s.focus === "passive").reduce((n, s) => n + (s.mins || 0), 0);
    const dist = sessions.reduce((n, s) => n + (s.distraction_mins || 0), 0);
    wrap.appendChild(el("div.prog-grid", { style: "margin-bottom:10px" }, [
      stat(fmtMins(row.total_mins || 0), "time spent", "#2de2ff"),
      stat(String(sessions.length), "instances", "#7FA8C8"),
      stat(String(new Set(sessions.map((s) => s.date)).size), "days", "#7FA8C8"),
      stat(fmtMins(active), "active", "#00F5D4"),
      stat(fmtMins(passive), "passive", "#D4A017"),
      stat(fmtMins(dist), "distracted", "#FF4757"),
    ]));

    const addHost = el("div");
    wrap.appendChild(el("div.row", { style: "gap:6px" }, [
      window.WorkLog.button(
        { mountInto: addHost, module: "synapse", ref_kind: "idea", ref_id: row.id,
          ref_title: row.title || "(untitled idea)", lockRef: true },
        reload, "+ log time",
      ),
      row.last_worked ? el("span.sub", { text: "last worked " + row.last_worked }) : el("span.sub", { text: "no time logged yet" }),
    ]));
    wrap.appendChild(addHost);

    if (sessions.length) {
      const list = el("div", { style: "margin-top:8px" });
      sessions.forEach((s) => list.appendChild(el("div.proj-sess", {}, [
        el("span.mono", { style: "font-size:11px", text: s.date + (s.start ? " " + s.start + (s.end ? "–" + s.end : "") : "") }),
        el("span.pill", { text: fmtMins(s.mins) }),
        el("span", { text: (s.pushed ? "★ " : "") + (s.what || s.notes || "—") }),
        el("span.sub", { style: "font-size:10px", text: s.focus && s.focus !== "none" ? s.focus : "" }),
        el("button.btn-sm.btn-danger", {
          onclick: () => guard(async () => { await api.del("/api/work/" + s.id); reload(); }), text: "×",
        }),
      ])));
      wrap.appendChild(list);
    }
    return wrap;
  }

  function detailPanel(row, papers, span) {
    const vcols = visibleCols();
    const body = el("div.idea-detail", {}, [
      el("div.spread", { style: "margin-bottom:8px" }, [
        el("div.row", { style: "gap:8px" }, [
          window.IdeaKinds.chip(row.category),
          el("span.pill", { text: "⏱ " + fmtMins(row.total_mins || 0) }),
          el("span.pill", { text: (row.session_count || 0) + " instances" }),
        ]),
        el("span.sub", { text: "created " + String(row.created_at || "").slice(0, 10) }),
      ]),
      el("label.md-field", {}, [ el("span.sub", { text: "title" }),
        cellEditor(row, "title", papers, { cls: "" }) ]),
    ]);
    BIG_COLS.forEach((c) => {
      if (!vcols.includes(c)) return;
      body.appendChild(el("label.md-field", {}, [ el("span.sub", { text: c }),
        cellEditor(row, c, papers, { cls: "", big: true }) ]));
    });
    const rest = vcols.filter((c) => c !== "title" && !BIG_COLS.includes(c));
    if (rest.length) {
      body.appendChild(el("div.md-grid", {}, rest.map((c) =>
        el("label.md-field", {}, [ el("span.sub", { text: c }), cellEditor(row, c, papers, { cls: "" }) ]))));
    }
    window.Images.mount(body, { module: "synapse", contextId: row.id, surface: "synapse-idea", title: "Images" });
    // time worked on this idea — instances, totals, and the push-to-database form
    body.appendChild(el("h4.idea-sec", { text: "Time" }));
    body.appendChild(timeSection(row, () => reload(papersRef)));
    const tr = el("tr", {}, [el("td", { colspan: String(span), style: "padding:0" }, [body])]);
    return tr;
  }

  let gridHost, papersRef;
  function render(papers) {
    papersRef = papers;
    editors = {};
    clear(gridHost);
    const view = applyFilterSort();
    const vcols = visibleCols();
    const span = vcols.length + 3;   // ≡ handle + columns + time + actions
    const table = el("table");
    const head = el("tr");
    head.appendChild(el("th", { style: "width:1%", title: sortBy ? "sorted — clear the sort to reorder" : "manual order", text: "≡" }));
    vcols.forEach((c) => {
      // click cycles: ascending → descending → back to the manual order
      const th = el("th", { style: "cursor:pointer", onclick: () => {
          if (sortBy !== c) { sortBy = c; sortDir = 1; }
          else if (sortDir === 1) sortDir = -1;
          else sortBy = null;
          render(papers);
        },
        text: c + (sortBy === c ? (sortDir > 0 ? " ▲" : " ▼") : "") });
      head.appendChild(th);
    });
    head.appendChild(el("th", { title: "time logged against this idea", text: "time" }));
    head.appendChild(el("th", { text: "" }));
    table.appendChild(head);
    view.forEach((row, i) => {
      const tr = el("tr");
      // the kind's colour marks the whole row, so the sheet reads by colour
      tr.style.borderLeft = "3px solid " + (row.category ? window.IdeaKinds.colorOf(row.category) : "transparent");
      const isOpen = openRows.has(row.id);

      // order / expand controls
      const up = el("button.ord-btn", { title: "move up", text: "▲", onclick: () => move(row, -1) });
      const down = el("button.ord-btn", { title: "move down", text: "▼", onclick: () => move(row, 1) });
      if (sortBy || i === 0) up.disabled = true;
      if (sortBy || i === view.length - 1) down.disabled = true;
      const caret = el("button.ord-btn", { title: isOpen ? "collapse" : "expand", text: isOpen ? "▾" : "▸",
        onclick: () => { isOpen ? openRows.delete(row.id) : openRows.add(row.id); render(papers); } });
      tr.appendChild(el("td", { style: "padding:2px 4px;white-space:nowrap" },
        [el("div.row", { style: "gap:3px;flex-wrap:nowrap" }, [caret, el("div.ord-col", {}, [up, down])])]));

      vcols.forEach((c) => { const td = el("td"); td.appendChild(cellEditor(row, c, papers)); tr.appendChild(td); });
      // time spent, readable without expanding the row
      tr.appendChild(el("td", { style: "white-space:nowrap" }, [
        row.total_mins
          ? el("span.pill", { title: (row.session_count || 0) + " instances · last " + (row.last_worked || "—"),
              text: "⏱ " + fmtMins(row.total_mins) })
          : el("span.sub", { style: "font-size:10px", text: "—" }),
      ]));
      const act = el("td", { style: "white-space:nowrap" });
      act.appendChild(el("button.btn-sm", { title: "Promote to task", onclick: () => guard(async () => {
        if (!row.title) return toast("give the idea a title first", true);
        await api.post("/api/tasks", { title: row.title, horizon: "short", module: "synapse", notes: row.description || "Promoted from ideas sheet" });
        await api.del("/api/synapse/ideas/" + row.id);
        openRows.delete(row.id);
        toast("promoted to task"); reload(papers);
      }), text: "↑" }));
      act.appendChild(el("button.btn-sm.btn-danger", { onclick: () => confirmDo("Delete this idea?", async () => { await api.del("/api/synapse/ideas/" + row.id); openRows.delete(row.id); reload(papers); }), text: "×" }));
      tr.appendChild(act); table.appendChild(tr);
      if (isOpen) table.appendChild(detailPanel(row, papers, span));
    });
    gridHost.appendChild(el("div.grid", {}, [table]));
    if (!view.length) gridHost.appendChild(el("div.sub", { style: "margin-top:8px", text: "No matching ideas." }));
  }

  window.Views = window.Views || {};
  window.Views.ideas = {
    id: "ideas", label: "Ideas", scoped: false,
    async render(view, PM) {
      clear(view);
      view.appendChild(el("div.view-head", {}, [
        el("div", {}, [ el("h1", { text: "Ideas" }), el("div.sub", { text: "Spreadsheet — ▸ expands a row, ▲▼ reorders, inline edit, sort, filter, custom columns." }) ]),
        el("div.row", {}, [
          el("button.btn-sm", { onclick: () => window.open("/api/synapse/ideas/export?format=csv", "_blank"), text: "⤓ CSV" }),
          el("button.btn-sm", { onclick: () => window.open("/api/synapse/ideas/export?format=json", "_blank"), text: "⤓ JSON" }),
        ]),
      ]));
      // kinds have to be loaded before anything draws a colour
      await window.IdeaKinds.load(true);

      // toolbar: add row, add column, kinds, filters
      const fCat = selectFilter("category", window.IdeaKinds.names());
      const fPri = selectFilter("priority", PRIOS); const fSt = selectFilter("status", STATUSES);
      const kindsHost = el("div");
      let kindsOpen = false;
      const kindsBtn = el("button.btn-sm", {
        onclick: () => {
          kindsOpen = !kindsOpen;
          clear(kindsHost);
          kindsBtn.textContent = (kindsOpen ? "▾" : "▸") + " kinds";
          // recolour the sheet whenever a kind is added/recoloured/removed
          if (kindsOpen) kindsHost.appendChild(window.IdeaKinds.manager(() => render(papersRef)));
        },
        text: "▸ kinds",
      });
      view.appendChild(el("div.row", { style: "margin-bottom:14px" }, [
        el("button.btn-primary", { onclick: () => guard(async () => { await api.post("/api/synapse/ideas", { title: "New idea" }); reload(PM.papers); }), text: "+ row" }),
        el("button.btn-sm", { onclick: () => addColumn(PM.papers), text: "+ column" }),
        kindsBtn,
        el("button.btn-sm", { onclick: () => { sortBy = null; render(papersRef); }, title: "back to the manual ▲▼ order", text: "≡ manual order" }),
        el("span.sub", { text: "filter:" }), fCat, fPri, fSt,
      ]));
      view.appendChild(kindsHost);
      gridHost = el("div"); view.appendChild(gridHost);
      await reload(PM.papers);
    },
  };

  function selectFilter(key, options) {
    const s = el("select", {}, [ el("option", { value: "", text: "all " + key }), ...options.map((o) => el("option", { value: o, text: o })) ]);
    s.value = filter[key];
    s.addEventListener("change", () => { filter[key] = s.value; render(papersRef); });
    return s;
  }

  async function addColumn(papers) {
    const name = window.prompt("New column name (stored as a property on each idea):");
    if (!name) return;
    const key = name.trim().toLowerCase().replace(/\s+/g, "_");
    if (HIDDEN.has(key)) return toast("that name is reserved", true);
    if (!cols.includes(key)) cols.push(key);
    // Seed the column on all existing rows so it shows up + persists.
    await guard(async () => { for (const r of rows) { await api.patch("/api/synapse/ideas/" + r.id, { [key]: "" }); } });
    toast("added column: " + key);
    reload(papers);
  }
})();
