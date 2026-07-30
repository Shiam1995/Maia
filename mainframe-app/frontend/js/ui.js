/* ui.js — tiny DOM + helper toolkit shared by every view.
   No framework; just enough sugar to keep the view code readable. */
(function () {
  // el("div.card", {onclick: fn}, [children|strings])
  function el(spec, attrs, children) {
    const [tag, ...classes] = spec.split(".");
    const node = document.createElement(tag || "div");
    if (classes.length) node.className = classes.join(" ");
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (k === "html") node.innerHTML = v;
        else if (k === "text") node.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, "");
        else if (v !== false && v != null) node.setAttribute(k, v);
      }
    }
    (children || []).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  let toastTimer = null;
  function toast(msg, isErr) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "toast" + (isErr ? " err" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
  }

  async function guard(fn) {
    try { return await fn(); }
    catch (e) { toast(e.message || String(e), true); throw e; }
  }

  // familiarity 0-10 → class + label per spec (red 0-3, amber 4-6, teal 7-10)
  function famClass(v) { return v <= 3 ? "fam-lo" : v <= 6 ? "fam-mid" : "fam-hi"; }

  function fmtDate(iso) {
    if (!iso) return "";
    return String(iso).slice(0, 10);
  }

  function confirmDo(msg, fn) {
    if (window.confirm(msg)) return guard(fn);
  }

  /* ---- stamping the current time -------------------------------------------
     Logging when you started and stopped is the most repeated action in the
     app, and typing 14:35 into a picker is the most tedious. Every date/time
     input gets a one-press "now" button, and start/end pairs get a single
     button that walks start → end like a stopwatch.

     Local time throughout: `new Date().toISOString()` is UTC and would write
     yesterday's date to anyone west of Greenwich after 00:00 UTC.             */
  const pad2 = (n) => String(n).padStart(2, "0");

  function nowHM(d) {
    d = d || new Date();
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function todayISO(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function nowFor(input) {
    const t = (input.getAttribute("type") || "text").toLowerCase();
    if (t === "date") return todayISO();
    if (t === "datetime-local") return todayISO() + "T" + nowHM();
    if (t === "month") return todayISO().slice(0, 7);
    return nowHM();
  }

  // Fire the events listeners are actually bound to. Setting .value in script
  // fires nothing, so a duration that syncs on "change" would never update.
  function setValue(input, value) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function stampNow(input) { setValue(input, nowFor(input)); return input.value; }

  /* A single button that stamps `input` with the current time/date. */
  function nowBtn(input, label) {
    const isDate = (input.getAttribute("type") || "") === "date";
    const b = el("button.now-btn", {
      type: "button",
      title: isDate ? "set to today" : "set to the time right now",
      text: label || (isDate ? "today" : "now"),
    });
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); stampNow(input); });
    return b;
  }

  /* One button that walks a start/end pair: press to start, press again to
     stop. Reflects whatever the inputs already hold, so it stays right when a
     saved session is reopened or a time is typed by hand. */
  function stampPair(startInput, endInput, opts) {
    opts = opts || {};
    const b = el("button.now-btn.now-btn-go", { type: "button" });
    const sync = () => {
      const s = startInput.value, e = endInput.value;
      b.textContent = !s ? "▶ start" : (!e ? "■ end" : "↺ again");
      b.title = !s ? "stamp the start time as right now"
        : (!e ? "stamp the end time as right now" : "clear both and start again");
      b.classList.toggle("running", !!s && !e);
    };
    b.addEventListener("click", (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (!startInput.value) stampNow(startInput);
      else if (!endInput.value) stampNow(endInput);
      else { setValue(startInput, ""); setValue(endInput, ""); }
      sync();
      if (opts.onChange) opts.onChange();
    });
    // A time typed by hand must move the button too.
    [startInput, endInput].forEach((i) => i.addEventListener("change", sync));
    sync();
    return b;
  }

  /* Give every date/time input a now button, including ones rendered later.
     Opt a field out with data-no-now (see .wl-table, where the row is a grid
     and an extra child would break the columns). */
  function decorate(root) {
    (root.querySelectorAll ? root.querySelectorAll(
      'input[type="time"],input[type="date"],input[type="datetime-local"]') : []
    ).forEach((input) => {
      if (input.dataset.nowDone || input.closest("[data-no-now]") || input.dataset.noNow != null) return;
      if (input.disabled || input.readOnly) return;
      input.dataset.nowDone = "1";
      input.insertAdjacentElement("afterend", nowBtn(input));
    });
  }

  function autoNow() {
    decorate(document.body);
    // Views re-render constantly and modals mount straight onto <body>, so
    // watch rather than decorating at each call site.
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; decorate(document.body); });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoNow);
  else autoNow();

  window.ui = { el, clear, toast, guard, famClass, fmtDate, confirmDo,
                nowHM, todayISO, stampNow, nowBtn, stampPair };
})();
