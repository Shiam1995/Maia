/* gantt.js — Gantt view: each task is one bar on a calendar time axis, from when
   you first worked it → when you finished (or now, if ongoing). Bars on separate
   rows overlap in time when work ran in parallel. Read /api/tasks. */
(function () {
  const { el, clear, guard } = window.ui;
  const api = window.api;

  const DAY = 86400000;
  const STATUS_COLOR = { done: "#00D4AA", active: "#F0A030", parked: "#7B8BA3" };

  function ms(iso) { const t = iso ? new Date(iso).getTime() : NaN; return isFinite(t) ? t : NaN; }
  function fmt(t) { return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
  function fmtFull(t) { return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
  function fmtMins(m) { m = m || 0; const h = Math.floor(m / 60), r = m % 60; return (h ? h + "h " : "") + r + "m"; }

  // start = earliest of (entry dates, created_at); end = done_at if done else now
  function span(t, now) {
    const dates = [];
    if (t.created_at) { const c = ms(t.created_at); if (isFinite(c)) dates.push(c); }
    (t.entries || []).forEach((e) => { const d = ms(e.date); if (isFinite(d)) dates.push(d); });
    let start = dates.length ? Math.min(...dates) : now;
    let end = t.done && t.done_at ? ms(t.done_at) : now;
    if (!isFinite(end)) end = now;
    if (end < start) end = start;
    return { start, end };
  }

  window.Views = window.Views || {};
  window.Views.gantt = {
    id: "gantt", label: "Gantt", scoped: false,
    async render(viewEl) {
      clear(viewEl);
      viewEl.appendChild(el("div.view-head", {}, [el("div", {}, [
        el("h1", { text: "Gantt" }),
        el("div.sub", { text: "How long things took — each task spans first-worked → finished (or now). Bars overlap when work ran in parallel." }),
      ])]));

      const tasks = (await guard(() => api.get("/api/tasks"))).filter((t) => t.status !== "hidden");
      if (!tasks.length) { viewEl.appendChild(el("div.empty", { text: "No tasks yet." })); return; }

      const now = Date.now();
      const rows = tasks.map((t) => ({ t, ...span(t, now) }));
      rows.sort((a, b) => a.start - b.start);
      let min = Math.min(...rows.map((r) => r.start));
      let max = Math.max(now, ...rows.map((r) => r.end));
      const pad = Math.max((max - min) * 0.03, DAY * 0.5);
      min -= pad; max += pad;
      const range = max - min || DAY;
      const pct = (t) => ((t - min) / range) * 100;

      // legend
      viewEl.appendChild(el("div.row", { style: "gap:14px;margin-bottom:12px;font-size:11px;color:var(--dim)" }, [
        el("span", { style: "color:" + STATUS_COLOR.done, text: "▬ done" }),
        el("span", { style: "color:" + STATUS_COLOR.active, text: "▬ active" }),
        el("span", { style: "color:" + STATUS_COLOR.parked, text: "▬ parked" }),
      ]));

      // axis
      const NTICKS = 7;
      const axisTicks = el("div.gantt-ticks");
      for (let i = 0; i <= NTICKS; i++) {
        const t = min + (range * i) / NTICKS;
        axisTicks.appendChild(el("div.gantt-tick", { style: "left:" + (i / NTICKS) * 100 + "%" }, [el("span", { text: fmt(t) })]));
      }
      viewEl.appendChild(el("div.gantt-axis", {}, [el("div.gantt-corner", { text: "task" }), axisTicks]));

      // rows
      const body = el("div.gantt-body");
      rows.forEach(({ t, start, end }) => {
        const track = el("div.gantt-track");
        const durDays = Math.max(1, Math.round((end - start) / DAY));
        const bar = el("div.gantt-bar", {
          style: "left:" + pct(start) + "%;width:" + Math.max(pct(end) - pct(start), 0.6) + "%;background:" + (STATUS_COLOR[t.done ? "done" : (t.status || "active")] || STATUS_COLOR.active),
          title: t.title + "\n" + fmtFull(start) + " → " + (t.done ? fmtFull(end) : "ongoing") + "\n" + durDays + " day span · " + fmtMins(t.total_mins) + " logged",
        }, [el("span.gantt-bar-lbl", { text: fmtMins(t.total_mins) + (t.done ? " · done" : "") })]);
        track.appendChild(bar);
        body.appendChild(el("div.gantt-row", {}, [
          el("div.gantt-name", { title: t.title }, [
            el("span", { style: "cursor:pointer", onclick: () => { const b = [...document.querySelectorAll("#tabs .tab")].find((x) => x.textContent.trim() === "Progress"); if (b) b.click(); }, text: t.title }),
            el("div.act-meta", {}, [el("span.pill", { text: t.horizon }), el("span.pill", { text: t.module })]),
          ]),
          track,
        ]));
      });
      viewEl.appendChild(el("div.gantt-wrap", {}, [body]));
    },
  };
})();
