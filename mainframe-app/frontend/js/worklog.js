/* worklog.js — the shared "push work into the database" form.

   One form, used everywhere: the Database tab's add-row, the project cards, the
   task cards. Whatever pushes it, the row lands in the same :WorkSession table
   and lights the same contribution square.

   window.WorkLog.form({...})   → a DOM node with the full field set
   window.WorkLog.button({...}) → "+ log work" button that toggles that form
   window.WorkLog.MODULES / FOCUS / fmtMins — shared vocabulary + colours */
(function () {
  const { el, toast, guard } = window.ui;
  const api = window.api;

  // module → colour. Matches the module accents used across Mainframe, so a
  // Synapse row reads as Synapse at a glance in the table.
  const MODULES = {
    synapse: "#00F5D4", pulse: "#F4709C", vision: "#FF4757",
    vault: "#D4A017", mainframe: "#7FA8C8",
  };
  const FOCUS = { active: "Active", passive: "Passive", none: "—" };
  // keep in step with RefKind in backend/models.py — a value missing here falls
  // through to the first option and silently mislabels the row
  /* Kinds are user-extensible now, so this starts as the built-in set and is
     replaced by whatever the server holds. Mutated in place rather than
     reassigned — callers hold a reference to this exact array. */
  const REF_KINDS = ["project", "task", "idea", "paper", "habit", "other"];
  let kindsLoaded = false;
  function loadKinds() {
    if (kindsLoaded) return;
    kindsLoaded = true;
    api.work.kinds()
      .then((ks) => { if (ks && ks.length) REF_KINDS.splice(0, REF_KINDS.length, ...ks); })
      .catch(() => { kindsLoaded = false; });   // offline: try again next time
  }

  function fmtMins(m) {
    m = Number(m) || 0;
    if (!m) return "0";
    const h = Math.floor(m / 60), r = m % 60;
    return (h ? h + "h" : "") + (r ? (h ? " " : "") + r + "m" : (h ? "" : "0"));
  }
  const todayISO = () => new Date().toISOString().slice(0, 10);
  function nowHM() {
    const d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  // "HH:MM" → minutes, wrapping past midnight
  function minsBetween(s, e) {
    const p = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
    if (!s || !e) return 0;
    let d = p(e) - p(s);
    if (isNaN(d)) return 0;
    return d < 0 ? d + 1440 : d;
  }

  function labelled(text, node) {
    return el("label.wl-field", {}, [el("span.wl-label", { text }), node]);
  }
  function opts(sel, values, cur, labelFn) {
    values.forEach((v) => {
      const o = el("option", { value: v, text: labelFn ? labelFn(v) : v });
      if (v === cur) o.setAttribute("selected", "");
      sel.appendChild(o);
    });
    return sel;
  }

  /* Full-field session form. `ctx` pre-fills and locks what the caller knows
     (e.g. a project card passes its own id/title). Every field is present on
     every session — anything that doesn't apply is left at 0 / blank / "—". */
  function form(ctx, onSaved) {
    loadKinds();
    ctx = ctx || {};
    const seed = ctx.session || {};
    const isEdit = !!seed.id;

    const date = el("input", { type: "date", value: seed.date || todayISO() });
    const start = el("input", { type: "time", value: seed.start || "" });
    const end = el("input", { type: "time", value: seed.end || "" });
    const mins = el("input", { type: "number", min: "0", style: "width:76px", value: seed.mins != null ? seed.mins : 0 });
    const module = opts(el("select"), Object.keys(MODULES), seed.module || ctx.module || "synapse");
    const refKind = opts(el("select"), REF_KINDS, seed.ref_kind || ctx.ref_kind || "other");
    const refTitle = el("input", { placeholder: "what it was on", value: seed.ref_title || ctx.ref_title || "" });
    const what = el("input", { placeholder: "what I did", value: seed.what || "" });
    const focus = opts(el("select"), Object.keys(FOCUS), seed.focus || "none", (v) => FOCUS[v]);
    // Distractions used to be logged here as a count + one line of text. The
    // reading workspace now records them properly (one entry per interruption),
    // so this form no longer asks — the properties survive on existing rows.
    const notes = el("textarea", { rows: "2", placeholder: "notes", style: "width:100%" });
    notes.value = seed.notes || "";
    const pushed = el("input", { type: "checkbox" });
    if (seed.completed != null ? seed.completed : seed.pushed) pushed.setAttribute("checked", "");

    // clock times drive the duration, but a typed duration wins (mask with 0)
    let minsTouched = isEdit && seed.mins && !(seed.start && seed.end);
    mins.addEventListener("input", () => { minsTouched = true; });
    const syncMins = () => {
      if (minsTouched) return;
      if (start.value && end.value) mins.value = minsBetween(start.value, end.value);
    };
    start.addEventListener("change", syncMins);
    end.addEventListener("change", syncMins);

    // pre-fill the clock with "now" the first time you touch either time field
    [start, end].forEach((inp) => inp.addEventListener("focus", () => { if (!inp.value) inp.value = nowHM(); }));
    // …and an explicit stopwatch, so a session can be bracketed without typing
    const stamp = window.ui.stampPair(start, end, { onChange: syncMins });

    if (ctx.lockRef) { refTitle.setAttribute("disabled", ""); refKind.setAttribute("disabled", ""); }

    const wrap = el("div.wl-form", {}, [
      el("div.wl-row", {}, [
        labelled("Date", date), labelled("From", start), labelled("To", end), stamp,
        labelled("Mins", mins), labelled("Module", module),
      ]),
      el("div.wl-row", {}, [
        labelled("Kind", refKind),
        labelled("On", refTitle),
        labelled("Focus", focus),
      ]),
      el("div.wl-row", {}, [labelled("What I did", what)]),
      el("div.wl-row", {}, [labelled("Notes", notes)]),
      el("div.wl-row", {}, [
        el("label.wl-check", {}, [pushed, el("span", { text: " completed (★ on the day)" })]),
        el("button.btn-primary", {
          style: "margin-left:auto",
          onclick: () => save(),
          text: isEdit ? "save" : "+ push to database",
        }),
      ]),
    ]);

    function payload() {
      return {
        date: date.value || todayISO(),
        start: start.value || "",
        end: end.value || "",
        mins: Number(mins.value) || 0,
        module: module.value,
        ref_kind: refKind.value,
        ref_id: ctx.ref_id || seed.ref_id || null,
        ref_title: refTitle.value.trim(),
        what: what.value.trim(),
        focus: focus.value,
        notes: notes.value.trim(),
        completed: pushed.checked,
      };
    }

    async function save() {
      const body = payload();
      if (!body.what && !body.notes && !body.mins) {
        return toast("add what you did, or some time", true);
      }
      await guard(async () => {
        if (isEdit) await api.work.update(seed.id, body);
        else await api.work.create(body);
        toast(isEdit ? "session saved" : "pushed to database");
        if (onSaved) onSaved();
      });
    }

    return wrap;
  }

  /* "+ log work" button that toggles the form inline underneath itself. */
  function button(ctx, onSaved, label) {
    const host = el("span.wl-launch");
    let open = null;
    const btn = el("button.btn-sm", {
      text: label || "+ log work",
      onclick: (e) => {
        e.stopPropagation();
        if (open) { open.remove(); open = null; btn.textContent = label || "+ log work"; return; }
        open = form(ctx, () => { open.remove(); open = null; btn.textContent = label || "+ log work"; if (onSaved) onSaved(); });
        btn.textContent = "cancel";
        (ctx.mountInto || host).appendChild(open);
      },
    });
    host.appendChild(btn);
    return host;
  }

  /* Drop a "+ log time" control into a view's header.

     Called by the shell for every view outside Vault, so anything you're
     looking at can be pushed to the work database without each view having to
     wire it up. Views that own a specific entity (a project, an idea, a task)
     also carry their own button — those pass a ref_id, this one doesn't. */
  function mountHeader(viewEl, ctx) {
    // Any depth, not just a direct child: when there's a .view-head the bar is
    // appended INTO the action group, so a `:scope >` check never saw it and
    // every re-mount added another "+ log time".
    if (!viewEl || viewEl.querySelector(".wl-header")) return;
    const head = viewEl.querySelector(".view-head");
    const bar = el("div.wl-header");
    const host = el("div.wl-header-form");
    bar.appendChild(button({ ...ctx, mountInto: host }, ctx.onSaved, "+ log time"));
    if (head) {
      // .view-head is a space-between flex built for two children (title block
      // + action group). Join the existing action group rather than becoming a
      // third child, which would strand the view's own buttons mid-header.
      const actions = head.children.length > 1 ? head.lastElementChild : null;
      if (actions) { bar.classList.add("wl-header-inline"); actions.appendChild(bar); }
      else head.appendChild(bar);
      head.insertAdjacentElement("afterend", host);
    } else {
      viewEl.insertBefore(bar, viewEl.firstChild);
      viewEl.insertBefore(host, bar.nextSibling);
    }
  }

  window.WorkLog = { form, button, mountHeader, MODULES, FOCUS, REF_KINDS, fmtMins, minsBetween, todayISO };
})();
