/* mind.js — global mind-dump inbox: quick captures, optionally linked to a
   paper, checkable and filterable. Cards expand into a full editor and can be
   moved up/down into a manual order. Mainframe-level (/api/mind). */
(function () {
  const { el, clear, toast, guard } = window.ui;
  const api = window.api;

  const KINDS = ["idea", "look-at", "note"];
  const KIND_LABELS = { idea: "idea", "look-at": "look at", note: "note" };
  const KIND_STYLE = {
    idea: "background:var(--amber-d);color:var(--amber)",
    "look-at": "background:var(--blue-d);color:var(--blue)",
    note: "background:var(--purple-d);color:var(--purple)",
  };

  let fStatus = "open"; // open | done | ""(all)
  let fKind = "";
  const open = new Set();  // expanded card ids, kept across reloads
  let items = [], papersRef = [], listHost = null;

  function dateFmt(iso) {
    if (!iso) return "";
    try { return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
    catch { return String(iso).slice(0, 10); }
  }

  /* Patch one field and keep the local copy in sync — no full reload, so the
     card keeps focus and stays expanded while you edit. */
  function fieldSaver(m, key) {
    return (input) => guard(async () => {
      const nv = input.value;
      if (String(m[key] == null ? "" : m[key]) === nv) return;
      const saved = await api.patch("/api/mind/" + m.id, { [key]: nv });
      Object.assign(m, saved);
      toast("saved");
    });
  }

  function labelled(text, node) {
    return el("label.md-field", {}, [el("span.sub", { text }), node]);
  }

  // screenshot / photo attached to a capture — shown inside the expanded card
  function imagesHost(m) {
    const host = el("div");
    window.Images.mount(host, { module: "mind", contextId: m.id, surface: "mind", title: "Images" });
    return host;
  }

  /* Swap a card with its neighbour. Only the two ids are sent, so the swap is
     correct even when the list is filtered (see ReorderRequest server-side). */
  function move(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const tmp = items[idx]; items[idx] = items[j]; items[j] = tmp;
    const lo = Math.min(idx, j), hi = Math.max(idx, j);
    const ids = [items[lo].id, items[hi].id];
    renderList();
    guard(() => api.post("/api/mind/reorder", { ids }));
  }

  function orderCol(idx) {
    const up = el("button.ord-btn", { title: "move up", text: "▲",
      onclick: (e) => { e.stopPropagation(); move(idx, -1); } });
    const down = el("button.ord-btn", { title: "move down", text: "▼",
      onclick: (e) => { e.stopPropagation(); move(idx, 1); } });
    if (idx === 0) up.disabled = true;
    if (idx === items.length - 1) down.disabled = true;
    return el("div.ord-col", {}, [up, down]);
  }

  function expandedBody(m) {
    const textIn = el("textarea", { rows: "3", style: "width:100%" });
    textIn.value = m.text || "";
    textIn.addEventListener("blur", () => fieldSaver(m, "text")(textIn));

    const detailIn = el("textarea", { rows: "5", style: "width:100%",
      placeholder: "expand on it — the full thought, links, next steps…" });
    detailIn.value = m.detail || "";
    detailIn.addEventListener("blur", () => fieldSaver(m, "detail")(detailIn));

    const kindSel = el("select", {}, KINDS.map((k) => el("option", { value: k, text: KIND_LABELS[k] })));
    kindSel.value = m.kind || "idea";
    kindSel.addEventListener("change", () => fieldSaver(m, "kind")(kindSel));

    const linkIn = el("input", { placeholder: "https://…", style: "width:100%" });
    linkIn.value = m.link || "";
    linkIn.addEventListener("blur", () => fieldSaver(m, "link")(linkIn));

    const paperSel = el("select", { style: "width:100%" }, [
      el("option", { value: "", text: "— no paper —" }),
      ...papersRef.map((p) => el("option", { value: p.id, text: p.title.slice(0, 44) })),
    ]);
    paperSel.value = m.paper_id || "";
    paperSel.addEventListener("change", () => fieldSaver(m, "paper_id")(paperSel));

    return el("div.md-body", {}, [
      labelled("capture", textIn),
      labelled("detail", detailIn),
      el("div.md-grid", {}, [
        labelled("kind", kindSel),
        labelled("link", linkIn),
        labelled("paper", paperSel),
      ]),
      imagesHost(m),
      el("div.task-meta", { style: "margin-top:10px" }, [
        el("span.sub", { text: "captured " + dateFmt(m.created_at) }),
        el("span.sub", { text: m.status === "done" ? "done" : "open" }),
      ]),
    ]);
  }

  function itemCard(m, idx) {
    const done = m.status === "done";
    const isOpen = open.has(m.id);

    const cb = el("input", { type: "checkbox" });
    cb.checked = done;
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", () => guard(async () => {
      const saved = await api.patch("/api/mind/" + m.id, { status: cb.checked ? "done" : "open" });
      Object.assign(m, saved);
      // A status change can drop the item out of the current filter.
      if (fStatus && saved.status !== fStatus) reload(); else renderList();
    }));

    const toggle = () => { isOpen ? open.delete(m.id) : open.add(m.id); renderList(); };
    const caret = el("button.ord-btn", { title: isOpen ? "collapse" : "expand",
      text: isOpen ? "▾" : "▸", onclick: (e) => { e.stopPropagation(); toggle(); } });

    const preview = el("div", { class: isOpen ? "" : "md-clamp",
      style: done ? "text-decoration:line-through" : "", text: m.text });
    const hasDetail = !!(m.detail && m.detail.trim());

    const head = el("div.spread", { style: "cursor:pointer", onclick: toggle }, [
      el("div.row", { style: "align-items:flex-start;gap:8px;flex:1;min-width:0" }, [
        orderCol(idx), cb,
        el("div", { style: "flex:1;min-width:0" }, [
          preview,
          el("div.task-meta", {}, [
            el("span.tk-tag", { style: KIND_STYLE[m.kind] || "", text: KIND_LABELS[m.kind] || m.kind }),
            hasDetail && !isOpen ? el("span.sub", { title: "has a detail note", text: "❐ detail" }) : null,
            m.paper_title ? el("a", { href: "#", style: "color:var(--teal)", onclick: (e) => { e.preventDefault(); e.stopPropagation(); window.PM.selectPaper(m.paper_id); }, text: "▸ " + m.paper_title.slice(0, 36) }) : null,
            m.link ? el("a", { href: m.link, target: "_blank", rel: "noopener noreferrer", style: "color:var(--blue)", onclick: (e) => e.stopPropagation(), text: "link ↗" }) : null,
            el("span.sub", { text: dateFmt(m.created_at) }),
          ]),
        ]),
      ]),
      el("div.row", { style: "gap:4px;align-items:flex-start" }, [
        caret,
        el("button.btn-sm.btn-danger", { onclick: (e) => { e.stopPropagation(); guard(async () => { await api.del("/api/mind/" + m.id); open.delete(m.id); reload(); }); }, text: "×" }),
      ]),
    ]);

    const card = el("div.card", { style: "margin-bottom:10px;" + (done ? "opacity:.55" : "") }, [head]);
    if (isOpen) card.appendChild(expandedBody(m));
    return card;
  }

  function renderList() {
    clear(listHost);
    if (!items.length) { listHost.appendChild(el("div.empty", { text: "Nothing here. Capture a thought above." })); return; }
    items.forEach((m, i) => listHost.appendChild(itemCard(m, i)));
  }

  async function reload() {
    const qs = [];
    if (fStatus) qs.push("status=" + fStatus);
    if (fKind) qs.push("kind=" + encodeURIComponent(fKind));
    items = await guard(() => api.get("/api/mind" + (qs.length ? "?" + qs.join("&") : "")));
    renderList();
  }

  window.Views = window.Views || {};
  window.Views.mind = {
    id: "mind", label: "Mind Dump", scoped: false,
    async render(viewEl) {
      clear(viewEl);
      viewEl.appendChild(el("div.view-head", {}, [el("div", {}, [
        el("h1", { text: "Mind Dump" }),
        el("div.sub", { text: "Quick capture — stick an idea, flag something to come back to. Click a card to expand it; ▲▼ to reorder." }),
      ])]));

      // quick-add
      const textIn = el("textarea", { rows: "2", placeholder: "stick an idea / “come look at this”…", style: "width:100%" });
      const kindSel = el("select", {}, KINDS.map((k) => el("option", { value: k, text: KIND_LABELS[k] })));
      const linkIn = el("input", { placeholder: "link (optional)", style: "flex:1;min-width:120px" });
      const paperSel = el("select", { style: "flex:1;min-width:140px" });
      paperSel.appendChild(el("option", { value: "", text: "— no paper —" }));
      papersRef = await guard(() => api.papers.list());
      papersRef.forEach((p) => paperSel.appendChild(el("option", { value: p.id, text: p.title.slice(0, 44) })));
      const add = el("button.btn-sm.btn-primary", { text: "capture", onclick: () => guard(async () => {
        if (!textIn.value.trim()) return toast("write something first", true);
        await api.post("/api/mind", { text: textIn.value.trim(), kind: kindSel.value, link: linkIn.value.trim() || null, paper_id: paperSel.value || null });
        textIn.value = ""; linkIn.value = ""; toast("captured"); reload();
      }) });
      viewEl.appendChild(el("div.card", {}, [textIn, el("div.row", { style: "margin-top:10px" }, [kindSel, linkIn, paperSel, add])]));

      // filters
      const statusSel = el("select", {}, [{ v: "open", t: "open" }, { v: "done", t: "done" }, { v: "", t: "all" }].map((o) => el("option", { value: o.v, text: o.t })));
      statusSel.value = fStatus;
      statusSel.addEventListener("change", () => { fStatus = statusSel.value; reload(); });
      const kindFilter = el("select", {}, [{ v: "", t: "all kinds" }, ...KINDS.map((k) => ({ v: k, t: KIND_LABELS[k] }))].map((o) => el("option", { value: o.v, text: o.t })));
      kindFilter.value = fKind;
      kindFilter.addEventListener("change", () => { fKind = kindFilter.value; reload(); });
      viewEl.appendChild(el("div.row", { style: "margin:16px 0 10px" }, [statusSel, kindFilter]));

      listHost = el("div");
      viewEl.appendChild(listHost);
      reload();
    },
  };
})();
