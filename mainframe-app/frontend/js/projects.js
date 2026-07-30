/* projects.js — the Project area: a GitHub-style light-blue contribution grid
   (all activity, click a square to recolour) + projects that hold uploaded files
   and linked files/repos, each with a note. */
(function () {
  const { el, clear, toast, guard, confirmDo } = window.ui;
  const api = window.api;

  const DAY = 86400000;
  // light-blue ramp: level 0 (subtle) → 4 (bright cyan-blue = most work)
  const RAMP = ["rgba(120,170,210,.10)", "#1f5f7a", "#2b87b0", "#1aa7e0", "#2de2ff"];
  // A square's colour is TIME WORKED that day. Thresholds in minutes — a full
  // day of work saturates, so ordinary days still separate from each other.
  const MIN_STEPS = [0, 30, 90, 180, 300];
  function level(mins) {
    let lv = 0;
    for (let i = 1; i < MIN_STEPS.length; i++) if (mins >= MIN_STEPS[i]) lv = i;
    return mins > 0 ? Math.max(1, lv) : 0;
  }
  function fmtMins(m) { return window.WorkLog ? window.WorkLog.fmtMins(m) : String(m || 0) + "m"; }

  function fmtSize(b) {
    if (b == null) return "";
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }
  const utc = (s) => new Date(s + "T00:00:00Z");
  const toStr = (d) => d.toISOString().slice(0, 10);

  // ---------- contribution grid ----------
  // Zoom level: each cell is one day / week / month / year. Survives reload().
  let heatMode = "day";
  let heatFocus = null;   // ISO day to centre on after a re-render (null → newest)

  const MODE_LABEL = { day: "Day", week: "Week", month: "Month", year: "Year" };
  const NEXT_ZOOM = { year: "month", month: "week", week: "day" };
  // cell width per mode; day keeps the classic 12px square grid
  const CELL_W = { week: 14, month: 34, year: 62 };

  const sunday = (d) => new Date(d.getTime() - d.getUTCDay() * DAY);
  const monthStart = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const yearStart = (d) => new Date(Date.UTC(d.getUTCFullYear(), 0, 1));

  // bucket a day into the current mode → the ISO date that starts its bucket
  function bucketOf(d, mode) {
    if (mode === "day") return toStr(d);
    if (mode === "week") return toStr(sunday(d));
    if (mode === "month") return toStr(monthStart(d));
    return toStr(yearStart(d));
  }

  // walk bucket starts from `from` to `to` inclusive
  function bucketRange(from, to, mode) {
    const out = [];
    let d = mode === "day" ? from : utc(bucketOf(from, mode));
    while (d.getTime() <= to.getTime()) {
      out.push(new Date(d));
      if (mode === "day") d = new Date(d.getTime() + DAY);
      else if (mode === "week") d = new Date(d.getTime() + 7 * DAY);
      else if (mode === "month") d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      else d = new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1));
    }
    return out;
  }

  function bucketLabel(d, mode) {
    if (mode === "year") return String(d.getUTCFullYear());
    if (mode === "month") return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
    if (mode === "week") return "w/c " + d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }

  // roll the per-day work summaries up into one bucket
  function bucketAgg(days, start, mode) {
    const end = mode === "day" ? start
      : mode === "week" ? new Date(start.getTime() + 6 * DAY)
        : mode === "month" ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
          : new Date(Date.UTC(start.getUTCFullYear(), 11, 31));
    const agg = { mins: 0, sessions: 0, pushed: false, contributed: false };
    for (let d = new Date(start); d.getTime() <= end.getTime(); d = new Date(d.getTime() + DAY)) {
      const s = days[toStr(d)];
      if (!s) continue;
      agg.mins += s.mins || 0;
      agg.sessions += s.sessions || 0;
      if (s.pushed) agg.pushed = true;
      if (s.contributed) agg.contributed = true;
    }
    return agg;
  }

  function buildHeatmap(data, reload) {
    const wrap = el("div.card");
    const today = utc(data.today);
    // scrollable range: first recorded day (or a year back, whichever is earlier)
    const earliest = data.first ? utc(data.first) : today;
    const yearBack = new Date(today.getTime() - 52 * 7 * DAY);
    const from = earliest.getTime() < yearBack.getTime() ? earliest : yearBack;
    const overrides = { ...data.overrides };
    const counts = data.counts || {};      // raw app mutations — tooltip only now
    const days = data.days || {};          // work sessions — what actually colours a square

    // scroll container is built up front so the toolbar can drive it
    const scroller = el("div.heat-scroll");
    const inner = el("div.heat-inner");
    scroller.appendChild(inner);
    let dragged = false;   // set while panning, so a drag doesn't fire a cell click
    function pan(dir) { scroller.scrollBy({ left: dir * Math.max(160, scroller.clientWidth * 0.8), behavior: "smooth" }); }

    wrap.appendChild(el("div.spread", {}, [
      el("h3", { text: "Contributions" }),
      el("span.sub", { text: heatMode === "day"
        ? "darker = more time worked · outline = tracked project · ★ = pushed · click to recolour, right-click to reset"
        : "each square is one " + heatMode + " · click to zoom in · scroll or drag to pan" }),
    ]));

    // --- zoom toggle + pan controls ---
    const seg = (val) => el("button.btn-sm" + (heatMode === val ? ".heat-on" : ""), {
      onclick: () => { if (heatMode === val) return; heatMode = val; heatFocus = null; reload(); },
      text: MODE_LABEL[val] });
    wrap.appendChild(el("div.row", { style: "gap:8px;margin:10px 0" }, [
      el("div.row", { style: "gap:4px" }, [seg("day"), seg("week"), seg("month"), seg("year")]),
      el("span.sub", { text: "│" }),
      el("button.btn-sm", { title: "earlier", onclick: () => pan(-1), text: "◀" }),
      el("button.btn-sm", { title: "later", onclick: () => pan(1), text: "▶" }),
      el("button.btn-sm", { onclick: () => { scroller.scrollLeft = scroller.scrollWidth; }, text: "today" }),
    ]));

    // hidden color input reused for editing (day mode only)
    const picker = el("input", { type: "color", style: "position:absolute;left:-9999px" });
    wrap.appendChild(picker);
    let editing = null;

    let focusCell = null;

    if (heatMode === "day") {
      // classic 7-row × week-column grid
      const monthRow = el("div.heat-months");
      const grid = el("div.heat-grid");
      const first = sunday(from);
      const cols = Math.ceil((today.getTime() - first.getTime()) / (7 * DAY)) + 1;
      let lastMonth = -1;

      function paint(cell, date) {
        const ov = overrides[date];
        const s = days[date] || {};
        const mins = s.mins || 0;
        const events = counts[date] || 0;
        cell.style.background = ov || RAMP[level(mins)];
        // outline = worked on a project flagged "add to the contributions"
        cell.classList.toggle("heat-contrib", !!s.contributed);
        // ★ = something was pushed that day
        cell.classList.toggle("heat-push", !!s.pushed);
        cell.textContent = s.pushed ? "★" : "";
        cell.title = bucketLabel(utc(date), "day")
          + " · " + fmtMins(mins) + " worked"
          + (s.sessions ? " · " + s.sessions + " session" + (s.sessions === 1 ? "" : "s") : "")
          + (s.pushed ? " · pushed" : "")
          + (s.contributed ? " · tracked project" : "")
          + (events ? " · " + events + " app event" + (events === 1 ? "" : "s") : "")
          + (ov ? " (custom colour)" : "");
      }

      for (let c = 0; c < cols; c++) {
        const col = el("div.heat-col");
        const col0 = new Date(first.getTime() + c * 7 * DAY);
        const m = col0.getUTCMonth();
        if (m !== lastMonth) {
          monthRow.appendChild(el("span.heat-month", { style: "left:" + (c * 15) + "px",
            text: col0.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }) }));
          lastMonth = m;
        }
        for (let r = 0; r < 7; r++) {
          const d = new Date(first.getTime() + (c * 7 + r) * DAY);
          if (d.getTime() > today.getTime() || d.getTime() < from.getTime()) { col.appendChild(el("div.heat-cell.heat-blank")); continue; }
          const date = toStr(d);
          const cell = el("div.heat-cell");
          paint(cell, date);
          if (heatFocus && date === heatFocus) focusCell = cell;
          cell.addEventListener("click", () => {
            if (dragged) return;
            editing = { cell, date };
            picker.value = overrides[date] || "#2de2ff";
            picker.click();
          });
          cell.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            delete overrides[date]; paint(cell, date);
            guard(() => api.heatmap.setCell({ date, color: "" }));
          });
          col.appendChild(cell);
        }
        grid.appendChild(col);
      }
      picker.addEventListener("input", () => {
        if (!editing) return;
        overrides[editing.date] = picker.value; paint(editing.cell, editing.date);
        guard(() => api.heatmap.setCell({ date: editing.date, color: picker.value }));
      });
      inner.appendChild(el("div", { style: "position:relative;height:14px;width:" + (cols * 15) + "px" }, [monthRow]));
      inner.appendChild(grid);
    } else {
      // week / month / year → a single strip of wider cells, scaled to the busiest bucket
      const w = CELL_W[heatMode];
      const starts = bucketRange(from, today, heatMode);
      const aggs = starts.map((d) => bucketAgg(days, d, heatMode));
      const max = Math.max(1, ...aggs.map((a) => a.mins));
      const pitch = w + 3;                       // cell width + flex gap
      const strip = el("div.heat-strip");
      // labels are absolutely positioned (same trick as the day view's month row)
      // so a narrow cell can't squash its neighbour's text
      const labels = el("div.heat-strip-labels", { style: "width:" + (starts.length * pitch) + "px" });
      let lastMonth = -1;
      starts.forEach((d, i) => {
        const a = aggs[i];
        const lv = a.mins === 0 ? 0 : Math.min(4, 1 + Math.floor((a.mins / max) * 3.999));
        const cell = el("div.heat-bucket", {
          style: "width:" + w + "px;background:" + RAMP[lv],
          title: bucketLabel(d, heatMode) + " · " + fmtMins(a.mins) + " worked"
            + (a.sessions ? " · " + a.sessions + " session" + (a.sessions === 1 ? "" : "s") : "")
            + (a.pushed ? " · pushed" : ""),
          // only the wider month/year cells have room for the total
          text: a.mins && heatMode !== "week" ? fmtMins(a.mins) : "",
        });
        if (a.contributed) cell.classList.add("heat-contrib");
        if (a.pushed) cell.classList.add("heat-push-mark");
        if (heatFocus && toStr(d) === bucketOf(utc(heatFocus), heatMode)) focusCell = cell;
        cell.addEventListener("click", () => {
          if (dragged) return;
          heatFocus = toStr(d); heatMode = NEXT_ZOOM[heatMode]; reload();
        });
        strip.appendChild(cell);

        // year → every cell; month → every cell; week → only when the month turns over
        const m = d.getUTCMonth();
        const tick = heatMode === "year" ? String(d.getUTCFullYear())
          : (heatMode === "month" || m !== lastMonth)
            ? d.toLocaleDateString("en-GB", m === 0
              ? { month: "short", year: "2-digit", timeZone: "UTC" }
              : { month: "short", timeZone: "UTC" })
            : null;
        lastMonth = m;
        if (tick) labels.appendChild(el("span.heat-month", { style: "left:" + (i * pitch) + "px", text: tick }));
      });
      inner.appendChild(strip);
      inner.appendChild(labels);
    }

    // --- panning: wheel scrolls sideways, drag pans ---
    scroller.addEventListener("wheel", (e) => {
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;  // let native handle it
      if (scroller.scrollWidth <= scroller.clientWidth) return;
      e.preventDefault();
      scroller.scrollLeft += e.deltaY;
    }, { passive: false });
    let down = null;
    scroller.addEventListener("pointerdown", (e) => { down = { x: e.clientX, left: scroller.scrollLeft }; dragged = false; });
    scroller.addEventListener("pointermove", (e) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      if (Math.abs(dx) > 4) { dragged = true; scroller.classList.add("heat-dragging"); }
      if (dragged) scroller.scrollLeft = down.left - dx;
    });
    const endDrag = () => { down = null; scroller.classList.remove("heat-dragging"); setTimeout(() => { dragged = false; }, 0); };
    scroller.addEventListener("pointerup", endDrag);
    scroller.addEventListener("pointerleave", endDrag);

    wrap.appendChild(scroller);
    wrap.appendChild(el("div.row", { style: "gap:5px;margin-top:8px;font-size:10px;color:var(--dim);justify-content:flex-end;flex-wrap:wrap" }, [
      el("span.heat-cell.heat-contrib", { style: "background:" + RAMP[2] }),
      el("span", { style: "margin-right:10px", text: "tracked project" }),
      el("span.heat-cell.heat-push", { style: "background:" + RAMP[3], text: "★" }),
      el("span", { style: "margin-right:10px", text: "pushed" }),
      el("span", { text: "less time" }),
      ...RAMP.map((c) => el("span.heat-cell", { style: "background:" + c })),
      el("span", { text: "more time" }),
    ]));

    // start at today, or centre the period we just zoomed into
    requestAnimationFrame(() => {
      if (focusCell) scroller.scrollLeft = focusCell.offsetLeft - scroller.clientWidth / 2 + focusCell.offsetWidth / 2;
      else scroller.scrollLeft = scroller.scrollWidth;
      heatFocus = null;
    });
    return wrap;
  }

  // ---------- project cards ----------
  function fileRow(p, f, reload) {
    if (f.kind === "upload") {
      return el("div.proj-file", {}, [
        el("span", { text: "⬆ " + f.name }),
        el("span.sub", { text: fmtSize(f.size) }),
        el("a.btn-sm", { href: api.projects.downloadUrl(p.id, f.id), style: "text-decoration:none", text: "download" }),
        el("button.btn-sm.btn-danger", { onclick: () => guard(async () => { await api.projects.delFile(p.id, f.id); reload(); }), text: "×" }),
      ]);
    }
    const target = f.url || f.path || "";
    const link = f.url ? el("a", { href: f.url, target: "_blank", rel: "noopener noreferrer", style: "color:var(--blue)", text: target }) : el("span.mono", { style: "font-size:11px;color:var(--dim)", text: target });
    return el("div.proj-file", {}, [
      el("span", {}, [document.createTextNode("🔗 " + f.name + "  "), link]),
      f.note ? el("span.sub", { text: f.note }) : el("span"),
      el("span"),
      el("button.btn-sm.btn-danger", { onclick: () => guard(async () => { await api.projects.delFile(p.id, f.id); reload(); }), text: "×" }),
    ]);
  }

  // ---------- master view: every word written about a project, plus totals ----
  function masterPanel(p) {
    const box = el("div.proj-master");
    box.appendChild(el("div.sub", { text: "loading…" }));
    guard(async () => {
      const m = await api.projects.master(p.id);
      clear(box);
      const stat = (v, l, c) => el("div.prog-box", {}, [
        el("div.prog-val", { style: "color:" + c, text: v }), el("div.prog-label", { text: l }),
      ]);
      box.appendChild(el("div.prog-grid", {}, [
        stat(fmtMins(m.total_mins), "hours spent", "#2de2ff"),
        stat(String(m.session_count), "sessions", "#7FA8C8"),
        stat(String(m.distinct_days), "days", "#7FA8C8"),
        stat(String(m.push_count), "pushes", "#F4709C"),
        stat(fmtMins(m.focus_mins.active), "active", "#00F5D4"),
        stat(fmtMins(m.focus_mins.passive), "passive", "#D4A017"),
        stat(fmtMins(m.distraction_mins), "distracted", "#FF4757"),
      ]));
      box.appendChild(el("div.sub", { style: "margin:10px 0 4px", text:
        (m.first_worked ? "First worked " + m.first_worked + " · last " + m.last_worked : "Not worked on yet")
        + " · " + m.file_count + " file" + (m.file_count === 1 ? "" : "s") }));
      if (!m.blocks.length) {
        box.appendChild(el("div.empty", { text: "Nothing written yet — the note, file notes and session text all land here." }));
        return;
      }
      const doc = el("div.proj-doc");
      m.blocks.forEach((b) => doc.appendChild(el("div.proj-block", {}, [
        el("div.proj-block-src", { text: b.source + (b.mins ? " · " + fmtMins(b.mins) : "") }),
        el("div", { style: "white-space:pre-wrap", text: b.text }),
      ])));
      box.appendChild(doc);
    });
    return box;
  }

  function projectCard(p, reload) {
    const card = el("div.card", { style: "margin-bottom:12px" });

    // editable title — click the name to rename
    const title = el("input.proj-title", { value: p.name });
    title.addEventListener("change", () => guard(async () => {
      if (!title.value.trim()) { title.value = p.name; return toast("name can't be empty", true); }
      await api.projects.update(p.id, { name: title.value.trim() }); toast("renamed"); reload();
    }));

    // "add to the contributions" — drives the outline on the day square
    const contrib = el("input", { type: "checkbox" });
    if (p.contributes !== false) contrib.setAttribute("checked", "");
    contrib.addEventListener("change", () => guard(async () => {
      await api.projects.update(p.id, { contributes: contrib.checked });
      toast(contrib.checked ? "counts toward contributions" : "excluded from contributions");
      reload();
    }));

    card.appendChild(el("div.spread", {}, [
      title,
      el("div.row", { style: "gap:6px" }, [
        el("label.wl-check", { title: "outline this day's square in the contribution grid" }, [
          contrib, el("span", { text: " add to contributions" }),
        ]),
        // one click records the push; add detail afterwards from sessions or
        // the Database tab (a modal prompt here would block the whole page)
        el("button.btn-sm.proj-push", {
          title: "record a push — puts a ★ on today's square",
          onclick: () => guard(async () => {
            await api.projects.push(p.id, { note: "pushed" });
            toast("pushed ★ — add detail in sessions"); reload();
          }),
          text: "★ pushed",
        }),
        // Log a learning entry against this project without leaving it — same
        // modal, same fields, so it groups with everything else by kind.
        el("button.btn-sm", { title: "log a learning opportunity on this project",
          onclick: () => window.LearningPush && window.LearningPush({
            kind: "", module: "mainframe",
            what: "on “" + p.name + "”: ",
          }), text: "↗ learning" }),
        el("button.btn-sm.btn-danger", { onclick: () => confirmDo("Delete project “" + p.name + "” and its files?", async () => { await api.projects.del(p.id); reload(); }), text: "delete" }),
      ]),
    ]));

    // headline totals — hours spent, at a glance
    card.appendChild(el("div.row", { style: "gap:10px;margin-top:6px;font-size:11px;color:var(--dim);flex-wrap:wrap" }, [
      el("span.pill", { text: "⏱ " + fmtMins(p.total_mins || 0) }),
      el("span.pill", { text: (p.sessions || []).length + " sessions" }),
      p.push_count ? el("span.pill", { style: "color:#F4709C", text: "★ " + p.push_count + " pushes" }) : null,
      p.last_worked ? el("span.sub", { text: "last worked " + p.last_worked }) : el("span.sub", { text: "not started" }),
    ]));

    // editable note
    const note = el("textarea.mform-input", { rows: "2", placeholder: "note about this project…", style: "width:100%;margin-top:8px" });
    note.value = p.note || "";
    note.addEventListener("change", () => guard(async () => { await api.projects.update(p.id, { note: note.value }); toast("note saved"); }));
    card.appendChild(note);

    // --- work sessions: log a new visit, see every past one ---
    const sessHost = el("div", { style: "margin-top:10px" });
    const sessBody = el("div");
    let sessOpen = false;
    const toggleSess = el("button.btn-sm", {
      onclick: () => { sessOpen = !sessOpen; drawSessions(); },
      text: "▸ sessions (" + (p.sessions || []).length + ")",
    });
    function drawSessions() {
      clear(sessBody);
      toggleSess.textContent = (sessOpen ? "▾" : "▸") + " sessions (" + (p.sessions || []).length + ")";
      if (!sessOpen) return;
      const list = p.sessions || [];
      if (!list.length) sessBody.appendChild(el("div.sub", { style: "margin-top:6px", text: "No sessions yet — log one above." }));
      list.forEach((s) => sessBody.appendChild(el("div.proj-sess", {}, [
        el("span.mono", { style: "font-size:11px", text: s.date + (s.start ? " " + s.start + (s.end ? "–" + s.end : "") : "") }),
        el("span.pill", { text: fmtMins(s.mins) }),
        el("span", { text: (s.pushed ? "★ " : "") + (s.what || s.notes || "—") }),
        el("span.sub", { style: "font-size:10px", text: s.focus && s.focus !== "none" ? s.focus : "" }),
        el("button.btn-sm.btn-danger", {
          onclick: () => guard(async () => { await api.work.del(s.id); reload(); }), text: "×",
        }),
      ])));
    }
    const addHost = el("div");
    sessHost.appendChild(el("div.row", { style: "gap:6px" }, [
      window.WorkLog.button(
        { mountInto: addHost, ref_kind: "project", ref_id: p.id, ref_title: p.name, lockRef: true },
        reload, "+ log time",
      ),
      toggleSess,
    ]));
    sessHost.appendChild(addHost);
    sessHost.appendChild(sessBody);
    card.appendChild(sessHost);
    drawSessions();

    // --- master: one document of everything written about this project ---
    const masterHost = el("div");
    let masterOpen = false;
    const masterBtn = el("button.btn-sm", {
      style: "margin-top:8px",
      onclick: () => {
        masterOpen = !masterOpen;
        clear(masterHost);
        masterBtn.textContent = (masterOpen ? "▾" : "▸") + " master";
        if (masterOpen) masterHost.appendChild(masterPanel(p));
      },
      text: "▸ master",
    });
    card.appendChild(masterBtn);
    card.appendChild(masterHost);

    window.Images.mount(card, { module: "projects", contextId: p.id, surface: "project", title: "Images" });

    // files
    const list = el("div", { style: "margin-top:10px" });
    (p.files || []).forEach((f) => list.appendChild(fileRow(p, f, reload)));
    if (!(p.files || []).length) list.appendChild(el("div.sub", { text: "No files yet — upload or link one below." }));
    card.appendChild(list);

    // upload + add-link
    const fileIn = el("input", { type: "file" });
    fileIn.addEventListener("change", () => {
      if (!fileIn.files.length) return;
      const form = new FormData(); form.append("file", fileIn.files[0]);
      guard(async () => { await api.projects.uploadFile(p.id, form); toast("uploaded"); reload(); });
    });
    const lname = el("input", { placeholder: "name", style: "width:120px" });
    const ltarget = el("input", { placeholder: "url or /path/to/file", style: "flex:1;min-width:160px" });
    const lnote = el("input", { placeholder: "note", style: "width:120px" });
    card.appendChild(el("div", { style: "margin-top:12px;border-top:1px solid var(--border);padding-top:10px" }, [
      el("div.row", {}, [el("span.sub", { text: "upload:" }), fileIn]),
      el("div.row", { style: "margin-top:8px" }, [
        el("span.sub", { text: "link:" }), lname, ltarget, lnote,
        el("button.btn-sm", { onclick: () => guard(async () => {
          if (!lname.value.trim() || !ltarget.value.trim()) return toast("name + url/path needed", true);
          const isUrl = /^https?:\/\//i.test(ltarget.value.trim());
          await api.projects.addLink(p.id, { name: lname.value.trim(), url: isUrl ? ltarget.value.trim() : null, path: isUrl ? null : ltarget.value.trim(), note: lnote.value.trim() });
          lname.value = ltarget.value = lnote.value = ""; reload();
        }), text: "+ link" }),
      ]),
    ]));
    return card;
  }

  window.Views = window.Views || {};
  window.Views.project = {
    id: "project", label: "Project", scoped: false,
    async render(viewEl) {
      clear(viewEl);
      viewEl.appendChild(el("div.view-head", {}, [el("div", {}, [
        el("h1", { text: "Project" }),
        el("div.sub", { text: "Your projects, files and links — and a contribution grid of everything you do." }),
      ])]));
      const host = el("div"); viewEl.appendChild(host);

      async function reload() {
        // days=0 → all history, so the week/month/year zooms can scroll past one year
        const [heat, projects] = await guard(() => Promise.all([api.heatmap.get(0), api.projects.list()]));
        clear(host);
        host.appendChild(buildHeatmap(heat, reload));

        // create project
        const nameIn = el("input", { placeholder: "new project name", style: "flex:1;min-width:160px" });
        const noteIn = el("input", { placeholder: "note (optional)", style: "flex:1;min-width:160px" });
        host.appendChild(el("div.row", { style: "margin:16px 0 12px" }, [
          nameIn, noteIn,
          el("button.btn-primary", { onclick: () => guard(async () => {
            if (!nameIn.value.trim()) return toast("name the project", true);
            await api.projects.create({ name: nameIn.value.trim(), note: noteIn.value.trim() });
            nameIn.value = noteIn.value = ""; reload();
          }), text: "+ project" }),
        ]));

        if (!projects.length) host.appendChild(el("div.empty", { text: "No projects yet. Create one above." }));
        else projects.forEach((p) => host.appendChild(projectCard(p, reload)));
      }
      reload();
    },
  };
})();
