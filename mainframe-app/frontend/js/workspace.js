/* workspace.js — per-paper reading workspace: instances (v1/v2…), highlights
   tagged knew/new/rethink/implement, and terms with 0-10 familiarity sliders. */
(function () {
  const { el, clear, toast, guard, confirmDo, famClass } = window.ui;
  const api = window.api;

  // image widget for one row/entity, returned as a child node
  function imgHost(id, surface) {
    const host = el("div");
    window.Images.mount(host, { module: "synapse", contextId: id, surface, title: "Images" });
    return host;
  }


  let activeInstance = null;

  function needPaper(view) {
    view.appendChild(el("div.empty", { text: "Select a paper (left panel) to open its workspace." }));
  }

  // ---- dictionary quick-check / quick-add (any word → entry, exists-check) ----
  function dictWidget() {
    const wrap = el("div.card");
    wrap.appendChild(el("h3", { text: "Dictionary — check / add a word" }));
    wrap.appendChild(el("div.sub", { style: "margin-top:2px", text: "Type any word to see if it's in your Dictionary, or add it (definition optional)." }));
    const nameIn = el("input", { placeholder: "a word or term…", style: "flex:1;min-width:160px" });
    const result = el("div", { style: "margin-top:10px" });

    async function check() {
      const name = nameIn.value.trim();
      if (!name) return;
      const r = await guard(() => api.dictionary.lookup(name));
      clear(result);
      if (r.exists) {
        const t = r.term;
        result.appendChild(el("div", { style: "padding:8px 0" }, [
          el("div.row", {}, [ el("span.tag.knew", { text: "✓ in dictionary" }), el("span", { style: "font-weight:600", text: t.name }) ]),
          el("div.sub", { style: "margin-top:4px", text: t.definition || t.eli5 || "(no definition saved yet)" }),
        ]));
      } else {
        const defIn = el("textarea", { placeholder: "definition (optional — leave blank to fill later)", rows: "2", style: "width:100%;margin-top:8px" });
        result.appendChild(el("div", { style: "padding:6px 0" }, [
          el("div.sub", { text: "“" + name + "” isn't in the Dictionary yet." }),
          defIn,
          el("div.row", { style: "margin-top:8px" }, [
            el("button.btn-sm.btn-primary", { onclick: () => guard(async () => {
              await api.dictionary.create({ name, definition: defIn.value.trim() || null });
              toast("added “" + name + "” to Dictionary");
              nameIn.value = ""; clear(result);
            }), text: "+ add to Dictionary" }),
          ]),
        ]));
      }
    }
    nameIn.addEventListener("keydown", (e) => { if (e.key === "Enter") check(); });
    wrap.appendChild(el("div.row", { style: "margin-top:10px" }, [ nameIn, el("button.btn-sm", { onclick: check, text: "check" }) ]));
    wrap.appendChild(result);
    return wrap;
  }

  // ---- screenshots / figures / annotations attached to this paper ----
  function imagesWidget(paper) {
    const wrap = el("div.card");
    wrap.appendChild(el("h3", { text: "📷 Images" }));
    wrap.appendChild(el("div.sub", { style: "margin-top:2px", text: "Screenshots, figures, annotations — attached to this paper." }));
    window.Images.mount(wrap, { module: "synapse", contextId: paper.id, surface: "synapse-paper" });
    return wrap;
  }

  // ---- quick mind-dump linked to this paper ----
  function mindWidget(paper) {
    const wrap = el("div.card");
    wrap.appendChild(el("h3", { text: "🧠 Mind dump" }));
    wrap.appendChild(el("div.sub", { style: "margin-top:2px", text: "Stick an idea or “come look at this” — linked to this paper." }));
    const textIn = el("textarea", { rows: "2", placeholder: "quick thought…", style: "width:100%;margin-top:8px" });
    const kindSel = el("select", {}, [["idea", "idea"], ["look-at", "look at"], ["note", "note"]].map(([v, t]) => el("option", { value: v, text: t })));
    const add = el("button.btn-sm.btn-primary", { text: "stick it", onclick: () => guard(async () => {
      if (!textIn.value.trim()) return toast("write something first", true);
      await api.post("/api/mind", { text: textIn.value.trim(), kind: kindSel.value, paper_id: paper.id });
      textIn.value = ""; toast("→ added to Mind Dump");
    }) });
    wrap.appendChild(textIn);
    wrap.appendChild(el("div.row", { style: "margin-top:8px" }, [kindSel, add]));
    return wrap;
  }

  // ---- terms ----
  async function termsSection(paperId) {
    const wrap = el("div.card");
    let hideOptional = false;
    wrap.appendChild(el("div.spread", {}, [
      el("h3", { text: "Terms & familiarity (0–10)" }),
      el("button.btn-sm", { onclick: () => suggestTerms(paperId), text: "✦ suggest (local LLM)" }),
    ]));
    const filterCb = el("input", { type: "checkbox" });
    filterCb.addEventListener("change", () => { hideOptional = filterCb.checked; reload(); });
    wrap.appendChild(el("label.sub", { style: "display:flex;gap:6px;align-items:center;cursor:pointer;margin-top:6px" }, [
      filterCb, document.createTextNode("hide optional / review-later"),
    ]));
    const list = el("div", { style: "margin-top:10px" });
    wrap.appendChild(list);

    async function reload() {
      let terms = await guard(() => api.get("/api/synapse/terms?paper_id=" + paperId));
      if (hideOptional) terms = terms.filter((t) => !t.optional);
      clear(list);
      if (!terms.length) list.appendChild(el("div.sub", { text: "No terms yet." }));
      terms.forEach((t) => list.appendChild(termRow(t, paperId, reload)));
    }
    // add-term form
    const nameIn = el("input", { placeholder: "term", style: "width:130px" });
    const defIn = el("input", { placeholder: "definition (optional)", style: "flex:1;min-width:130px" });
    const famIn = el("input", { type: "number", min: "0", max: "10", value: "0", style: "width:56px" });
    const optCb = el("input", { type: "checkbox", title: "mark optional / review later" });
    wrap.appendChild(el("div.row", { style: "margin-top:12px" }, [
      nameIn, defIn, famIn,
      el("label.sub", { style: "display:flex;gap:4px;align-items:center", title: "optional / review later" }, [optCb, document.createTextNode("opt")]),
      el("button.btn-sm", { onclick: () => guard(async () => {
        if (!nameIn.value.trim()) return;
        await api.post("/api/synapse/terms?paper_id=" + paperId, { name: nameIn.value.trim(), definition: defIn.value.trim() || null, familiarity: +famIn.value, optional: optCb.checked });
        nameIn.value = ""; defIn.value = ""; famIn.value = "0"; optCb.checked = false; reload();
      }), text: "+ add" }),
    ]));
    await reload();
    return wrap;
  }

  function termRow(t, paperId, reload) {
    const val = el("span.fam." + famClass(t.familiarity), { text: String(t.familiarity) });
    const slider = el("input", { type: "range", min: "0", max: "10", value: String(t.familiarity) });
    let timer = null;
    slider.addEventListener("input", () => {
      val.textContent = slider.value; val.className = "fam " + famClass(+slider.value);
      clearTimeout(timer);
      timer = setTimeout(() => guard(() => api.patch("/api/synapse/terms/" + t.id, { familiarity: +slider.value })), 350);
    });
    const optBtn = el("button.btn-sm" + (t.optional ? ".opt-on" : ""), {
      title: "toggle optional / review-later",
      onclick: () => guard(async () => { await api.patch("/api/synapse/terms/" + t.id, { optional: !t.optional }); reload(); }),
      text: t.optional ? "★ opt" : "☆ opt",
    });
    return el("div", { style: "padding:6px 0;border-bottom:1px solid var(--border)" }, [
      el("div.spread", {}, [
        el("div", {}, [
          el("span", { text: t.name }),
          t.optional ? el("span.tk-tag", { style: "background:var(--amber-d);color:var(--amber);margin-left:6px", text: "optional" }) : null,
          t.domain ? el("span.sub", { text: "  · " + t.domain }) : null,
        ]),
        el("div.row", {}, [ slider, val, optBtn,
          el("button.btn-sm", { title: "add to Dictionary", onclick: () => guard(async () => {
            const r = await api.dictionary.fromConcept({
              name: t.name, definition: t.definition || null, domain: t.domain || null,
              familiarity: t.familiarity, type: "term",
            });
            toast(r && r._already ? t.name + " already in dictionary" : "→ added " + t.name + " to Dictionary");
          }), text: "→ Dict" }),
          el("button.btn-sm.btn-danger", { onclick: () => guard(async () => {
            await api.del("/api/synapse/terms/" + t.id + "?paper_id=" + paperId); reload();
          }), text: "×" }) ]),
      ]),
      t.definition ? el("div.sub", { style: "margin-top:2px", text: t.definition }) : null,
      imgHost(t.id, "synapse-term"),
    ]);
  }

  async function suggestTerms(paperId) {
    toast("asking local LLM…");
    const form = new FormData();
    const cands = await guard(() => api.postForm("/api/synapse/terms/suggest?paper_id=" + paperId, form));
    if (!cands.length) { toast("no suggestions (LLM offline?)", true); return; }
    for (const c of cands) {
      await api.post("/api/synapse/terms?paper_id=" + paperId, { name: c.name, definition: c.definition, domain: c.domain, familiarity: 0 });
    }
    toast("added " + cands.length + " candidate terms");
    window.Views.workspace.render(document.getElementById("view"), window.PM);
  }

  // ---- highlights ----
  function highlightRow(h, reload) {
    return el("div", { style: "padding:8px 0;border-bottom:1px solid var(--border)" }, [
      el("div.spread", {}, [
        el("div.row", {}, [ el("span.tag." + h.tag, { text: h.tag }), h.section ? el("span.sub", { text: h.section }) : null, h.page ? el("span.sub", { text: "p." + h.page }) : null ]),
        el("button.btn-sm.btn-danger", { onclick: () => guard(async () => { await api.del("/api/synapse/highlights/" + h.id); reload(); }), text: "×" }),
      ]),
      h.excerpt ? el("div", { style: "margin-top:4px", text: h.excerpt }) : null,
      h.my_note ? el("div.sub", { style: "margin-top:2px", text: "▸ " + h.my_note }) : null,
      imgHost(h.id, "synapse-highlight"),
    ]);
  }

  async function highlightsSection(instanceId) {
    const wrap = el("div.card", { style: "margin-top:14px" });
    wrap.appendChild(el("h3", { text: "Highlights" }));
    const list = el("div"); wrap.appendChild(list);
    async function reload() {
      const hs = await guard(() => api.get("/api/synapse/highlights?instance_id=" + instanceId));
      clear(list);
      if (!hs.length) list.appendChild(el("div.sub", { text: "No highlights yet." }));
      hs.forEach((h) => list.appendChild(highlightRow(h, reload)));
    }
    const excerpt = el("input", { placeholder: "excerpt", style: "flex:1;min-width:160px" });
    const note = el("input", { placeholder: "your note", style: "flex:1;min-width:120px" });
    const section = el("input", { placeholder: "§", style: "width:60px" });
    const page = el("input", { type: "number", placeholder: "pg", style: "width:56px" });
    const tag = el("select", {}, ["knew","new","rethink","implement"].map((t) => el("option", { value: t, text: t })));
    tag.value = "new";
    wrap.appendChild(el("div.row", { style: "margin-top:10px" }, [ tag, section, page, excerpt, note,
      el("button.btn-sm", { onclick: () => guard(async () => {
        await api.post("/api/synapse/highlights?instance_id=" + instanceId, {
          tag: tag.value, section: section.value, page: page.value ? +page.value : null,
          excerpt: excerpt.value, my_note: note.value });
        excerpt.value = note.value = section.value = page.value = ""; reload();
      }), text: "+ add" }) ]));
    await reload();
    return wrap;
  }

  /* Whether the active pass's form is showing. Kept outside the function so it
     survives the re-render that follows a save, and in localStorage so a paper
     you're only reading — not logging — stays uncluttered between visits. */
  const LOG_OPEN_KEY = "mf.workspace.sessionOpen";
  const logOpen = () => localStorage.getItem(LOG_OPEN_KEY) !== "0";
  const setLogOpen = (v) => localStorage.setItem(LOG_OPEN_KEY, v ? "1" : "0");

  // ---- reading-session log for the active instance ----
  function sessionLog(inst, view, instCount) {
    const box = el("div", { style: "margin-top:14px;padding-top:12px;border-top:1px solid var(--border)" });
    window.Images.mount(box, { module: "synapse", contextId: inst.id, surface: "synapse-instance", title: "Session images" });
    box.appendChild(el("div.sub", { style: "margin-bottom:8px", text: "Session log — v" + inst.version + (inst.created_at ? " · started " + (inst.created_at || "").slice(0, 10) : "") }));
    const purpose = el("input", { value: inst.purpose || "", placeholder: "purpose (e.g. revisit)", style: "flex:1;min-width:120px" });
    const readDate = el("input", { type: "date", value: (inst.read_date || "").slice(0, 10) });

    // --- structured timing: started / ended / spent, split active vs passive,
    // and how many times you got pulled away. Blank or 0 where it doesn't fit.
    const num = (v, w) => el("input", { type: "number", min: "0", value: v || 0, style: "width:" + (w || 68) + "px" });
    const start = el("input", { type: "time", value: inst.start || "" });
    const end = el("input", { type: "time", value: inst.end || "" });
    const mins = num(inst.mins, 76);
    const activeMins = num(inst.active_mins);
    const passiveMins = num(inst.passive_mins);
    const distractions = num(inst.distractions);

    // clock times fill the duration in, until you type one yourself
    let minsTouched = !!(inst.mins && !(inst.start && inst.end));
    mins.addEventListener("input", () => { minsTouched = true; splitNote(); });
    const syncMins = () => {
      if (!minsTouched && start.value && end.value) {
        const p = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
        let d = p(end.value) - p(start.value);
        if (d < 0) d += 1440;                        // ran past midnight
        mins.value = d;
      }
      splitNote();
    };
    start.addEventListener("change", syncMins);
    end.addEventListener("change", syncMins);
    [activeMins, passiveMins].forEach((n) => n.addEventListener("input", splitNote));

    // a quiet nudge when active+passive doesn't line up with the total
    const note = el("span.sub", { style: "font-size:10px" });
    function splitNote() {
      const total = Number(mins.value) || 0;
      const split = (Number(activeMins.value) || 0) + (Number(passiveMins.value) || 0);
      if (!total && !split) { note.textContent = ""; return; }
      if (split === total) { note.textContent = "✓ splits add up"; note.style.color = "var(--teal)"; return; }
      note.textContent = split > total ? "split is " + (split - total) + "m over the total"
        : (total - split) + "m unaccounted";
      note.style.color = "var(--muted)";
    }
    splitNote();

    /* Distractions as a list — one row per interruption, each saying what it
       was. A count says the session went badly; the entries say what to change,
       which is the part worth pushing into Learning. */
    const distList = el("div.dist-list");
    const distRows = [];
    function addDist(value, focus) {
      const input = el("input", { placeholder: "what pulled you away — phone, noise, hunger…",
        style: "flex:1;min-width:180px", value: value || "" });
      const row = el("div.row", { style: "gap:6px;margin-top:6px" }, [
        el("span.dist-n", { text: String(distRows.length + 1) }),
        input,
        // Push THIS distraction on its own. The whole-set button below sends
        // them together as one entry; this one keeps a single recurring
        // interruption as its own kind, which is what repeat detection needs.
        el("button.btn-sm", { title: "log just this one to Learning", text: "↗", onclick: () => {
          const v = input.value.trim();
          if (!v) return toast("write what it was first", true);
          learningPushModal({
            kind: v,
            what: "distracted by " + v + " while reading v" + inst.version
              + (window.PM && window.PM.paper ? " (" + window.PM.paper.title + ")" : ""),
            when: (readDate.value || "").slice(0, 10) || undefined,
          });
        } }),
        el("button.btn-sm.btn-danger", { title: "remove", text: "×", onclick: () => {
          const i = distRows.findIndex((r) => r.input === input);
          if (i >= 0) distRows.splice(i, 1);
          row.remove(); renumber(); syncCount();
        } }),
      ]);
      distRows.push({ input, row });
      distList.appendChild(row);
      renumber(); syncCount();
      if (focus) input.focus();
    }
    const renumber = () => distRows.forEach((r, i) => { r.row.querySelector(".dist-n").textContent = String(i + 1); });
    // The count is still yours to set — you might be pulled away five times and
    // only bother describing three — but it can never sit below what you've
    // actually listed.
    const syncCount = () => {
      if ((Number(distractions.value) || 0) < distRows.length) distractions.value = distRows.length;
    };
    const distValues = () => distRows.map((r) => r.input.value.trim()).filter(Boolean);
    (inst.distraction_items || []).forEach((d) => addDist(d));
    const addDistBtn = el("button.btn-sm", { text: "+ add distraction", onclick: () => addDist("", true) });
    const lookInto = el("textarea", { rows: "2", placeholder: "to look into later — sections to reread, terms to check…", style: "width:100%;margin-top:8px" });
    lookInto.value = inst.look_into || "";

    const notes = el("textarea", { rows: "3", placeholder: "When you read it, what you took away — fill in info…", style: "width:100%;margin-top:8px" });
    notes.value = inst.notes || "";
    const save = el("button.btn-sm.btn-primary", { text: "save session", onclick: () => guard(async () => {
      await api.patch("/api/synapse/instances/" + inst.id, {
        purpose: purpose.value.trim() || inst.purpose || "revisit",
        read_date: readDate.value || null,
        start: start.value || "",
        end: end.value || "",
        mins: Number(mins.value) || 0,
        active_mins: Number(activeMins.value) || 0,
        passive_mins: Number(passiveMins.value) || 0,
        distractions: Number(distractions.value) || 0,
        distraction_items: distValues(),
        look_into: lookInto.value.trim(),
        notes: notes.value.trim() || null,
      });
      toast("session saved"); rerender(view);
    }) });

    /* Push the distractions into Learning.
       Learning groups repeats by `kind`, and that's the whole point of it — so
       the distraction types become the kind, and the count and session become
       the description. Pre-filled and editable rather than posted silently,
       because "phone" logged from here should read the same as "phone" logged
       anywhere else or the repeat detection can't see it. */
    const learnBtn = el("button.btn-sm", { title: "log these distractions as a learning opportunity", text: "↗ push to learning",
      onclick: () => {
        const items = distValues();
        const count = Number(distractions.value) || 0;
        if (!items.length && !count) return toast("record a distraction count or entry first", true);
        learningPushModal({
          // Learning groups repeats by `kind`, so the first entry becomes it —
          // the rest are detail. One kind per entry would fragment the grouping.
          kind: items[0] || "distraction",
          what: (count ? count + " distraction" + (count === 1 ? "" : "s") : "distracted")
            + " while reading v" + inst.version
            + (items.length ? " — " + items.join("; ") : "")
            + (window.PM && window.PM.paper ? " (" + window.PM.paper.title + ")" : ""),
          when: (readDate.value || "").slice(0, 10) || undefined,
        });
      } });

    const field = (label, node) => el("label.wl-field", {}, [el("span.wl-label", { text: label }), node]);
    box.appendChild(el("div.row", { style: "gap:10px;flex-wrap:wrap" }, [
      field("purpose", purpose), field("read on", readDate),
    ]));
    // One button walks started → ended, so a session can be bracketed without
    // typing a clock time at all. syncMins turns that into the duration.
    const stamp = window.ui.stampPair(start, end, { onChange: syncMins });
    box.appendChild(el("div.row", { style: "gap:10px;margin-top:8px;flex-wrap:wrap;align-items:flex-end" }, [
      field("started", start), field("ended", end), stamp,
      field("time spent (m)", mins),
      field("active (m)", activeMins), field("passive (m)", passiveMins),
      field("distractions", distractions),
      note,
    ]));
    box.appendChild(lookInto);
    box.appendChild(notes);
    // Distractions sit after the write-up: what you took away is the point of
    // the session, what interrupted it is the postscript.
    box.appendChild(el("div", { style: "margin-top:10px" }, [
      el("div.row", { style: "gap:8px;align-items:center" }, [
        el("span.wl-label", { text: "what the distractions were" }), addDistBtn, learnBtn,
      ]),
      distList,
    ]));

    /* Push this reading session into the work database.
       The shapes don't map one-to-one — a work row carries a single `focus`
       while a reading instance splits its minutes across active and passive,
       and it counts distractions rather than timing them. So this pre-fills
       the form (focus = whichever side dominates, the split and the count
       carried into the notes) and lets you adjust before saving, instead of
       guessing silently. */
    const pushHost = el("div");
    const pushBtn = window.WorkLog.button({
      mountInto: pushHost,
      module: "synapse",
      ref_kind: "paper",
      ref_id: (window.PM && window.PM.paper) ? window.PM.paper.id : null,
      ref_title: (window.PM && window.PM.paper) ? window.PM.paper.title : "",
      lockRef: true,
      session: {
        date: (inst.read_date || "").slice(0, 10) || undefined,
        start: inst.start || "",
        end: inst.end || "",
        mins: inst.mins || 0,
        focus: (inst.active_mins || 0) >= (inst.passive_mins || 0)
          ? ((inst.active_mins || 0) > 0 ? "active" : "none")
          : "passive",
        what: "read v" + inst.version + (inst.purpose ? " — " + inst.purpose : ""),
        notes: [
          (inst.active_mins || inst.passive_mins)
            ? "active " + (inst.active_mins || 0) + "m · passive " + (inst.passive_mins || 0) + "m" : "",
          inst.distractions ? inst.distractions + " distractions" : "",
          (inst.notes || "").trim(),
        ].filter(Boolean).join(" · "),
      },
    }, () => { toast("pushed to database"); }, "⤴ push to database");

    const del = el("button.btn-sm.btn-danger", {
      title: "delete this pass — annotations and notes only; the original paper and the auto-KG are untouched",
      onclick: () => deletePass(inst, instCount, view),
      text: "delete pass",
    });

    box.appendChild(el("div.row", { style: "margin-top:8px;gap:6px" }, [save, pushBtn, del]));
    box.appendChild(pushHost);
    return box;
  }

  /* Pre-filled learning entry. Same shape the Learning tab writes, so a
     distraction logged from here is grouped with the same kind logged there.
     Exposed as window.LearningPush so the project cards and deep dives log the
     same way — one modal, one wording, one set of fields. */
  window.LearningPush = learningPushModal;
  function learningPushModal(seed) {
    const overlay = el("div.modal-overlay");
    const close = () => overlay.remove();
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });

    const kind = el("input.mform-input", { value: seed.kind || "" });
    const what = el("textarea.mform-input", { rows: "3" });
    what.value = seed.what || "";
    const action = el("textarea.mform-input", { rows: "2", placeholder: "what will you do about it? (optional)" });
    const when = el("input.mform-input", { type: "date", value: seed.when || window.ui.todayISO() });
    const fld = (label, node) => el("div.mform-full", {}, [el("div.mform-label", { text: label }), node]);

    const save = () => guard(async () => {
      if (!what.value.trim()) return toast("describe what happened", true);
      await api.post("/api/learning", {
        kind: kind.value.trim(), what_happened: what.value.trim(),
        detail: (seed.detail || "").trim(),
        occurred_at: when.value || null, module: seed.module || "synapse",
        action: action.value.trim(), status: "open",
      });
      toast("logged to Learning");
      close();
    });

    const card = el("div.modal", {}, [
      el("div.modal-title", { text: "Log to Learning" }),
      el("div.sub", { style: "margin:-8px 0 14px", text: "Repeats are grouped by kind — keep the wording consistent and Learning can show whether the gaps are widening." }),
      fld("Kind (what groups repeats)", kind),
      fld("What happened", what),
      fld("Action", action),
      fld("When", when),
      el("div.row", { style: "margin-top:16px;gap:8px" }, [
        el("button.tk-btn.teal", { text: "Log it", onclick: save }),
        el("button.tk-btn", { text: "Cancel", onclick: close }),
      ]),
    ]);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    kind.focus(); kind.select();
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") save();
    });
  }

  /* A pass starts with intent: what it's for, and what you already know you
     want to come back to. Written up front rather than remembered afterwards —
     it lands in the Master Instance as its own block. */
  function newInstanceModal(paper, view) {
    const overlay = el("div.modal-overlay");
    const close = () => overlay.remove();
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });

    const purpose = el("input.mform-input", { value: "revisit", placeholder: "e.g. first read, revisit, implement" });
    const look = el("textarea.mform-input", { rows: "3",
      placeholder: "anything you already want to come back to — a section to reread, a proof to check, a term to look up" });
    const fld = (label, node) => el("div.mform-full", {}, [el("div.mform-label", { text: label }), node]);

    const create = () => guard(async () => {
      const inst = await api.post("/api/synapse/instances?paper_id=" + paper.id, {
        purpose: purpose.value.trim() || "revisit",
        coverage_pre: 0,
        look_into: look.value.trim() || null,
      });
      activeInstance = inst.id;
      toast("created v" + inst.version);
      close();
      rerender(view);
    });

    const card = el("div.modal", {}, [
      el("div.modal-title", { text: "New reading pass" }),
      fld("Purpose", purpose),
      fld("To look into later", look),
      el("div.row", { style: "margin-top:16px;gap:8px" }, [
        el("button.tk-btn.teal", { text: "Create pass", onclick: create }),
        el("button.tk-btn", { text: "Cancel", onclick: close }),
      ]),
    ]);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    purpose.focus(); purpose.select();
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }   // else app.js goes home
      if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") create();
    });
  }

  /* Delete one reading pass. Its highlights and notes go with it; the original
     PDF in the vault and the frozen auto-KG do not. Shared by the chip's × and
     the button inside the session form so the warning can't drift between them. */
  function deletePass(inst, total, view) {
    return confirmDo(
      "Delete reading pass v" + inst.version + (inst.purpose ? " (" + inst.purpose + ")" : "") + "?\n\n"
      + "This removes that pass's highlights and notes"
      + (total === 1 ? ", leaving this paper with no passes" : "") + ".\n"
      + "The original paper in your vault and the frozen auto-KG are NOT touched.",
      async () => {
        await api.del("/api/synapse/instances/" + inst.id);
        // Selecting a deleted pass would render an empty form; let the next
        // render pick the newest one instead.
        if (activeInstance === inst.id) activeInstance = null;
        toast("v" + inst.version + " deleted");
        rerender(view);
      });
  }

  // ---- instances ----
  async function instancesSection(paper, view) {
    const wrap = el("div.card");
    wrap.appendChild(el("div.spread", {}, [
      el("h3", { text: "Reading instances" }),
      el("button.btn-sm.btn-primary", { onclick: () => newInstanceModal(paper, view), text: "+ new instance" }),
    ]));
    const insts = await guard(() => api.get("/api/synapse/instances?paper_id=" + paper.id));
    if (!activeInstance && insts.length) activeInstance = insts[insts.length - 1].id;
    const chips = el("div.row", { style: "margin-top:10px;flex-wrap:wrap" });
    // ◀ ▶ swap a pass with its neighbour. `version` never moves — it records
    // which read came first — only the on-screen order does.
    const move = (idx, dir) => guard(async () => {
      const a = insts[idx], b = insts[idx + dir];
      if (!a || !b) return;
      // The pair must be listed in the order you want them to end up — reorder()
      // assigns the slots these nodes already hold, in the order given. Passing
      // [b, a] to move `a` EARLIER just restates the existing order: a no-op.
      await api.post("/api/synapse/instances/reorder",
        { ids: dir < 0 ? [a.id, b.id] : [b.id, a.id] });
      rerender(view);
    });
    insts.forEach((i, idx) => {
      const grp = el("div.row", { style: "gap:0;align-items:stretch" }, [
        el("button.btn-sm.ins-move", { title: "move earlier", disabled: idx === 0,
          onclick: (e) => { e.stopPropagation(); move(idx, -1); }, text: "◀" }),
        el("button.btn-sm" + (i.id === activeInstance ? ".btn-primary" : ""), {
          // Clicking the pass you're already on folds its form away — the boxes
          // are for logging, and you don't want them in the way while reading.
          onclick: () => {
            if (i.id === activeInstance) setLogOpen(!logOpen());
            else activeInstance = i.id;
            rerender(view);
          },
          title: i.id === activeInstance
            ? (logOpen() ? "hide this pass's boxes" : "show this pass's boxes")
            : (i.look_into ? "look into: " + i.look_into : "open this pass"),
          text: "v" + i.version + " · " + i.purpose + (i.look_into ? " ⌛" : "")
              + (i.id === activeInstance ? (logOpen() ? "  ▾" : "  ▸") : ""),
        }),
        el("button.btn-sm.ins-move", { title: "move later", disabled: idx === insts.length - 1,
          onclick: (e) => { e.stopPropagation(); move(idx, 1); }, text: "▶" }),
        // Delete lives on the chip as well as inside the form — the form can be
        // folded away, and you shouldn't have to open a pass to get rid of it.
        el("button.btn-sm.btn-danger.ins-del", {
          title: "delete pass v" + i.version + " — its highlights and notes only",
          onclick: (e) => { e.stopPropagation(); deletePass(i, insts.length, view); },
          text: "×",
        }),
      ]);
      chips.appendChild(grp);
    });
    if (!insts.length) chips.appendChild(el("div.sub", { text: "No instances — create one to start annotating." }));
    wrap.appendChild(chips);
    const active = insts.find((i) => i.id === activeInstance);
    // Folded away, the pass is still selected — highlights below still belong to
    // it. Only the logging form is hidden.
    if (active && logOpen()) wrap.appendChild(sessionLog(active, view, insts.length));
    else if (active) wrap.appendChild(el("div.sub", { style: "margin-top:10px",
      text: "Session boxes hidden — click v" + active.version + " again to show them." }));
    return { wrap, hasInstance: !!activeInstance };
  }

  /* ---- has time been logged for what you've done? ----------------------
     Two records already exist and were never compared: the activity log (what
     you DID to this paper) and the work database (what you LOGGED). Anything
     done after the last session you logged is time that isn't in the database.
     Nothing here is written or guessed — it's derived and read-only. */
  function timeCheck(paper, view) {
    const host = el("div", { style: "margin-bottom:12px" });
    guard(async () => {
      const g = await api.work.gap(paper.id);
      clear(host);
      const logged = window.WorkLog.fmtMins(g.total_mins || 0);

      if (!g.unlogged_count) {
        // Nothing outstanding — say so quietly rather than showing nothing, so
        // "no banner" never has to mean "we didn't check".
        host.appendChild(el("div.tc-ok", {}, [
          el("span", { text: "✓" }),
          el("span", { text: g.sessions
            ? "All work here is logged — " + logged + " across " + g.sessions
              + " session" + (g.sessions === 1 ? "" : "s") + "."
            : "Nothing logged yet, and nothing outstanding." }),
        ]));
        return;
      }

      const pushHost = el("div");
      const list = el("div.tc-list");
      let open = false;
      const toggle = el("button.btn-sm", { text: "show what" });
      toggle.addEventListener("click", () => {
        open = !open;
        toggle.textContent = open ? "hide" : "show what";
        clear(list);
        if (!open) return;
        g.unlogged.slice(0, 12).forEach((e) => list.appendChild(el("div.tc-row", {}, [
          el("span.mono.tc-when", { text: (e.timestamp || "").slice(0, 16).replace("T", " ") }),
          el("span.tk-tag", { style: "background:var(--raised);color:var(--dim)", text: e.category || "—" }),
          el("span", { text: e.action || "" }),
          e.detail ? el("span.sub", { style: "opacity:.7", text: "· " + String(e.detail).slice(0, 44) }) : null,
        ])));
        if (g.unlogged_count > 12) {
          list.appendChild(el("div.sub", { style: "font-size:10.5px;margin-top:4px",
            text: "…and " + (g.unlogged_count - 12) + " more" }));
        }
      });

      host.appendChild(el("div.tc-warn", {}, [
        el("div.row", { style: "gap:8px;align-items:center;flex-wrap:wrap" }, [
          el("span", { text: "⏱" }),
          el("span", { text: g.unlogged_count + " thing" + (g.unlogged_count === 1 ? "" : "s")
            + " done here since you last logged time"
            + (g.last_logged_at ? " (" + g.last_logged_at.slice(0, 10) + ")" : " — nothing logged yet") }),
          el("span.sub", { style: "font-size:11px", text: g.sessions ? logged + " logged so far" : "" }),
          el("span", { style: "flex:1" }),
          toggle,
          window.WorkLog.button({
            mountInto: pushHost, module: "synapse", ref_kind: "paper",
            ref_id: paper.id, ref_title: paper.title, lockRef: true,
          }, () => rerender(view), "+ log it now"),
        ]),
        list, pushHost,
      ]));
    });
    return host;
  }

  /* ---- Master Instance ------------------------------------------------
     Read-only and auto-generated: everything written about this paper across
     every reading pass, in one scrollable document. You never author it — it
     assembles itself from the passes, so deleting a pass removes its blocks. */
  const MI_COLOR = {
    highlight: "var(--teal)", "session note": "var(--blue)", concept: "var(--amber)",
    idea: "var(--purple)", question: "var(--red)",
    "look into": "var(--amber)", distractions: "var(--red)",
  };

  function masterInstanceSection(paper) {
    const wrap = el("div.card");
    let open = false;
    const body = el("div");
    const btn = el("button.btn-sm", { onclick: () => { open = !open; draw(); }, text: "▸ open" });
    wrap.appendChild(el("div.spread", {}, [
      el("div", {}, [
        el("h3", { style: "margin:0", text: "Master Instance" }),
        el("div.sub", { text: "Auto-generated · read-only · every pass merged into one document" }),
      ]),
      btn,
    ]));
    wrap.appendChild(body);

    function draw() {
      clear(body);
      btn.textContent = open ? "▾ close" : "▸ open";
      if (!open) return;
      body.appendChild(el("div.sub", { style: "margin-top:10px", text: "building…" }));
      guard(async () => {
        const m = await api.get("/api/synapse/instances/master?paper_id=" + paper.id);
        clear(body);
        const stat = (v, l, c) => el("div.prog-box", {}, [
          el("div.prog-val", { style: "color:" + c + ";font-size:18px", text: String(v) }),
          el("div.prog-label", { text: l }),
        ]);
        body.appendChild(el("div.prog-grid", { style: "margin:10px 0" }, [
          stat(m.counts.passes, "passes", "var(--blue)"),
          stat(m.counts.highlights, "highlights", "var(--teal)"),
          stat(m.counts.concepts, "concepts", "var(--amber)"),
          stat(m.counts.ideas + m.counts.dumps, "ideas & notes", "var(--purple)"),
          stat(window.WorkLog.fmtMins(m.totals.mins), "time spent", "#2de2ff"),
          stat(m.totals.distractions, "distractions", "var(--red)"),
        ]));

        // per-pass strip so you can see what each read contributed
        if (m.passes.length) {
          const strip = el("div.row", { style: "gap:6px;flex-wrap:wrap;margin-bottom:10px" });
          m.passes.forEach((p) => strip.appendChild(el("span.tk-tag", {
            style: "background:var(--raised);color:var(--blue)",
            title: (p.purpose || "") + " · " + (p.date || "no date") + " · " + p.highlight_count + " highlights",
            text: "v" + p.version + " · " + window.WorkLog.fmtMins(p.mins),
          })));
          body.appendChild(strip);
        }

        if (!m.blocks.length && !(m.log || []).length) {
          body.appendChild(el("div.empty", { text: "Nothing written yet. Highlights, session notes, concepts and ideas all flow in here." }));
          return;
        }
        const doc = el("div.mi-doc");
        m.blocks.forEach((b) => {
          const tags = [
            b.instance ? "instance " + b.instance : null,
            b.date || null,
            b.section ? "§ " + b.section : null,
            b.page ? "p." + b.page : null,
            b.mins ? window.WorkLog.fmtMins(b.mins) : null,
            b.tag || null,
          ].filter(Boolean).join("  ·  ");
          doc.appendChild(el("div.mi-block", { style: "border-left-color:" + (MI_COLOR[b.kind] || "var(--border)") }, [
            el("div.mi-meta", { text: b.kind.toUpperCase() + (tags ? "  ·  " + tags : "") }),
            b.title ? el("div.mi-title", { text: b.title }) : null,
            b.body ? el("div", { style: "white-space:pre-wrap", text: b.body }) : null,
          ]));
        });
        body.appendChild(doc);

        /* The log — what HAPPENED to this paper, as opposed to what you wrote
           about it. Kept as its own collapsed section rather than merged into
           the document above, or a single highlight would sit buried under
           twenty "updated" rows. */
        const logRows = m.log || [];
        if (logRows.length) {
          let logOpen = false;
          const logBody = el("div");
          const logBtn = el("button.btn-sm", { text: "▸ log (" + logRows.length + ")" });
          logBtn.addEventListener("click", () => {
            logOpen = !logOpen;
            logBtn.textContent = (logOpen ? "▾" : "▸") + " log (" + logRows.length + ")";
            clear(logBody);
            if (!logOpen) return;
            logRows.forEach((r) => logBody.appendChild(el("div.mi-log-row", {}, [
              el("span.mono.mi-log-when", { text: (r.timestamp || "").slice(0, 16).replace("T", " ") }),
              el("span.tk-tag", { style: "background:var(--raised);color:var(--dim)", text: r.category || "—" }),
              el("span", { text: r.action || "" }),
              r.detail ? el("span.sub", { style: "opacity:.7", text: "· " + r.detail }) : null,
            ])));
          });
          body.appendChild(el("div", { style: "margin-top:14px;padding-top:10px;border-top:1px solid var(--border)" }, [
            el("div.spread", {}, [
              el("div.sub", { text: "Everything that has happened to this paper" }), logBtn,
            ]),
            logBody,
          ]));
        }
      });
    }
    draw();
    return wrap;
  }

  // ---- references (scan → name + link, citation-map ready) ----
  // Reading state cycles as you work down a bibliography.
  const REF_STATES = ["unread", "read", "in_library", "dismissed"];
  const REF_LABEL = { unread: "unread", read: "read", in_library: "in library", dismissed: "dismissed" };
  const REF_STYLE = {
    unread: "",
    read: "text-decoration:line-through;opacity:.72",
    in_library: "color:var(--teal)",
    dismissed: "text-decoration:line-through;opacity:.4;color:var(--red)",
  };

  function refRow(r, reload) {
    const state = REF_STATES.includes(r.state) ? r.state : "unread";
    const titleEl = r.link
      ? el("a", { href: r.link, target: "_blank", rel: "noopener noreferrer", style: "color:var(--blue);" + REF_STYLE[state], text: r.title })
      : el("span", { style: REF_STYLE[state], text: r.title });

    const cycle = el("button.btn-sm", {
      title: "cycle: unread → read → in library → dismissed",
      style: state === "in_library" ? "color:var(--teal);border-color:var(--teal)"
        : state === "dismissed" ? "color:var(--red);border-color:var(--red)" : "",
      onclick: () => guard(async () => {
        const next = REF_STATES[(REF_STATES.indexOf(state) + 1) % REF_STATES.length];
        await api.patch("/api/synapse/refs/stored/" + r.id + "/state", { state: next });
        reload();
      }),
      text: REF_LABEL[state],
    });

    return el("div.spread", { style: "padding:6px 0;border-bottom:1px solid var(--border)" }, [
      el("div", { style: "min-width:0" }, [
        titleEl,
        r.year ? el("span.sub", { text: "  · " + r.year }) : null,
        r.matched_paper_id ? el("span.tk-tag", { style: "background:var(--teal-d);color:var(--teal);margin-left:6px", text: "in repo" }) : null,
        r.kg_node_id ? el("span.tk-tag", { style: "background:var(--raised);color:var(--purple);margin-left:6px", text: "on KG" }) : null,
        !r.link ? el("span.sub", { style: "margin-left:6px", text: "· no link" }) : null,
      ]),
      el("div.row", { style: "gap:6px;flex-wrap:nowrap" }, [
        cycle,
        el("button.btn-sm", {
          title: r.matched_paper_id
            ? "add to the knowledge graph and link to the matching paper"
            : "add to the knowledge graph as a cited work",
          onclick: () => guard(async () => {
            const res = await api.post("/api/synapse/refs/stored/" + r.id + "/kg");
            toast(res.linked_paper_id ? "on KG · linked to the paper in your library" : "added to KG");
            reload();
          }),
          text: "+ KG",
        }),
        el("button.btn-sm.btn-danger", { onclick: () => guard(async () => { await api.del("/api/synapse/refs/stored/" + r.id); reload(); }), text: "×" }),
      ]),
    ]);
  }

  /* Paste a bibliography as text. No LLM touches this path, so a link can only
     ever be one that literally appears in what you pasted. Preview first —
     nothing is written until you press add. */
  function bulkPasteBox(paper, reload) {
    const box = el("div", { style: "margin-top:12px;border-top:1px solid var(--border);padding-top:10px" });
    box.appendChild(el("div.spread", {}, [
      el("span.sub", { style: "text-transform:uppercase;letter-spacing:1px;font-size:10px", text: "Paste a reference list" }),
      el("span.sub", { style: "font-size:10px", text: "no LLM · links only if they appear in your text" }),
    ]));
    const ta = el("textarea.mform-input", {
      rows: "5", style: "width:100%;margin-top:6px;font-family:var(--mono);font-size:11px",
      placeholder: "Paste the whole bibliography — [1] A. Author. Title. Venue, 2007.  …or one per line, or blank-line separated.",
    });
    box.appendChild(ta);
    const preview = el("div");
    const replace = el("input", { type: "checkbox" });

    box.appendChild(el("div.row", { style: "gap:8px;margin-top:6px;flex-wrap:wrap" }, [
      el("button.btn-sm", {
        onclick: () => guard(async () => {
          if (!ta.value.trim()) return toast("paste something first", true);
          const res = await api.post("/api/synapse/refs/bulk?paper_id=" + paper.id, { text: ta.value, commit: false });
          clear(preview);
          if (!res.parsed) { preview.appendChild(el("div.sub", { text: "Couldn't find any references in that." })); return; }
          preview.appendChild(el("div.sub", { style: "margin:8px 0 4px", text: "Parsed " + res.parsed + " — check before adding:" }));
          const t = el("table.dd-sources");
          t.appendChild(el("tr", {}, [el("th", { text: "#" }), el("th", { text: "title" }), el("th", { text: "year" }), el("th", { text: "link" })]));
          res.entries.forEach((e, i) => t.appendChild(el("tr", {}, [
            el("td", { class: "mono", style: "font-size:10px;color:var(--dim)", text: String(i + 1) }),
            el("td", { text: e.title }),
            el("td", { class: "mono", style: "font-size:11px", text: e.year == null ? "—" : String(e.year) }),
            el("td", { class: "mono", style: "font-size:10px;color:var(--dim)", text: e.link || "" }),
          ])));
          preview.appendChild(el("div.grid", {}, [t]));
          preview.appendChild(el("div.row", { style: "gap:8px;margin-top:8px" }, [
            el("label.wl-check", {}, [replace, el("span", { text: " replace the existing list" })]),
            el("button.btn-primary", {
              onclick: () => guard(async () => {
                const done = await api.post("/api/synapse/refs/bulk?paper_id=" + paper.id,
                  { text: ta.value, commit: true, replace: replace.checked });
                toast((replace.checked ? "replaced with " : "added ") + done.stored + " references");
                ta.value = ""; clear(preview); reload();
              }),
              text: "add " + res.parsed + " references",
            }),
          ]));
        }),
        text: "preview",
      }),
      el("span.sub", { style: "font-size:10px", text: "parses [1] markers, numbered lists, or blank-line blocks" }),
    ]));
    box.appendChild(preview);
    return box;
  }

  async function referencesSection(paper) {
    const wrap = el("div.card", { style: "margin-top:14px" });
    wrap.appendChild(el("div.spread", {}, [
      el("h3", { text: "References" }),
      el("button.btn-sm", { onclick: () => scan(), text: "✦ scan references (local LLM)" }),
    ]));
    wrap.appendChild(el("div.sub", { style: "margin-top:2px", text: "Extract each cited work's name + link — the seed for a citation map." }));
    const list = el("div", { style: "margin-top:10px" });
    wrap.appendChild(list);

    async function reload() {
      const refs = await guard(() => api.get("/api/synapse/refs/stored?paper_id=" + paper.id));
      clear(list);
      if (!refs.length) { list.appendChild(el("div.sub", { text: "No references yet — scan the PDF or add one below." })); return; }
      list.appendChild(el("div.sub", { style: "margin-bottom:6px", text: refs.length + " references" }));
      refs.forEach((r) => list.appendChild(refRow(r, reload)));
    }
    async function scan() {
      toast("scanning references (local LLM)…");
      const res = await guard(() => api.postForm("/api/synapse/refs/scan?paper_id=" + paper.id, new FormData()));
      toast("stored " + res.count + " references"); reload();
    }
    // manual add
    const titleIn = el("input", { placeholder: "reference title / name", style: "flex:2;min-width:180px" });
    const linkIn = el("input", { placeholder: "link (URL/DOI, optional)", style: "flex:1;min-width:120px" });
    wrap.appendChild(el("div.row", { style: "margin-top:12px" }, [
      titleIn, linkIn,
      el("button.btn-sm", { onclick: () => guard(async () => {
        if (!titleIn.value.trim()) return;
        await api.post("/api/synapse/refs/stored?paper_id=" + paper.id, { title: titleIn.value.trim(), link: linkIn.value.trim() || null });
        titleIn.value = ""; linkIn.value = ""; reload();
      }), text: "+ add" }),
    ]));
    wrap.appendChild(bulkPasteBox(paper, reload));
    await reload();
    return wrap;
  }

  // A redraw rebuilds the view head, so the shell's log-time button has to be
  // put back — otherwise it disappears the first time you save a session.
  function rerender(view) {
    const p = window.Views.workspace.render(view, window.PM);
    Promise.resolve(p).then(() => window.remountWorkLog && window.remountWorkLog());
  }

  window.Views = window.Views || {};
  window.Views.workspace = {
    id: "workspace", label: "Workspace", scoped: true,
    async render(view, PM) {
      clear(view);
      if (!PM.paper) return needPaper(view);
      const p = PM.paper;
      view.appendChild(el("div.view-head", {}, [
        el("div", {}, [ el("h1", { text: "Workspace" }), el("div.sub", { text: p.title }) ]),
        el("button.btn-sm", {
          title: "read this PDF with the local LLM and build the frozen auto layer of the Knowledge Graph",
          onclick: () => guard(async () => {
            await api.post("/api/synapse/kg/generate?paper_id=" + p.id); toast("auto KG generated — see Knowledge Graph tab");
          }), text: "✦ generate auto KG" }),
      ]));
      view.appendChild(timeCheck(p, view));
      // Master first: it's the whole paper in one place, so it reads as the
      // summary the passes below feed into rather than an afterthought.
      view.appendChild(masterInstanceSection(p));
      const inst = await instancesSection(p, view);
      inst.wrap.style.marginTop = "14px";
      view.appendChild(inst.wrap);
      const grid = el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;align-items:start" });
      const leftCol = el("div", { style: "display:flex;flex-direction:column;gap:14px" });
      leftCol.appendChild(dictWidget());
      leftCol.appendChild(imagesWidget(p));
      leftCol.appendChild(await termsSection(p.id));
      grid.appendChild(leftCol);
      // Mind dump sits directly above the highlights, in the same column: a
      // thought that arrives mid-read gets caught next to where you're writing
      // the highlights down, not across the page.
      const rightCol = el("div", { style: "display:flex;flex-direction:column;gap:14px" });
      rightCol.appendChild(mindWidget(p));
      if (inst.hasInstance) rightCol.appendChild(await highlightsSection(activeInstance));
      grid.appendChild(rightCol);
      view.appendChild(grid);
      view.appendChild(await referencesSection(p));
    },
  };
})();
