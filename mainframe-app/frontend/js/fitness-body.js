/* fitness-body.js — Pulse Fitness Body Map: a stick-figure SVG with 19 clickable
   regions cycling clear → pain → imbalance → tight → clear. Plus body notes. */
(function () {
  const { el, clear, guard } = window.ui;
  const api = window.api;
  const P = window.PULSE;
  const NS = "http://www.w3.org/2000/svg";
  const CYCLE = { "": "pain", pain: "imbalance", imbalance: "tight", tight: "" };

  // region key → [x, y] on a 200×360 figure
  const REGIONS = [
    ["head", 100, 26], ["neck", 100, 54],
    ["r_shoulder", 74, 74], ["l_shoulder", 126, 74],
    ["chest", 100, 92], ["core", 100, 122], ["lower_back", 100, 150],
    ["r_arm", 58, 118], ["l_arm", 142, 118], ["r_hand", 48, 165], ["l_hand", 152, 165],
    ["r_hip", 86, 168], ["l_hip", 114, 168],
    ["r_quad", 84, 218], ["l_quad", 116, 218],
    ["r_knee", 84, 268], ["l_knee", 116, 268],
    ["r_calf", 84, 310], ["l_calf", 116, 310],
  ];
  function label(k) { return k.replace(/^r_/, "R ").replace(/^l_/, "L ").replace("_", " "); }
  function svg(tag, attrs) { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; }

  // Shared stick-figure builder — reused by the Day Review too. `onRegionClick`
  // gets (key, currentState, nextState); `highlight` is a Set of region keys to
  // glow (worked muscles).
  function buildBodySvg(points, onRegionClick, highlight) {
    const s = svg("svg", { viewBox: "0 0 200 360", width: "260", height: "auto", class: "bodymap" });
    s.appendChild(svg("circle", { cx: 100, cy: 26, r: 14, class: "fig" }));
    [[100, 40, 100, 160], [58, 118, 100, 70], [142, 118, 100, 70], [100, 160, 84, 310], [100, 160, 116, 310]]
      .forEach(([x1, y1, x2, y2]) => s.appendChild(svg("line", { x1, y1, x2, y2 })));
    REGIONS.forEach(([k, x, y]) => {
      const st = (points && points[k]) || "";
      const c = svg("circle", { cx: x, cy: y, r: 9 });
      let cls = st;
      if (highlight && highlight.has(k)) cls = (cls ? cls + " " : "") + "worked";
      if (cls) c.setAttribute("class", cls);
      const t = svg("title"); t.textContent = label(k) + (st ? " — " + st : ""); c.appendChild(t);
      if (onRegionClick) c.addEventListener("click", () => onRegionClick(k, st, CYCLE[st]));
      s.appendChild(c);
    });
    return s;
  }
  function legend() {
    return el("div.row", { style: "gap:12px;margin-top:10px;font-size:11px;color:var(--dim);flex-wrap:wrap" },
      [el("span", { text: "🔴 Pain" }), el("span", { text: "🟡 Imbalance" }), el("span", { text: "🟣 Tight" }), el("span", { text: "⚪ Clear" }), el("span", { text: "🩷 worked" })]);
  }
  window.FIT = window.FIT || {};
  window.FIT.buildBodySvg = buildBodySvg;
  window.FIT.bodyLegend = legend;

  async function render(host) {
    const wrap = el("div", { style: "display:grid;grid-template-columns:280px 1fr;gap:20px;align-items:start" });
    const left = el("div"); const right = el("div");
    wrap.appendChild(left); wrap.appendChild(right);
    host.appendChild(wrap);

    async function reload() {
      const data = await guard(() => api.pulse.fitness.body());
      const points = data.points || {};
      clear(left);
      left.appendChild(buildBodySvg(points, (k, st, next) => guard(async () => { await api.pulse.fitness.setBody(k, { state: next }); reload(); })));
      left.appendChild(legend());

      // notes panel
      clear(right);
      right.appendChild(el("h3", { style: "margin:0 0 8px", text: "Body notes" }));
      const inp = el("textarea.mform-input", { rows: "2", placeholder: "note about how the body feels…" });
      right.appendChild(inp);
      right.appendChild(el("div.row", { style: "margin:8px 0 12px" }, [
        el("button.btn-sm.btn-primary", { onclick: () => guard(async () => { if (!inp.value.trim()) return; await api.pulse.fitness.addBodyNote({ text: inp.value.trim() }); reload(); }), text: "＋ add note" }),
      ]));
      (data.notes || []).forEach((n) => right.appendChild(el("div", { style: "padding:6px 0;border-bottom:1px solid var(--border)" }, [
        el("div.sub", { text: P.fmtDay((n.date || "").slice(0, 10)) }), el("div", { text: n.text }),
      ])));
    }
    reload();
  }

  window.FIT_TABS = window.FIT_TABS || [];
  window.FIT_TABS.push({ key: "body", label: "Body Map", render });
})();
