/* kg.js — Knowledge Graph: how the papers in your library connect.

   Papers are the subject. Everything else on the canvas is connective tissue —
   the concepts, authors and citations that tie two papers together — so a
   bridge node sitting between two papers *is* the reason they're related.

   Layout is deterministic (no physics library, per the zero-dependency rule):
   papers sit evenly on a ring, and each bridge is placed at the centroid of the
   papers it joins. A concept shared by two papers therefore lands between them.

   Below the canvas: encounters, the same concept-recurrence data that draws the
   rings — a concept in three papers is one that keeps coming back. */
(function () {
  const { el, clear, toast, guard } = window.ui;
  const api = window.api;

  const COLOR = { Paper: "#00F5D4", Concept: "#8B7EC8", Author: "#4A6B85", Topic: "#7FA8C8" };
  const colorOf = (l) => COLOR[l] || "#6f8296";
  // a paper is coloured by where you are with it, not just by being a paper
  const READ_COLOR = { unread: "#55697d", reading: "#F0A030", read: "#00F5D4", revisit: "#FF4757" };
  const READ_LABEL = { unread: "unread", reading: "reading", read: "read", revisit: "go over again" };
  const nodeColor = (n) => (n.label === "Paper" ? (READ_COLOR[n.status] || READ_COLOR.unread) : colorOf(n.label));
  const EDGE_COLOR = {
    "cites": "#2DE2FF", "cites (reference)": "#5A9DE0",
    "introduces": "#8B7EC8", "authored by": "#4A6B85", "on the graph of": "#55697d",
  };
  // one colour per paper, for the encounter rings
  const RING_COLORS = ["#2DE2FF", "#F4709C", "#F0A030", "#8B7EC8", "#00F5D4", "#FF4757", "#5A9DE0", "#D4A017"];

  let S = null;
  let reload = () => {};

  function layout(nodes, edges, W, H) {
    const papers = nodes.filter((n) => n.label === "Paper");
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.34;
    papers.forEach((p, i) => {
      const a = (i / Math.max(1, papers.length)) * Math.PI * 2 - Math.PI / 2;
      p.x = cx + Math.cos(a) * R;
      p.y = cy + Math.sin(a) * R;
    });
    const byId = {};
    nodes.forEach((n) => (byId[n.id] = n));
    // a bridge sits at the centre of the papers it connects
    const bridges = nodes.filter((n) => n.label !== "Paper");
    bridges.forEach((b, i) => {
      const linked = edges.filter((e) => e.target === b.id).map((e) => byId[e.source]).filter(Boolean);
      if (!linked.length) { b.x = cx; b.y = cy; return; }
      b.x = linked.reduce((s, p) => s + p.x, 0) / linked.length;
      b.y = linked.reduce((s, p) => s + p.y, 0) / linked.length;
      // spread bridges that would otherwise stack on the same centroid
      const t = i * 2.399;
      const jitter = linked.length > 1 ? 26 : 46;
      b.x += Math.cos(t) * jitter;
      b.y += Math.sin(t) * jitter;
    });
  }

  function fitToView() {
    const vis = S.nodes.filter((n) => !S.hidden.has(n.label));
    if (!vis.length) { S.zoom = 1; S.pan = { x: 0, y: 0 }; return; }
    const xs = vis.map((n) => n.x), ys = vis.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 110;                       // titles are long — leave room
    const z = Math.min(
      (S.canvas.width - pad * 2) / Math.max(1, maxX - minX),
      (S.canvas.height - pad * 2) / Math.max(1, maxY - minY),
    );
    S.zoom = Math.max(0.3, Math.min(1.9, z));
    S.pan = {
      x: S.canvas.width / 2 - ((minX + maxX) / 2) * S.zoom,
      y: S.canvas.height / 2 - ((minY + maxY) / 2) * S.zoom,
    };
  }

  function draw() {
    const { ctx, canvas, nodes, edges, hidden, byId } = S;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(S.pan.x, S.pan.y);
    ctx.scale(S.zoom, S.zoom);

    const vis = (n) => n && !hidden.has(n.label);
    const touching = S.selected
      ? new Set(edges.filter((e) => e.source === S.selected.id || e.target === S.selected.id)
          .flatMap((e) => [e.source, e.target]))
      : null;

    edges.forEach((e) => {
      const a = byId[e.source], b = byId[e.target];
      if (!vis(a) || !vis(b)) return;
      const lit = touching && (e.source === S.selected.id || e.target === S.selected.id);
      ctx.strokeStyle = EDGE_COLOR[e.type] || "#55697d";
      ctx.globalAlpha = touching ? (lit ? 0.95 : 0.10) : (e.type.startsWith("cites") ? 0.8 : 0.4);
      ctx.lineWidth = e.type.startsWith("cites") ? 1.8 : 1;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.globalAlpha = 1;
    });

    nodes.forEach((n) => {
      if (!vis(n)) return;
      const isPaper = n.label === "Paper";
      const r = isPaper ? 9 + Math.min(7, n.degree * 0.8) : 4 + Math.min(5, (n.shared || 1) * 1.6);
      ctx.globalAlpha = touching && !touching.has(n.id) && n !== S.selected ? 0.18 : 1;
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = nodeColor(n); ctx.fill();
      if (n === S.selected) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke(); }
      if (isPaper || (n.shared || 0) > 1 || S.zoom > 1.4 || n === S.selected) {
        ctx.fillStyle = isPaper ? "#e6edf4" : "#93a5b8";
        ctx.font = (isPaper ? "bold 11px" : "10px") + " monospace";
        ctx.fillText(n.name.slice(0, isPaper ? 34 : 24), n.x + r + 4, n.y + 3);
      }
      ctx.globalAlpha = 1;
    });
    ctx.restore();
  }

  function nodeAt(px, py) {
    const x = (px - S.pan.x) / S.zoom, y = (py - S.pan.y) / S.zoom;
    let best = null, bd = 16 / S.zoom;
    S.nodes.forEach((n) => {
      if (S.hidden.has(n.label)) return;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bd) { bd = d; best = n; }
    });
    return best;
  }

  function wire(canvas, detail) {
    const pos = (ev) => {
      const r = canvas.getBoundingClientRect();
      return { x: (ev.clientX - r.left) * (canvas.width / r.width), y: (ev.clientY - r.top) * (canvas.height / r.height) };
    };
    canvas.addEventListener("mousedown", (ev) => {
      const p = pos(ev);
      const n = nodeAt(p.x, p.y);
      S.selected = n || null;
      showDetail(detail, n);
      draw();
      S.drag = { x: ev.clientX, y: ev.clientY, px: S.pan.x, py: S.pan.y };
    });
    canvas.addEventListener("mousemove", (ev) => {
      if (!S.drag) return;
      S.pan.x = S.drag.px + (ev.clientX - S.drag.x);
      S.pan.y = S.drag.py + (ev.clientY - S.drag.y);
      draw();
    });
    ["mouseup", "mouseleave"].forEach((e) => canvas.addEventListener(e, () => { S.drag = null; }));
    canvas.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const p = pos(ev);
      const nz = Math.max(0.3, Math.min(6, S.zoom * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)));
      S.pan.x = p.x - (p.x - S.pan.x) * (nz / S.zoom);
      S.pan.y = p.y - (p.y - S.pan.y) * (nz / S.zoom);
      S.zoom = nz;
      draw();
    }, { passive: false });
  }

  function showDetail(host, n) {
    clear(host);
    if (!n) { host.appendChild(el("div.sub", { text: "Click a paper to see what connects it to the rest of your library." })); return; }
    const links = S.edges
      .filter((e) => e.source === n.id || e.target === n.id)
      .map((e) => ({ type: e.type, other: S.byId[e.source === n.id ? e.target : e.source] }))
      .filter((x) => x.other);
    host.appendChild(el("div", {}, [
      el("h3", { style: "margin:0;color:" + nodeColor(n), text: n.name }),
      el("div.sub", { text: n.label + " · " + links.length + " connection" + (links.length === 1 ? "" : "s")
        + (n.label === "Paper" ? " · " + (READ_LABEL[n.status] || "unread")
          + (n.understanding == null ? "" : " · understanding " + n.understanding + "/10") : "") }),
    ]));
    if (!links.length) {
      host.appendChild(el("div.sub", { style: "margin-top:8px", text: "Nothing links this one yet." }));
      return;
    }
    const list = el("div", { style: "margin-top:8px;display:flex;flex-direction:column;gap:4px" });
    links.forEach((x) => list.appendChild(el("div.row", {
      style: "gap:8px;cursor:pointer",
      onclick: () => { S.selected = x.other; showDetail(host, x.other); draw(); },
    }, [
      el("span.mono", { style: "font-size:10px;color:" + (EDGE_COLOR[x.type] || "var(--muted)") + ";min-width:120px", text: x.type }),
      el("span.tk-tag", { style: "background:var(--raised);color:" + colorOf(x.other.label), text: x.other.label }),
      el("span", { style: "font-size:12px", text: x.other.name.slice(0, 60) }),
    ])));
    host.appendChild(list);
  }

  /* Encounters — the concept-recurrence data behind the rings. */
  function renderEncounters(host, enc, order) {
    clear(host);
    const multi = (enc.encounters || []).filter((e) => e.count > 1);
    host.appendChild(el("div.spread", {}, [
      el("h3", { style: "margin:0", text: "Encounters" }),
      el("span.sub", { text: "a concept met in more than one paper — the more papers, the more it keeps recurring" }),
    ]));
    if (!multi.length) {
      host.appendChild(el("div.sub", { style: "margin-top:8px", text: "No concept has appeared in more than one paper yet." }));
    } else {
      const list = el("div", { style: "margin-top:8px;display:flex;flex-direction:column;gap:5px" });
      multi.forEach((e) => list.appendChild(el("div.row", { style: "gap:8px;flex-wrap:wrap" }, [
        el("span", { style: "font-family:var(--mono);font-size:12px", text: "◎".repeat(Math.min(e.count, 6)) + " " + e.concept }),
        ...e.rings.map((r) => el("span.tk-tag", {
          title: r.paper_title,
          style: "background:var(--raised);color:" + RING_COLORS[(order[r.paper_id] || 0) % RING_COLORS.length],
          text: r.paper_title.slice(0, 26),
        })),
      ])));
      host.appendChild(list);
    }
    (enc.suggestions || []).forEach((s) => {
      host.appendChild(el("div.row", { style: "gap:8px;margin-top:6px;flex-wrap:wrap" }, [
        el("span", { style: "font-size:12px;color:var(--amber)", text: "“" + s.concept + "” in " + s.paper_title.slice(0, 30) + "?" }),
        el("span.sub", { style: "font-size:11px", text: "matched " + s.reason }),
        el("button.btn-sm", { onclick: () => rule(s, "confirmed"), text: "✓ same concept" }),
        el("button.btn-sm.btn-danger", { onclick: () => rule(s, "rejected"), text: "✕ not the same" }),
      ]));
    });
    function rule(s, state) {
      guard(async () => {
        await api.post("/api/synapse/kg/encounters/rule?concept=" + encodeURIComponent(s.concept)
          + "&paper_id=" + encodeURIComponent(s.paper_id) + "&state=" + state);
        toast(state === "confirmed" ? "encounter confirmed" : "dismissed");
        reload();
      });
    }
  }

  window.Views = window.Views || {};
  window.Views.kg = {
    id: "kg", label: "Knowledge Graph", scoped: false,
    async render(view) {
      clear(view);
      view.appendChild(el("div.view-head", {}, [el("div", {}, [
        el("h1", { text: "Knowledge Graph" }),
        el("div.sub", { text: "How your papers connect — citations, shared concepts, shared authors. Scroll to zoom, drag to pan, click a node to trace its links." }),
      ])]));

      const bar = el("div.row", { style: "gap:8px;margin-bottom:10px;flex-wrap:wrap" });
      view.appendChild(bar);
      // max-width keeps the canvas at native size rather than being upscaled
      // taller than the viewport (width:100% alone scales height with it)
      const canvas = el("canvas", { width: 1180, height: 560,
        style: "width:100%;max-width:1180px;display:block;border:1px solid var(--border);border-radius:10px;background:var(--surface);cursor:grab" });
      view.appendChild(canvas);
      const detail = el("div.card", { style: "margin-top:12px" });
      view.appendChild(detail);
      const encHost = el("div.card", { style: "margin-top:12px" });
      view.appendChild(encHost);

      let sharedOnly = true;

      reload = async () => {
        const [d, enc] = await guard(() => Promise.all([
          api.get("/api/synapse/kg/papers?shared_only=" + sharedOnly),
          api.get("/api/synapse/kg/encounters"),
        ]));
        const byId = {};
        d.nodes.forEach((n) => (byId[n.id] = n));
        layout(d.nodes, d.edges, canvas.width, canvas.height);
        S = { canvas, ctx: canvas.getContext("2d"), nodes: d.nodes, edges: d.edges, byId,
              hidden: S ? S.hidden : new Set(), selected: null, drag: null,
              pan: { x: 0, y: 0 }, zoom: 1 };
        wire(canvas, detail);
        fitToView();
        drawBar(d);
        draw();
        showDetail(detail, null);
        const order = {};
        (enc.papers || []).forEach((p, i) => { order[p.id] = i; });
        renderEncounters(encHost, enc, order);
      };

      function drawBar(d) {
        clear(bar);
        bar.appendChild(el("span.sub", {
          text: d.counts.papers + " papers · " + d.counts.bridges + " shared concepts/authors · " + d.counts.links + " links",
        }));
        bar.appendChild(el("button.btn-sm", { onclick: () => { fitToView(); draw(); }, text: "fit" }));
        bar.appendChild(el("button.btn-sm" + (sharedOnly ? ".heat-on" : ""), {
          title: "only draw a concept or author that connects two or more papers",
          onclick: () => { sharedOnly = !sharedOnly; reload(); },
          text: sharedOnly ? "shared only" : "showing everything",
        }));
        bar.appendChild(el("span.sub", { text: "│" }));
        ["Paper", "Concept", "Author", "Topic"].forEach((label) => {
          if (!d.nodes.some((n) => n.label === label)) return;
          const on = !S.hidden.has(label);
          bar.appendChild(el("button.btn-sm", {
            style: "border-color:" + colorOf(label) + (on ? ";color:" + colorOf(label) : ";opacity:.4"),
            onclick: () => { on ? S.hidden.add(label) : S.hidden.delete(label); fitToView(); drawBar(d); draw(); },
            text: label,
          }));
        });
      }

      await reload();
    },
  };
})();
