/* work.js — the "Database" tab: every work session as one spreadsheet grid.

   Mainframe-level, sitting next to Progress in the top bar. Every module pushes
   into this same table, colour-coded by module, and these same rows drive the
   contribution grid on the Project tab.

   Cells are edited in place (change a value → PATCH → totals redraw). Every
   column is present on every row; anything that doesn't apply is 0 / blank. */
(function () {
  const { el, clear, toast, guard, confirmDo } = window.ui;
  const api = window.api;
  const WL = window.WorkLog;

  // Kinds are user-extensible (:WorkKind), so the column reads them at draw
  // time rather than from a frozen list.
  let kinds = [];

  // column → how it renders. `edit` builds the in-place editor.
  const COLS = [
    { key: "date", label: "Date", w: 108, type: "date" },
    { key: "start", label: "From", w: 74, type: "time" },
    { key: "end", label: "To", w: 74, type: "time" },
    { key: "mins", label: "Time", w: 78, type: "mins" },
    { key: "module", label: "Module", w: 96, type: "select", values: () => Object.keys(WL.MODULES) },
    { key: "ref_kind", label: "Kind", w: 96, type: "select", values: () => kinds },
    { key: "ref_title", label: "On", w: 150, type: "text" },
    { key: "what", label: "What I did", w: 240, type: "text" },
    { key: "focus", label: "Focus", w: 90, type: "select", values: () => Object.keys(WL.FOCUS), fmt: (v) => WL.FOCUS[v || "none"] },
    { key: "notes", label: "Notes", w: 220, type: "text" },
    { key: "completed", label: "Completed", w: 92, type: "bool" },
  ];

  /* Grouping. "rows" is the flat table and stays the default — it's the thing
     the tab is for; the periods are a way of standing back from it. */
  const PERIODS = [
    { key: "rows",  label: "Rows" },
    { key: "day",   label: "Day" },
    { key: "week",  label: "Week" },
    { key: "month", label: "Month" },
    { key: "year",  label: "Year" },
  ];
  const PERIOD_KEY = "mf.work.period";

  let rows = [];
  let filters = { module: "", ref_kind: "", focus: "", start: "", end: "" };
  let sortKey = "date", sortDir = -1;
  let period = localStorage.getItem(PERIOD_KEY) || "rows";

  function visible() {
    return rows.filter((r) =>
      (!filters.module || r.module === filters.module) &&
      (!filters.ref_kind || r.ref_kind === filters.ref_kind) &&
      (!filters.focus || (r.focus || "none") === filters.focus) &&
      (!filters.start || (r.date || "") >= filters.start) &&
      (!filters.end || (r.date || "") <= filters.end)
    ).sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      if (x === y) return 0;
      return ((x == null ? "" : x) > (y == null ? "" : y) ? 1 : -1) * sortDir;
    });
  }

  // ---------- in-place cell editing ----------
  function commit(row, key, value, redraw) {
    if (row[key] === value) return;
    guard(async () => {
      const updated = await api.work.update(row.id, { [key]: value });
      Object.assign(row, updated);   // mins may be recomputed server-side
      toast("saved");
      redraw();
    });
  }

  function cell(row, col, redraw) {
    const raw = row[col.key];
    const td = el("td", { style: "min-width:" + col.w + "px" });

    if (col.type === "bool") {
      const box = el("input", { type: "checkbox" });
      if (raw) box.setAttribute("checked", "");
      box.addEventListener("change", () => commit(row, col.key, box.checked, redraw));
      td.appendChild(el("div", { style: "text-align:center" }, [box]));
      if (raw) td.classList.add("wk-pushed");
      return td;
    }
    if (col.type === "select") {
      const sel = el("select.wk-cell");
      col.values().forEach((v) => {
        const o = el("option", { value: v, text: col.fmt ? col.fmt(v) : v });
        if (v === (raw || (col.key === "focus" ? "none" : ""))) o.setAttribute("selected", "");
        sel.appendChild(o);
      });
      sel.addEventListener("change", () => commit(row, col.key, sel.value, redraw));
      if (col.key === "module") sel.style.color = WL.MODULES[raw] || "";
      td.appendChild(sel);
      return td;
    }
    if (col.type === "mins") {
      // read-only display of the derived duration; edit via From/To or the number
      const inp = el("input.wk-cell", { type: "number", min: "0", value: raw || 0, style: "width:52px" });
      inp.addEventListener("change", () => commit(row, "mins", Number(inp.value) || 0, redraw));
      td.appendChild(el("div.row", { style: "gap:4px;align-items:center" }, [
        inp, el("span.sub", { style: "font-size:10px", text: WL.fmtMins(raw) }),
      ]));
      return td;
    }
    const inp = el("input.wk-cell", {
      type: col.type === "number" ? "number" : col.type === "date" ? "date" : col.type === "time" ? "time" : "text",
      value: raw == null ? "" : String(raw),
    });
    if (col.type === "number") inp.setAttribute("min", "0");
    inp.addEventListener("change", () =>
      commit(row, col.key, col.type === "number" ? Number(inp.value) || 0 : inp.value, redraw));
    td.appendChild(inp);
    return td;
  }

  // ---------- totals ----------
  const isDone = (r) => !!(r.completed != null ? r.completed : r.pushed);

  function totals(list) {
    const t = { mins: 0, done: 0, active: 0, passive: 0, days: new Set() };
    list.forEach((r) => {
      t.mins += r.mins || 0;
      if (isDone(r)) t.done++;
      if (r.focus === "active") t.active += r.mins || 0;
      if (r.focus === "passive") t.passive += r.mins || 0;
      if (r.date) t.days.add(r.date);
    });
    return t;
  }

  function statRow(list) {
    const t = totals(list);
    const box = (v, l, c) => el("div.prog-box", {}, [
      el("div.prog-val", { style: "color:" + c, text: v }), el("div.prog-label", { text: l }),
    ]);
    return el("div.prog-grid", {}, [
      box(WL.fmtMins(t.mins), "total time", "#2de2ff"),
      box(String(list.length), "sessions", "#7FA8C8"),
      box(String(t.days.size), "days", "#7FA8C8"),
      box(WL.fmtMins(t.active), "active", "#00F5D4"),
      box(WL.fmtMins(t.passive), "passive", "#D4A017"),
      box(String(t.done), "completed", "#F4709C"),
    ]);
  }

  /* ---------- period grouping ----------
     A date string is bucketed without ever constructing a Date for day/month/
     year — slicing the ISO string can't drift by a timezone. Weeks need real
     date maths, so they use UTC to stay off local-midnight edges. */
  function bucketOf(dateStr) {
    const d = String(dateStr || "");
    if (!d) return { key: "", label: "no date" };
    if (period === "day") return { key: d, label: d };
    if (period === "month") return { key: d.slice(0, 7), label: d.slice(0, 7) };
    if (period === "year") return { key: d.slice(0, 4), label: d.slice(0, 4) };
    // ISO week: Thursday of the same week decides the year (ISO-8601 rule).
    const dt = new Date(d + "T00:00:00Z");
    if (isNaN(dt)) return { key: d, label: d };
    const day = (dt.getUTCDay() + 6) % 7;                 // Mon=0
    const monday = new Date(dt); monday.setUTCDate(dt.getUTCDate() - day);
    const thu = new Date(monday); thu.setUTCDate(monday.getUTCDate() + 3);
    const jan1 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
    const week = Math.floor((thu - jan1) / 604800000) + 1;
    const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
    const dm = (x) => x.toISOString().slice(5, 10);
    return {
      key: thu.getUTCFullYear() + "-W" + String(week).padStart(2, "0"),
      // The year has to be in the label: week 30 of 2026 and week 30 of 2027
      // otherwise read as one overlapping range with no way to tell them apart.
      label: thu.getUTCFullYear() + " · Wk " + week + " · " + dm(monday) + " → " + dm(sunday),
    };
  }

  function grouped(list) {
    const map = new Map();
    list.forEach((r) => {
      const b = bucketOf(r.date);
      if (!map.has(b.key)) map.set(b.key, { ...b, rows: [] });
      map.get(b.key).rows.push(r);
    });
    // Newest bucket first, matching the table's default date-descending sort.
    return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  }

  function periodTable(list) {
    const table = el("table.wk-table", { "data-no-now": "" });
    const head = el("tr");
    [["Period", 180], ["Time", 90], ["Sessions", 80], ["Days", 70],
     ["Active", 90], ["Passive", 90], ["Completed", 90], ["Modules", 160]]
      .forEach(([l, w]) => head.appendChild(el("th", { style: "min-width:" + w + "px", text: l })));
    table.appendChild(head);

    grouped(list).forEach((g) => {
      const t = totals(g.rows);
      const mods = [...new Set(g.rows.map((r) => r.module).filter(Boolean))];
      const tr = el("tr.wk-row");
      tr.appendChild(el("td", {}, [el("strong", { text: g.label })]));
      [WL.fmtMins(t.mins), String(g.rows.length), String(t.days.size),
       WL.fmtMins(t.active), WL.fmtMins(t.passive), String(t.done)]
        .forEach((v) => tr.appendChild(el("td", { text: v })));
      tr.appendChild(el("td", {}, [el("div.row", { style: "gap:4px;flex-wrap:wrap" },
        mods.map((m) => el("span.tk-tag", { style: "background:var(--raised);color:" + (WL.MODULES[m] || "var(--dim)"), text: m })))]));
      table.appendChild(tr);
    });
    return el("div.wk-scroll", {}, [table]);
  }

  window.Views = window.Views || {};
  window.Views.work = {
    id: "work", label: "Database", scoped: false,
    async render(viewEl) {
      clear(viewEl);
      viewEl.appendChild(el("div.view-head", {}, [el("div", {}, [
        el("h1", { text: "Database" }),
        el("div.sub", { text: "Every block of work, from every module, in one table. These rows are what light the contribution grid." }),
      ])]));
      const host = el("div");
      viewEl.appendChild(host);

      async function reload() {
        const [list, ks] = await guard(() => Promise.all([
          api.work.list("?limit=5000"), api.work.kinds(),
        ]));
        rows = list; kinds = ks;
        draw();
      }

      function draw() {
        const list = visible();
        clear(host);
        host.appendChild(statRow(list));

        // --- toolbar: filters + add + export ---
        const fsel = (key, values, label) => {
          const s = el("select.btn-sm", {}, [el("option", { value: "", text: label })]);
          values.forEach((v) => {
            const o = el("option", { value: v, text: v });
            if (filters[key] === v) o.setAttribute("selected", "");
            s.appendChild(o);
          });
          s.addEventListener("change", () => { filters[key] = s.value; draw(); });
          return s;
        };
        const dFrom = el("input.btn-sm", { type: "date", value: filters.start });
        dFrom.addEventListener("change", () => { filters.start = dFrom.value; draw(); });
        const dTo = el("input.btn-sm", { type: "date", value: filters.end });
        dTo.addEventListener("change", () => { filters.end = dTo.value; draw(); });

        // period toggle — flat rows stay the default
        const pbar = el("div.row", { style: "gap:0;margin:14px 0 0" }, PERIODS.map((p) =>
          el("button.view-btn" + (p.key === period ? ".active" : ""), {
            onclick: () => { period = p.key; localStorage.setItem(PERIOD_KEY, p.key); draw(); },
            text: p.label,
          })));

        const addKind = el("button.btn-sm", { title: "add a kind of your own — book, client, admin…",
          text: "+ kind", onclick: () => guard(async () => {
            const name = window.prompt("New kind (one word, e.g. book or project):", "");
            if (name === null) return;                       // cancelled
            if (!name.trim()) return toast("a kind needs a name", true);
            kinds = await api.work.addKind(name.trim());
            toast("kind “" + name.trim().toLowerCase() + "” added");
            draw();
          }) });

        /* Remove a kind you added — offered only while that kind is the active
           filter, so it's unmistakable which one goes. Built-ins can't be
           removed (the server refuses too), and rows already filed under a
           deleted kind keep their value; only the dropdown loses it. */
        const BUILT_IN = ["project", "task", "idea", "paper", "habit", "other"];
        const canDropKind = filters.ref_kind && !BUILT_IN.includes(filters.ref_kind);
        const dropKind = canDropKind ? el("button.btn-sm.btn-danger", {
          title: "remove the kind “" + filters.ref_kind + "” — rows already using it keep it",
          text: "× kind",
          onclick: () => confirmDo(
            "Remove the kind “" + filters.ref_kind + "”?\n\n"
            + "Rows already filed under it keep that value — it just stops being offered.",
            async () => {
              kinds = await api.work.delKind(filters.ref_kind);
              toast("kind removed");
              filters.ref_kind = "";
              draw();
            }),
        }) : null;

        const addHost = el("div");
        host.appendChild(pbar);
        host.appendChild(el("div.row", { style: "gap:8px;margin:10px 0;flex-wrap:wrap" }, [
          WL.button({ mountInto: addHost }, reload, "+ new row"),
          el("span.sub", { text: "│" }),
          fsel("module", Object.keys(WL.MODULES), "all modules"),
          fsel("ref_kind", kinds, "all kinds"),
          addKind, dropKind,
          fsel("focus", Object.keys(WL.FOCUS), "all focus"),
          dFrom, dTo,
          (filters.module || filters.ref_kind || filters.focus || filters.start || filters.end)
            ? el("button.btn-sm", { onclick: () => { filters = { module: "", ref_kind: "", focus: "", start: "", end: "" }; draw(); }, text: "clear" })
            : null,
          el("a.btn-sm", {
            style: "margin-left:auto;text-decoration:none",
            href: api.work.exportUrl(filters.start || filters.end ? "?start=" + (filters.start || "") + "&end=" + (filters.end || "") : ""),
            text: "⬇ CSV",
          }),
        ]));
        host.appendChild(addHost);

        if (!list.length) {
          host.appendChild(el("div.empty", { text: rows.length
            ? "No rows match those filters."
            : "Nothing logged yet. Hit “+ new row”, or push work from a project or task." }));
          return;
        }

        if (period !== "rows") { host.appendChild(periodTable(list)); return; }

        // --- the grid ---
        // data-no-now: this is a dense grid of fixed-width cells, and a "now"
        // button in every date/time cell would wreck the columns. The row's own
        // editor and the log-time form both have one.
        const table = el("table.wk-table", { "data-no-now": "" });
        const head = el("tr");
        // Delete goes FIRST: the table scrolls sideways, and a × pinned to the
        // far right of a dozen columns is a delete you can't reach.
        head.appendChild(el("th", { style: "min-width:34px" }));
        COLS.forEach((c) => {
          const th = el("th", {
            style: "min-width:" + c.w + "px;cursor:pointer",
            title: "sort by " + c.label,
            onclick: () => { if (sortKey === c.key) sortDir *= -1; else { sortKey = c.key; sortDir = 1; } draw(); },
            text: c.label + (sortKey === c.key ? (sortDir > 0 ? " ▲" : " ▼") : ""),
          });
          head.appendChild(th);
        });
        table.appendChild(head);

        list.forEach((r) => {
          const tr = el("tr.wk-row");
          tr.style.borderLeft = "3px solid " + (WL.MODULES[r.module] || "transparent");
          tr.appendChild(el("td", {}, [
            el("button.btn-sm.btn-danger", {
              title: "delete this row",
              onclick: () => confirmDo(
                "Delete this row?\n\n"
                + [r.date, WL.fmtMins(r.mins), r.ref_title || r.what || ""].filter(Boolean).join(" · ")
                + "\n\nThis can't be undone.",
                async () => { await api.work.del(r.id); toast("row deleted"); reload(); }),
              text: "×",
            }),
          ]));
          COLS.forEach((c) => tr.appendChild(cell(r, c, draw)));
          table.appendChild(tr);
        });
        host.appendChild(el("div.wk-scroll", {}, [table]));
      }

      reload();
    },
  };
})();
