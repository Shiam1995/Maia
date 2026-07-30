/* nutrition-log.js — the daily food log (NUTRITION_SPEC §2).

   Meal slots, each collapsible with its own calorie total. Four ways in, and
   the spec forbids skipping any of them:
     · search your library (most-used first) and pick a serving
     · QUICK ADD — four fields, one row, no food record needed
     · COPY — yesterday's breakfast, or a whole past day
     · BULK PASTE — with a preview before anything is written */
(function () {
  const { el, clear, toast, guard, confirmDo } = window.ui;
  const P = window.PULSE;

  let day = null;            // the date being shown; null = today
  const collapsed = {};      // slot key → hidden?

  const iso = (d) => window.ui.todayISO(d);
  const shift = (base, days) => { const d = new Date(base + "T00:00:00"); d.setDate(d.getDate() + days); return iso(d); };

  /* ---- add a food from the library ---- */
  function addFoodModal(slotKey, date, reload) {
    const { N, field, numInput, unitSelect, slotSelect, n1 } = window.NUT;
    const search = el("input.mform-input", { placeholder: "search your foods…" });
    const results = el("div.nt-results");
    const slot = slotSelect(slotKey);
    const size = numInput(1, "how much");
    const unit = unitSelect("serving");
    const preview = el("div.sub", { style: "font-size:11px;min-height:16px" });
    let picked = null;

    // Macros scale from the food's per-serving figures as you change the amount.
    const recompute = () => {
      if (!picked) { preview.textContent = ""; return; }
      const mult = (parseFloat(size.value) || 0);
      preview.textContent = ["calories", "protein", "carbs", "fat"]
        .map((k) => n1((picked[k] || 0) * mult) + (k === "calories" ? " cal" : "g " + k)).join("  ·  ");
    };
    size.addEventListener("input", recompute);

    async function run() {
      const q = search.value.trim();
      const list = await N().foods(q ? "?q=" + encodeURIComponent(q) : "");
      clear(results);
      if (!list.length) {
        results.appendChild(el("div.sub", { style: "padding:8px 0", text: q
          ? "No match. Create it in My Foods first — or use Quick add."
          : "Your food library is empty. Add foods in My Foods, or use Quick add." }));
        return;
      }
      list.slice(0, 25).forEach((f) => {
        const row = el("div.nt-result" + (picked && picked.id === f.id ? ".on" : ""), {
          onclick: () => {
            picked = f;
            unit.value = "serving";
            size.value = "1";
            recompute();
            run();
          },
        }, [
          el("div", { style: "flex:1;min-width:0" }, [
            el("div", { text: f.name + (f.brand ? " · " + f.brand : "") }),
            el("div.sub", { style: "font-size:10.5px",
              text: window.NUT.n0(f.calories) + " cal · P" + n1(f.protein) + " C" + n1(f.carbs) + " F" + n1(f.fat)
                + "  per " + n1(f.serving_size) + f.serving_unit }),
          ]),
          f.use_count ? el("span.sub", { style: "font-size:10px", text: "×" + f.use_count }) : null,
        ]);
        results.appendChild(row);
      });
    }
    let t = null;
    search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(run, 180); });

    P.modal("Add food", [
      field("Meal", slot),
      field("Search your foods", search),
      results,
      el("div.mform-row", {}, [field("Amount (× serving)", size), field("Unit", unit)]),
      preview,
    ], [
      { label: "Add", primary: true, onClick: (close) => guard(async () => {
        if (!picked) return toast("pick a food first", true);
        const mult = parseFloat(size.value) || 0;
        if (!mult) return toast("how much?", true);
        await N().addEntry({
          date, meal_slot: slot.value, food_id: picked.id, food_name: picked.name,
          serving_size: mult, serving_unit: unit.value,
          calories: n1((picked.calories || 0) * mult), protein: n1((picked.protein || 0) * mult),
          carbs: n1((picked.carbs || 0) * mult), fat: n1((picked.fat || 0) * mult),
        });
        toast("logged"); close(); reload();
      }) },
      { label: "Cancel", onClick: (close) => close() },
    ]);
    run();
  }

  /* ---- quick add: four fields, maximum speed (spec DO-NOT: never skip) ---- */
  function quickAddRow(slotKey, date, reload) {
    const { N, numInput } = window.NUT;
    const name = el("input.mform-input", { placeholder: "what (optional)", style: "flex:2;min-width:110px" });
    const f = { calories: numInput("", "cal"), protein: numInput("", "P"), carbs: numInput("", "C"), fat: numInput("", "F") };
    Object.values(f).forEach((i) => { i.style.width = "72px"; });
    const save = () => guard(async () => {
      const cals = parseFloat(f.calories.value) || 0;
      const any = Object.values(f).some((i) => parseFloat(i.value));
      if (!cals && !any) return toast("at least give it calories", true);
      await N().quickAdd({
        date, meal_slot: slotKey, food_name: name.value.trim() || "Quick add",
        calories: cals, protein: parseFloat(f.protein.value) || 0,
        carbs: parseFloat(f.carbs.value) || 0, fat: parseFloat(f.fat.value) || 0,
      });
      name.value = ""; Object.values(f).forEach((i) => { i.value = ""; });
      toast("added"); reload();
    });
    [name, ...Object.values(f)].forEach((i) =>
      i.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); }));
    return el("div.row.nt-quick", { style: "gap:6px;flex-wrap:wrap;align-items:center" }, [
      el("span.sub", { style: "font-size:10px;letter-spacing:1px", text: "QUICK" }),
      name, f.calories, f.protein, f.carbs, f.fat,
      el("button.btn-sm", { onclick: save, text: "+ add" }),
    ]);
  }

  /* ---- bulk paste, preview first ---- */
  function bulkModal(date, reload) {
    const { N, slotSelect, field } = window.NUT;
    const slot = slotSelect("snacks");
    const ta = el("textarea.mform-input", { rows: "7", style: "width:100%",
      placeholder: "Chicken breast, 150g, 248 cal, 46g protein, 0g carbs, 5g fat\nBrown rice, 200g, 216 cal, 5g protein, 45g carbs, 2g fat" });
    const out = el("div", { style: "margin-top:8px;max-height:220px;overflow:auto" });
    let parsed = null;

    const preview = () => guard(async () => {
      const r = await N().bulk({ text: ta.value, date, meal_slot: slot.value, dry_run: true });
      parsed = r;
      clear(out);
      out.appendChild(el("div.sub", { style: "font-size:11px",
        text: r.counts.ok + " will be added" + (r.counts.rejected ? " · " + r.counts.rejected + " line(s) can't be read" : "") }));
      r.parsed.forEach((p) => out.appendChild(el("div.nt-result", {}, [
        el("div", { style: "flex:1" }, [
          el("div", { text: p.food_name }),
          el("div.sub", { style: "font-size:10.5px",
            text: window.NUT.n0(p.calories) + " cal · P" + (p.protein || 0) + " C" + (p.carbs || 0) + " F" + (p.fat || 0) }),
        ]),
      ])));
      // Bad lines are shown, never dropped in silence.
      r.rejected.forEach((x) => out.appendChild(el("div.nt-result", { style: "color:var(--red)" }, [
        el("div", { style: "flex:1" }, [
          el("div", { text: "line " + x.line + ": " + x.text.slice(0, 48) }),
          el("div.sub", { style: "font-size:10.5px;color:var(--red)", text: x.why }),
        ]),
      ])));
    });

    P.modal("Bulk paste", [
      field("Meal", slot),
      field("One food per line", ta),
      el("div.row", {}, [el("button.btn-sm", { onclick: preview, text: "preview" })]),
      out,
    ], [
      { label: "Import", primary: true, onClick: (close) => guard(async () => {
        if (!parsed || !parsed.counts.ok) return toast("preview it first", true);
        const r = await N().bulk({ text: ta.value, date, meal_slot: slot.value });
        toast("imported " + r.counts.ok); close(); reload();
      }) },
      { label: "Cancel", onClick: (close) => close() },
    ]);
  }

  /* ---- copy a past day or meal ---- */
  function copyModal(date, reload) {
    const { N, field, slotSelect } = window.NUT;
    const from = el("input.mform-input", { type: "date", value: shift(date, -1) });
    const slot = el("select.mform-input", {}, [el("option", { value: "", text: "the whole day" }),
      ...window.NUT.SLOTS.map((s) => el("option", { value: s.key, text: s.icon + "  " + s.label }))]);
    P.modal("Copy meals", [
      field("From which day", from),
      field("What to copy", slot),
      el("div.sub", { style: "font-size:11px", text: "Copied onto " + date + "." }),
    ], [
      { label: "Copy", primary: true, onClick: (close) => guard(async () => {
        if (!from.value) return toast("pick a day", true);
        const r = await N().copyMeals({ from_date: from.value, to_date: date, meal_slot: slot.value || null });
        toast(r.created ? "copied " + r.created : "nothing logged that day", !r.created);
        close(); reload();
      }) },
      { label: "Cancel", onClick: (close) => close() },
    ]);
  }

  /* ---- the view ---- */
  function render(host) {
    clear(host);
    const body = el("div");
    host.appendChild(body);
    const date = day || window.NUT.today();

    const reload = () => render(host);

    guard(async () => {
      const { N, SLOT, n0, n1 } = window.NUT;
      const [log, goals] = await Promise.all([N().log(date), N().goals()]);
      clear(body);

      // date bar
      const nav = el("div.row", { style: "gap:8px;align-items:center;flex-wrap:wrap" }, [
        el("button.btn-sm", { onclick: () => { day = shift(date, -1); reload(); }, text: "◀" }),
        el("input.mform-input", { type: "date", value: date, style: "width:auto",
          onchange: (e) => { day = e.target.value; reload(); } }),
        el("button.btn-sm", { onclick: () => { day = shift(date, 1); reload(); }, text: "▶" }),
        date !== window.NUT.today()
          ? el("button.btn-sm", { onclick: () => { day = null; reload(); }, text: "today" }) : null,
        el("span", { style: "flex:1" }),
        el("button.btn-sm", { onclick: () => copyModal(date, reload), text: "⧉ copy a day" }),
        el("button.btn-sm", { onclick: () => bulkModal(date, reload), text: "⇥ bulk paste" }),
      ]);
      body.appendChild(nav);

      const t = log.totals || {};
      body.appendChild(el("div.row", { style: "gap:14px;margin:10px 0;flex-wrap:wrap" }, [
        el("span.mono", { style: "color:" + window.NUT.GREEN,
          text: n0(t.calories) + " / " + n0(goals.daily_calories) + " cal" }),
        el("span.mono", { style: "font-size:11px;color:var(--dim)",
          text: "P " + n1(t.protein) + "  ·  C " + n1(t.carbs) + "  ·  F " + n1(t.fat) }),
      ]));

      const bySlot = {};
      (log.slots || []).forEach((s) => { bySlot[s.meal_slot] = s; });
      const order = window.NUT.SLOTS.map((s) => s.key)
        .concat(Object.keys(bySlot).filter((k) => !window.NUT.SLOTS.some((s) => s.key === k)));

      order.forEach((key) => {
        const meta = SLOT(key);
        const slot = bySlot[key];
        const entries = slot ? slot.entries : [];
        const open = !collapsed[key];
        const card = el("div.card", { style: "margin-bottom:10px" });
        card.appendChild(el("div.spread", { style: "cursor:pointer",
          onclick: () => { collapsed[key] = open; reload(); } }, [
          el("div.row", { style: "gap:8px;align-items:baseline" }, [
            el("span.dd-caret", { text: open ? "▾" : "▸" }),
            el("span", { text: meta.icon }),
            el("strong", { text: meta.label }),
            entries.length ? el("span.sub", { style: "font-size:11px", text: entries.length + " item" + (entries.length === 1 ? "" : "s") }) : null,
          ]),
          el("span.mono", { style: "font-size:12px;color:" + (slot ? window.NUT.GREEN : "var(--muted)"),
            text: slot ? n0(slot.calories) + " cal" : "—" }),
        ]));
        if (!open) { body.appendChild(card); return; }

        entries.forEach((e) => {
          card.appendChild(el("div.nt-entry", {}, [
            el("div", { style: "flex:1;min-width:0" }, [
              el("div", { text: e.food_name || "(unnamed)" }),
              el("div.sub", { style: "font-size:10.5px",
                text: n1(e.serving_size) + " " + (e.serving_unit || "")
                  + "  ·  P" + n1(e.protein) + " C" + n1(e.carbs) + " F" + n1(e.fat)
                  + (e.time ? "  ·  " + e.time : "") }),
            ]),
            el("span.mono", { style: "font-size:12px", text: n0(e.calories) + " cal" }),
            el("button.btn-sm.btn-danger", { title: "remove", text: "×",
              onclick: () => confirmDo("Remove “" + (e.food_name || "entry") + "”?", async () => {
                await window.NUT.N().delEntry(e.id); toast("removed"); reload();
              }) }),
          ]));
        });

        card.appendChild(el("div.row", { style: "gap:6px;margin-top:8px;flex-wrap:wrap" }, [
          el("button.btn-sm.btn-primary", { onclick: () => addFoodModal(key, date, reload), text: "+ add food" }),
        ]));
        card.appendChild(quickAddRow(key, date, reload));
        body.appendChild(card);
      });
    });
  }

  window.NUT_TABS = window.NUT_TABS || [];
  window.NUT_TABS.push({ key: "log", label: "Food Log", order: 20, render });
})();
