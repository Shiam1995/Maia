/* learning.js — Learning Opportunities, a Mainframe-level service.

   Log a mistake or something to improve on; each one is a card that expands
   into a workspace where notes accumulate over time — a living document per
   mistake, not a single entry.

   The master card up top is the point of the thing: it doesn't just count
   repeats, it reports the GAPS between them. Three of the same mistake 40 days
   apart is a habit fading; three in a week is one getting worse. A raw count
   can't tell those apart, so the trend is computed from the gap sequence. */
(function () {
  const { el, clear, toast, guard, confirmDo } = window.ui;
  const api = window.api;

  const STATUS = ["open", "working", "resolved"];
  const STATUS_LABEL = { open: "open", working: "working on it", resolved: "resolved" };
  const STATUS_COLOR = { open: "var(--amber)", working: "var(--blue)", resolved: "var(--teal)" };
  const MODULES = ["mainframe", "synapse", "pulse", "vision", "vault"];
  const MOD_COLOR = {
    synapse: "#00F5D4", pulse: "#F4709C", vision: "#FF4757",
    vault: "#D4A017", mainframe: "#7FA8C8",
  };
  const TREND = {
    improving: { text: "gaps widening — improving", color: "var(--teal)" },
    worsening: { text: "gaps narrowing — getting worse", color: "var(--red)" },
    flat: { text: "steady", color: "var(--muted)" },
  };

  const open = new Set();          // expanded cards, kept across redraws
  // the database above the cards: how it's sorted, and what it's hiding
  const db = { sort: "occurred_at", dir: -1, hideResolved: true, groupBy: false };
  let filter = { status: "", module: "" };

  // "entry" → "entries", not "entrys"
  const plural = (n, w) => n + " " + (n === 1 ? w : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + "ies" : w + "s");

  window.Views = window.Views || {};
  window.Views.learning = {
    id: "learning", label: "Learning", scoped: false,
    async render(view) {
      clear(view);
      view.appendChild(el("div.view-head", {}, [el("div", {}, [
        el("h1", { text: "Learning Opportunities" }),
        el("div.sub", { text: "Mistakes and things to improve on — logged across every module, with repeat detection." }),
      ])]));

      const summaryHost = el("div");
      const dbHost = el("div");
      const kindHost = el("div");
      const formHost = el("div");
      const listHost = el("div");
      // Summary first, then the database, then the log — the order asked for.
      view.append(summaryHost, dbHost, kindHost, formHost, listHost);

      async function reload() {
        const [items, sum, kindRows] = await guard(() => Promise.all([
          api.get("/api/learning"), api.get("/api/learning/summary"),
          api.get("/api/learning/kinds"),
        ]));
        const kindGroups = {};
        kindRows.forEach((k) => { kindGroups[k.name] = k.group; });
        drawSummary(summaryHost, sum);
        drawDatabase(dbHost, items, sum, kindGroups, reload);
        drawKinds(kindHost, kindRows, reload);
        drawForm(formHost, sum, reload);
        drawList(listHost, items, sum, reload);
      }

      /* Kinds and the habit each rolls into. Editable here because grouping is
         what turns a list of separate mistakes into a habit you can see. */
      function drawKinds(host, kindRows, reload) {
        clear(host);
        let openPanel = kindHost.dataset.open === "1";
        const body = el("div");
        const btn = el("button.btn-sm", { text: (openPanel ? "▾" : "▸") + " kinds & habits (" + kindRows.length + ")" });
        btn.addEventListener("click", () => {
          openPanel = !openPanel;
          kindHost.dataset.open = openPanel ? "1" : "0";
          draw();
        });
        function draw() {
          clear(body);
          btn.textContent = (openPanel ? "▾" : "▸") + " kinds & habits (" + kindRows.length + ")";
          if (!openPanel) return;
          body.appendChild(el("div.sub", { style: "margin:8px 0",
            text: "Give a kind a habit and every entry under it rolls up there. Removing a kind leaves the entries filed under it alone." }));
          kindRows.forEach((k) => {
            const grp = el("input", { value: k.group || "", placeholder: "habit (e.g. scheduling, food)", style: "flex:1;min-width:150px" });
            grp.addEventListener("change", () => guard(async () => {
              await api.post("/api/learning/kinds", { name: k.name, group: grp.value.trim() });
              toast("grouped"); reload();
            }));
            body.appendChild(el("div.row", { style: "gap:8px;margin-top:6px;align-items:center" }, [
              el("span.pill", { style: "color:var(--red);min-width:130px", text: k.name }),
              el("span.sub", { style: "font-size:11px;min-width:64px", text: plural(k.uses, "entry") }),
              grp,
              el("button.btn-sm.btn-danger", { title: "remove this kind from the list", text: "×",
                onclick: () => confirmDo(
                  "Remove the kind “" + k.name + "”?\n\nEntries filed under it keep it — it just stops being suggested.",
                  async () => { await api.del("/api/learning/kinds/" + encodeURIComponent(k.name)); toast("removed"); reload(); }) }),
            ]));
          });
          const nn = el("input", { placeholder: "new kind", style: "flex:1;min-width:130px" });
          const ng = el("input", { placeholder: "habit it belongs to", style: "flex:1;min-width:130px" });
          body.appendChild(el("div.row", { style: "gap:8px;margin-top:10px" }, [
            nn, ng,
            el("button.btn-sm", { text: "+ add kind", onclick: () => guard(async () => {
              if (!nn.value.trim()) return toast("name the kind", true);
              await api.post("/api/learning/kinds", { name: nn.value.trim(), group: ng.value.trim() });
              nn.value = ng.value = ""; toast("added"); reload();
            }) }),
          ]));
        }
        const wrap = el("div.card", { style: "margin-top:12px" }, [
          el("div.spread", {}, [el("h3", { style: "margin:0", text: "Types of mistake" }), btn]), body,
        ]);
        draw();
        host.appendChild(wrap);
      }

      function drawSummary(host, sum) {
        clear(host);
        const t = sum.tally;
        const box = (v, l, c) => el("div.prog-box", {}, [
          el("div.prog-val", { style: "color:" + c, text: String(v) }),
          el("div.prog-label", { text: l }),
        ]);
        const card = el("div.card");
        card.appendChild(el("div.spread", {}, [
          el("h3", { style: "margin:0", text: "Summary" }),
          el("span.sub", { text: "resolved stay in the history but leave the active tally" }),
        ]));
        card.appendChild(el("div.prog-grid", { style: "margin-top:10px" }, [
          box(t.active, "active", "var(--amber)"),
          box(t.open, "open", "var(--amber)"),
          box(t.working, "working on it", "var(--blue)"),
          box(t.resolved, "resolved", "var(--teal)"),
          box(t.repeating_kinds, "repeating", t.repeating_kinds ? "var(--red)" : "var(--muted)"),
          box(t.total, "logged all time", "var(--dim)"),
        ]));

        if (sum.repeats.length) {
          card.appendChild(el("div.sub", {
            style: "margin:14px 0 6px;color:var(--red);text-transform:uppercase;letter-spacing:1px;font-size:10px",
            text: "Patterns — " + plural(sum.repeats.length, "kind") + " logged more than once",
          }));
          sum.repeats.forEach((r) => {
            const tr = TREND[r.trend] || TREND.flat;
            card.appendChild(el("div.lo-pattern", {}, [
              el("div.row", { style: "gap:8px;flex-wrap:wrap;align-items:baseline" }, [
                el("span.lo-count", { text: "×" + r.count }),
                el("strong", { style: "font-size:13px", text: r.kind }),
                r.active_count
                  ? el("span.pill", { style: "color:var(--amber)", text: r.active_count + " still active" })
                  : el("span.pill", { style: "color:var(--teal)", text: "all resolved" }),
                el("span.sub", { style: "margin-left:auto;color:" + tr.color, text: tr.text }),
              ]),
              // the time context — is this a fading habit or an accelerating one
              el("div.row", { style: "gap:6px;margin-top:6px;flex-wrap:wrap" }, [
                el("span.lo-win" + (r.last_3_days > 1 ? ".hot" : ""), { text: r.last_3_days + " in 3d" }),
                el("span.lo-win" + (r.last_7_days > 1 ? ".hot" : ""), { text: r.last_7_days + " in 7d" }),
                el("span.lo-win" + (r.last_30_days > 2 ? ".hot" : ""), { text: r.last_30_days + " in 30d" }),
                el("span.sub", { style: "font-size:11px", text:
                  "last " + (r.days_since_last === 0 ? "today" : plural(r.days_since_last, "day") + " ago")
                  + (r.avg_gap_days != null ? " · avg gap " + r.avg_gap_days + "d" : "")
                  + (r.gaps_days.length ? " · gaps " + r.gaps_days.join(", ") + "d" : "") }),
              ]),
            ]));
          });
        }

        /* High-level habits — the point of grouping kinds. "Missed a deadline"
           and "forgot to prep" are separate mistakes; under `scheduling` they
           are one habit, and that's the thing you can actually act on. */
        const habits = (sum.habits || []).filter((h) => h.grouped);
        const ungrouped = (sum.habits || []).find((h) => !h.grouped);
        if (habits.length || ungrouped) {
          card.appendChild(el("div.sub", {
            style: "margin:14px 0 6px;text-transform:uppercase;letter-spacing:1px;font-size:10px",
            text: "High-level habits",
          }));
          habits.forEach((h) => {
            card.appendChild(el("div.lo-pattern", {}, [
              el("div.row", { style: "gap:8px;flex-wrap:wrap;align-items:baseline" }, [
                el("span.lo-count", { text: "×" + h.count }),
                el("strong", { style: "font-size:13px", text: h.group }),
                h.active
                  ? el("span.pill", { style: "color:var(--amber)", text: h.active + " active" })
                  : el("span.pill", { style: "color:var(--teal)", text: "all resolved" }),
                el("span.sub", { style: "margin-left:auto;font-size:11px", text:
                  h.days_since_last == null ? "" :
                  "last " + (h.days_since_last === 0 ? "today" : plural(h.days_since_last, "day") + " ago") }),
              ]),
              el("div.row", { style: "gap:4px;margin-top:6px;flex-wrap:wrap" },
                h.kinds.map((k) => el("span.lo-win", { text: k }))),
            ]));
          });
          if (ungrouped) {
            card.appendChild(el("div.sub", { style: "margin-top:8px;font-size:11px",
              text: plural(ungrouped.count, "entry") + " not grouped yet — set a group on a kind below to roll them up" }));
          }
        }
        host.appendChild(card);
      }

      /* ---- the database ----
         A flat sortable table above the cards: the whole log at a glance,
         sortable, groupable by habit, with resolved hidden by default. */
      const DB_COLS = [
        { key: "occurred_at", label: "When", w: 96 },
        { key: "what_happened", label: "What happened", w: 300 },
        { key: "kind", label: "Kind", w: 140 },
        { key: "group", label: "Habit", w: 120 },
        { key: "module", label: "Module", w: 90 },
        { key: "status", label: "Status", w: 100 },
        { key: "counts", label: "Ideas / asked / notes", w: 140 },
      ];

      function drawDatabase(host, items, sum, kindGroups, reload) {
        clear(host);
        const wrap = el("div.card", { style: "margin-top:12px" });
        wrap.appendChild(el("div.spread", {}, [
          el("h3", { style: "margin:0", text: "All entries" }),
          el("div.row", { style: "gap:6px;flex-wrap:wrap" }, [
            el("button.btn-sm" + (db.hideResolved ? ".heat-on" : ""), {
              onclick: () => { db.hideResolved = !db.hideResolved; reload(); },
              text: db.hideResolved ? "resolved hidden" : "resolved shown",
            }),
            el("button.btn-sm" + (db.groupBy ? ".heat-on" : ""), {
              onclick: () => { db.groupBy = !db.groupBy; reload(); },
              text: db.groupBy ? "grouped by habit" : "group by habit",
            }),
          ]),
        ]));

        let list = items.slice();
        if (db.hideResolved) list = list.filter((i) => i.status !== "resolved");
        const groupOf = (i) => kindGroups[(i.kind || "").trim().toLowerCase()] || "";
        list.sort((a, b) => {
          const val = (r) => r[db.sort] != null ? r[db.sort]
            : db.sort === "group" ? groupOf(r) : "";
          const x = db.sort === "group" ? groupOf(a) : (a[db.sort] || "");
          const y = db.sort === "group" ? groupOf(b) : (b[db.sort] || "");
          return (x > y ? 1 : x < y ? -1 : 0) * db.dir;
        });

        if (!list.length) {
          wrap.appendChild(el("div.empty", { text: items.length ? "Everything here is resolved." : "Nothing logged yet." }));
          host.appendChild(wrap); return;
        }

        const table = el("table.wk-table");
        const head = el("tr");
        DB_COLS.forEach((c) => head.appendChild(el("th", {
          style: "min-width:" + c.w + "px;cursor:pointer",
          title: "sort by " + c.label,
          onclick: () => {
            if (db.sort === c.key) db.dir *= -1; else { db.sort = c.key; db.dir = 1; }
            reload();
          },
          text: c.label + (db.sort === c.key ? (db.dir > 0 ? " ▲" : " ▼") : ""),
        })));
        table.appendChild(head);

        const addRow = (i) => {
          const tr = el("tr.wk-row", { style: "cursor:pointer",
            onclick: () => { open.add(i.id); reload(); document.getElementById("lo-" + i.id)?.scrollIntoView({ block: "center" }); } });
          tr.appendChild(el("td", { text: i.occurred_at || "" }));
          tr.appendChild(el("td", { text: i.what_happened || "" }));
          tr.appendChild(el("td", {}, [i.kind ? el("span.pill", { style: "color:var(--red)", text: i.kind }) : null]));
          tr.appendChild(el("td", { text: groupOf(i) || "—" }));
          tr.appendChild(el("td", {}, [el("span.pill", { style: "color:" + (MOD_COLOR[i.module] || "var(--dim)"), text: i.module })]));
          tr.appendChild(el("td", {}, [el("span.pill", { style: "color:" + STATUS_COLOR[i.status], text: STATUS_LABEL[i.status] })]));
          tr.appendChild(el("td", { style: "font-family:var(--mono);font-size:11px",
            text: (i.ideas || []).length + " / " + (i.consulted || []).length + " / " + (i.notes || []).length }));
          table.appendChild(tr);
        };

        if (db.groupBy) {
          const buckets = new Map();
          list.forEach((i) => {
            const g = groupOf(i) || "(ungrouped)";
            if (!buckets.has(g)) buckets.set(g, []);
            buckets.get(g).push(i);
          });
          [...buckets.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([g, rows]) => {
            const tr = el("tr");
            tr.appendChild(el("td", { colspan: String(DB_COLS.length), style: "background:var(--raised)" }, [
              el("div.row", { style: "gap:8px;align-items:baseline" }, [
                el("strong", { text: g }),
                el("span.sub", { style: "font-size:11px", text: plural(rows.length, "entry")
                  + " · " + rows.filter((r) => r.status !== "resolved").length + " active" }),
              ]),
            ]));
            table.appendChild(tr);
            rows.forEach(addRow);
          });
        } else {
          list.forEach(addRow);
        }
        wrap.appendChild(el("div.wk-scroll", {}, [table]));
        host.appendChild(wrap);
      }

      function drawForm(host, sum, reload) {
        clear(host);
        const what = el("input", { placeholder: "what happened", style: "flex:2;min-width:200px" });
        const kind = el("input", { placeholder: "kind of mistake (groups repeats)", style: "flex:1;min-width:170px", list: "lo-kinds" });
        const kinds = el("datalist", { id: "lo-kinds" }, sum.kinds.map((k) => el("option", { value: k })));
        const when = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) });
        const mod = el("select", {}, MODULES.map((m) => el("option", { value: m, text: m })));
        const action = el("input", { placeholder: "what I will do about it", style: "flex:2;min-width:200px" });
        // The overview goes in the line above; this is the diary entry. Ideas
        // and consultations are added on the card once it exists — they grow
        // over time rather than being written in one sitting.
        const detail = el("textarea.mform-input", { rows: "3", style: "width:100%",
          placeholder: "what led to it — the longer version (optional, and you can fill it in later)" });
        host.appendChild(el("div.card", { style: "margin-top:12px" }, [
          el("div.sub", { style: "text-transform:uppercase;letter-spacing:1px;font-size:10px", text: "Log one" }),
          kinds,
          el("div.row", { style: "gap:8px;margin-top:8px;flex-wrap:wrap" }, [what, kind, when, mod]),
          el("div", { style: "margin-top:8px" }, [detail]),
          el("div.row", { style: "gap:8px;margin-top:8px;flex-wrap:wrap" }, [
            action,
            el("button.btn-primary", {
              onclick: () => guard(async () => {
                if (!what.value.trim()) return toast("what happened?", true);
                await api.post("/api/learning", {
                  what_happened: what.value.trim(), kind: kind.value.trim(),
                  detail: detail.value.trim(),
                  occurred_at: when.value, module: mod.value, action: action.value.trim(),
                });
                what.value = kind.value = action.value = detail.value = "";
                toast("logged"); reload();
              }),
              text: "+ log it",
            }),
          ]),
        ]));
      }

      function drawList(host, items, sum, reload) {
        clear(host);
        const seg = (key, val, label) => el("button.btn-sm" + (filter[key] === val ? ".heat-on" : ""), {
          onclick: () => { filter[key] = filter[key] === val ? "" : val; reload(); }, text: label });
        host.appendChild(el("div.row", { style: "gap:6px;margin:14px 0 10px;flex-wrap:wrap" }, [
          el("span.sub", { text: items.length + " logged" }),
          ...STATUS.map((s) => seg("status", s, STATUS_LABEL[s])),
          el("span.sub", { text: "│" }),
          ...MODULES.map((m) => seg("module", m, m)),
        ]));

        const shown = items.filter((i) =>
          (!filter.status || i.status === filter.status) &&
          (!filter.module || i.module === filter.module));
        if (!shown.length) {
          host.appendChild(el("div.empty", { text: items.length ? "Nothing matches those filters." : "Nothing logged yet." }));
          return;
        }
        shown.forEach((i) => host.appendChild(card(i, sum, reload)));
      }

      function card(lo, sum, reload) {
        const isOpen = open.has(lo.id);
        const pattern = sum.repeats.find((r) => r.ids.includes(lo.id));
        // a repeating mistake is visually distinct — red, with its count
        // id so a click in the database above can scroll to this card
        const c = el("div.lo-card" + (pattern ? ".lo-repeat" : "") + (lo.status === "resolved" ? ".lo-done" : ""),
          { id: "lo-" + lo.id });

        c.appendChild(el("div.lo-head", {
          onclick: () => { isOpen ? open.delete(lo.id) : open.add(lo.id); reload(); },
        }, [
          el("div.row", { style: "gap:8px;align-items:baseline;flex-wrap:wrap" }, [
            el("span.dd-caret", { text: isOpen ? "▾" : "▸" }),
            pattern ? el("span.lo-count", { title: "logged " + pattern.count + " times", text: "×" + pattern.count }) : null,
            el("span", { style: "font-size:14px;font-weight:600", text: lo.what_happened }),
          ]),
          el("div.row", { style: "gap:6px;margin-top:6px;flex-wrap:wrap;align-items:center" }, [
            lo.kind ? el("span.pill", { style: "color:var(--red)", text: lo.kind }) : null,
            el("span.pill", { style: "color:" + (MOD_COLOR[lo.module] || "var(--dim)"), text: lo.module }),
            el("span.pill", { style: "color:" + STATUS_COLOR[lo.status], text: STATUS_LABEL[lo.status] }),
            el("span.sub", { style: "font-size:11px", text: lo.occurred_at }),
            lo.notes.length ? el("span.sub", { style: "font-size:11px", text: plural(lo.notes.length, "note") }) : null,
            pattern && pattern.days_since_last != null
              ? el("span.sub", { style: "font-size:11px;color:var(--red);margin-left:auto",
                  text: "same kind " + (pattern.latest_gap_days != null ? pattern.latest_gap_days + "d apart" : "again") })
              : null,
          ]),
        ]));
        if (!isOpen) return c;

        // --- the workspace ---
        const body = el("div.lo-body", { onclick: (e) => e.stopPropagation() });
        const field = (label, node) => el("label.wl-field", {}, [el("span.wl-label", { text: label }), node]);
        const what = el("input", { value: lo.what_happened, style: "width:100%" });
        const kind = el("input", { value: lo.kind || "", list: "lo-kinds", style: "width:100%" });
        const when = el("input", { type: "date", value: (lo.occurred_at || "").slice(0, 10) });
        const mod = el("select", {}, MODULES.map((m) => {
          const o = el("option", { value: m, text: m }); if (m === lo.module) o.setAttribute("selected", ""); return o;
        }));
        const st = el("select", {}, STATUS.map((s) => {
          const o = el("option", { value: s, text: STATUS_LABEL[s] }); if (s === lo.status) o.setAttribute("selected", ""); return o;
        }));
        const action = el("textarea.mform-input", { rows: "2", style: "width:100%" });
        action.value = lo.action || "";
        const save = (payload) => guard(async () => {
          await api.patch("/api/learning/" + lo.id, payload); toast("saved"); reload();
        });
        [what, kind, when, action].forEach((n) => n.addEventListener("change", () => save({
          what_happened: what.value.trim(), kind: kind.value.trim(),
          occurred_at: when.value, action: action.value.trim(),
        })));
        mod.addEventListener("change", () => save({ module: mod.value }));
        st.addEventListener("change", () => save({ status: st.value }));

        body.appendChild(el("div.row", { style: "gap:10px;flex-wrap:wrap" }, [
          field("what happened", what), field("kind", kind),
          field("when", when), field("module", mod), field("status", st),
        ]));
        body.appendChild(el("div", { style: "margin-top:8px" }, [field("what I will do about it", action)]));

        /* The long version. `what happened` above is the one-line overview you
           scan the table by; this is the diary entry behind it — what led to
           it, what you were doing, what you were thinking. */
        const detail = el("textarea.mform-input", { rows: "6", style: "width:100%",
          placeholder: "the whole story — what led up to it, what you were doing, what you were thinking…" });
        detail.value = lo.detail || "";
        detail.addEventListener("change", () => save({ detail: detail.value.trim() }));
        body.appendChild(el("div", { style: "margin-top:8px" }, [field("what led to it", detail)]));

        /* Two growable lists. Each entry is its own box so you can keep adding
           — idea one, idea two — instead of one blob you have to reorganise.
           They save as a whole list, so a removal is a save like any edit. */
        function growList(labelText, values, key, placeholder, rows) {
          const host = el("div.lo-list");
          const boxes = [];
          const collect = () => boxes.map((b) => b.value.trim()).filter(Boolean);
          const persist = () => save({ [key]: collect() });
          function addBox(value, focus) {
            const ta = el("textarea.mform-input", { rows: String(rows || 2), placeholder, style: "flex:1;min-width:200px" });
            ta.value = value || "";
            ta.addEventListener("change", persist);
            const row = el("div.row", { style: "gap:6px;margin-top:6px;align-items:flex-start" }, [
              el("span.lo-n", { text: String(boxes.length + 1) }),
              ta,
              el("button.btn-sm.btn-danger", { title: "remove", text: "×", onclick: () => {
                const i = boxes.indexOf(ta);
                if (i >= 0) boxes.splice(i, 1);
                row.remove();
                [...host.querySelectorAll(".lo-n")].forEach((n, j) => { n.textContent = String(j + 1); });
                persist();
              } }),
            ]);
            boxes.push(ta);
            host.appendChild(row);
            if (focus) ta.focus();
          }
          (values || []).forEach((v) => addBox(v));
          const wrap = el("div", { style: "margin-top:12px" }, [
            el("div.row", { style: "gap:8px;align-items:center" }, [
              el("span.wl-label", { text: labelText }),
              el("button.btn-sm", { text: "+ add", onclick: () => addBox("", true) }),
            ]),
            host,
          ]);
          return wrap;
        }

        body.appendChild(growList("ideas", lo.ideas, "ideas",
          "an idea — what might fix this, what to try next time…", 2));
        body.appendChild(growList("who / what I asked", lo.consulted, "consulted",
          "who or what you asked, and what came back — e.g. “asked Claude how to structure X → suggested Y”", 3));

        // notes — the living document
        body.appendChild(el("div.sub", {
          style: "margin:14px 0 6px;text-transform:uppercase;letter-spacing:1px;font-size:10px",
          text: "Notes over time",
        }));
        (lo.notes || []).forEach((n) => {
          const t = el("textarea.mform-input", { rows: "2", style: "width:100%" });
          t.value = n.text;
          t.addEventListener("change", () => guard(async () => {
            await api.patch("/api/learning/" + lo.id + "/notes/" + n.id, { text: t.value }); toast("note saved");
          }));
          body.appendChild(el("div.lo-note", {}, [
            el("div.row", { style: "gap:8px" }, [
              el("span.mono", { style: "font-size:10px;color:var(--muted)", text: (n.created_at || "").slice(0, 10) }),
              el("button.btn-sm.btn-danger", { style: "margin-left:auto",
                onclick: () => guard(async () => { await api.del("/api/learning/" + lo.id + "/notes/" + n.id); reload(); }),
                text: "×" }),
            ]),
            t,
          ]));
        });
        const fresh = el("textarea.mform-input", { rows: "2", placeholder: "what you tried, what's working, what isn't…", style: "width:100%;margin-top:6px" });
        body.appendChild(fresh);
        body.appendChild(el("div.row", { style: "gap:6px;margin-top:8px" }, [
          el("button.btn-sm", {
            onclick: () => guard(async () => {
              if (!fresh.value.trim()) return toast("write something first", true);
              await api.post("/api/learning/" + lo.id + "/notes", { text: fresh.value });
              fresh.value = ""; toast("note added"); reload();
            }),
            text: "+ add note",
          }),
          el("button.btn-sm.btn-danger", { style: "margin-left:auto",
            onclick: () => confirmDo("Delete this learning opportunity and its notes?", async () => {
              await api.del("/api/learning/" + lo.id); open.delete(lo.id); reload();
            }), text: "delete" }),
        ]));
        c.appendChild(body);
        return c;
      }

      await reload();
    },
  };
})();
