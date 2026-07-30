/* repo.js — the Repository: everything you read, watch or work through.

   Papers arrive as PDFs; books, video series and courses are typed in by hand.
   Both are the same :Paper node underneath, so an entry with no file still gets
   the workspace, its own instances, references and knowledge-graph nodes — a
   PDF is a thing an entry *can* have, not what it *is*. */
(function () {
  const { el, clear, toast, guard, confirmDo } = window.ui;

  let filters = { q: "", status: "", year: "", kind: "" };

  /* Finished reading is still part of the library, but it isn't what you're
     looking at day to day. Hidden by default, remembered across reloads —
     "read" is the finished state; "revisit" deliberately is not. */
  const SHOW_READ_KEY = "mf.repo.showRead";
  const showRead = () => localStorage.getItem(SHOW_READ_KEY) !== "0";
  const setShowRead = (v) => localStorage.setItem(SHOW_READ_KEY, v ? "1" : "0");

  // Icon + label per kind. Order is the order they appear in the pickers.
  const KINDS = [
    { key: "paper",   icon: "📄", label: "Paper" },
    { key: "book",    icon: "📕", label: "Book" },
    { key: "video",   icon: "🎬", label: "Video series" },
    { key: "course",  icon: "🎓", label: "Course" },
    { key: "article", icon: "📰", label: "Article" },
    { key: "note",    icon: "🗒️", label: "Note" },
  ];
  const KIND = (k) => KINDS.find((x) => x.key === k) || KINDS[0];

  function statusPill(s) { return el("span.pill." + s, { text: s }); }

  function kindTag(p) {
    const k = KIND(p.kind || "paper");
    return el("span.repo-kind", {
      title: k.label + (p.original_path ? " · has a PDF" : " · no file"),
      text: k.icon + " " + k.label.toLowerCase(),
    });
  }

  /* ---- form helpers ----
     Extraction only ever produces a starting point — for a book it may produce
     nothing at all — so every field it can fill is editable by hand, and a
     blank field clears the property rather than being ignored. */
  function field(label, value, opts) {
    const input = el((opts && opts.area) ? "textarea.mform-input" : "input.mform-input", {
      placeholder: (opts && opts.ph) || "", value: value == null ? "" : String(value),
    });
    return {
      node: el("div.mform-full", {}, [el("div.mform-label", { text: label }), input]),
      get: () => input.value.trim(),
      input,
    };
  }

  function kindField(label, value) {
    const input = el("select.mform-input", {}, KINDS.map((k) =>
      el("option", { value: k.key, text: k.icon + "  " + k.label })));
    input.value = value || "paper";
    return {
      node: el("div.mform-full", {}, [el("div.mform-label", { text: label }), input]),
      get: () => input.value,
      input,
    };
  }

  // Shared shell so the add and edit modals can't drift apart.
  function modal(titleText, note, fields, submitLabel, onSubmit) {
    const overlay = el("div.modal-overlay");
    const close = () => overlay.remove();
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
    const card = el("div.modal", {}, [
      el("div.modal-title", { text: titleText }),
      note.text
        ? el("div.sub", {
            style: "margin:-8px 0 14px;line-height:1.45" + (note.warn ? ";color:var(--red)" : ""),
            text: note.text })
        : null,
      ...fields.map((f) => (f && f.node) || f),
      el("div.row", { style: "margin-top:16px;gap:8px" }, [
        el("button.tk-btn.teal", { text: submitLabel, onclick: () => onSubmit(close) }),
        el("button.tk-btn", { text: "Cancel", onclick: close }),
      ]),
    ]);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        // app.js sends Escape home unless a .modal-overlay is on screen — it would
        // still be gone by the time the event bubbled up, so stop it here.
        e.stopPropagation();
        close();
      }
      if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") onSubmit(close);
    });
    return { overlay, card, close };
  }

  const authorList = (s) => (s ? s.split(",").map((a) => a.trim()).filter(Boolean) : []);
  const badYear = (y) => y && !/^\d{1,4}$/.test(y);

  /* ---- add a source by hand ----
     No file: a book you own on paper, a video series, a course. It lands in the
     same library as the PDFs and behaves the same everywhere afterwards. */
  function addModal() {
    const kind = kindField("What is it?", "book");
    const title = field("Title", "", { ph: "e.g. The C Programming Language" });
    const authors = field("Authors / creator", "", { ph: "comma-separated" });
    const year = field("Year", "", { ph: "e.g. 1978" });
    const venue = field("Publisher / channel", "", { ph: "publisher, channel, platform" });
    const url = field("Link", "", { ph: "playlist, course page, anywhere it lives" });
    const about = field("What it's about", "", { area: true, ph: "your own blurb — notes come later, on the entry itself" });

    const m = modal("Add a source", { text: "No file needed. You can attach a PDF later." },
      [kind, title, authors, el("div.mform-row", {}, [year.node, venue.node]), url, about],
      "Add", (close) => {
        if (!title.get()) return toast("a title is required", true);
        if (badYear(year.get())) return toast("year must be a number", true);
        guard(async () => {
          const p = await window.api.papers.create({
            kind: kind.get(), title: title.get(), authors: authorList(authors.get()),
            year: year.get() ? parseInt(year.get(), 10) : null,
            venue: venue.get() || null, url: url.get() || null,
            abstract: about.get() || null,
          });
          toast("added: " + p.title);
          close();
          load();
        });
      });
    m.card.querySelector("input,select").focus();
  }

  function editModal(p, note) {
    const kind = kindField("Kind", p.kind || "paper");
    const title = field("Title", p.title, { ph: "the real title" });
    const authors = field("Authors", (p.authors || []).join(", "), { ph: "comma-separated" });
    const year = field("Year", p.year, { ph: "e.g. 1979" });
    const venue = field("Venue / publisher", p.venue, { ph: "journal, conference, publisher or channel" });
    const url = field("Link", p.url, { ph: "where it lives" });
    const doi = field("DOI", p.doi);
    const arxiv = field("arXiv id", p.arxiv_id);
    const abstract = field("Abstract / blurb", p.abstract, { area: true });

    const m = modal("Edit details",
      note
        ? { text: note, warn: true }
        : { text: "Correct anything the scan got wrong — or anything you typed." },
      [kind, title, authors,
       el("div.mform-row", {}, [year.node, venue.node]),
       url,
       el("div.mform-row", {}, [doi.node, arxiv.node]),
       abstract],
      "Save", (close) => {
        if (!title.get()) return toast("a title is required", true);
        if (badYear(year.get())) return toast("year must be a number", true);
        guard(async () => {
          await window.api.papers.update(p.id, {
            // null (not "") clears — the backend patches on exclude_unset, and Neo4j
            // drops null properties, so an emptied field really does go away.
            kind: kind.get(),
            title: title.get(),
            authors: authorList(authors.get()),
            year: year.get() ? parseInt(year.get(), 10) : null,
            venue: venue.get() || null,
            url: url.get() || null,
            doi: doi.get() || null,
            arxiv_id: arxiv.get() || null,
            abstract: abstract.get() || null,
          });
          toast("saved");
          close();
          // PM.paper is the cached copy the Workspace/KG header reads. Refresh it in
          // place (not via selectPaper, which would navigate away from the repo).
          if (window.PM && window.PM.paper && window.PM.paper.id === p.id) {
            window.PM.paper = await window.api.papers.get(p.id);
          }
          load();
        });
      });
    title.input.focus();
    title.input.select();
    return m;
  }

  /* ◀ ▶ swap a card with its neighbour in the list as currently shown, so a
     move means what you see rather than what's behind a filter. */
  function move(list, idx, dir) {
    const a = list[idx], b = list[idx + dir];
    if (!a || !b) return;
    guard(async () => {
      // reorder() gives the listed ids the slots those same nodes already hold,
      // in the order listed — so the pair must be passed in the order you want
      // them to end up. Moving `a` earlier means a first; later means b first.
      await window.api.papers.reorder(dir < 0 ? [a.id, b.id] : [b.id, a.id]);
      load();
    });
  }

  function paperCard(p, list, idx) {
    const authors = (p.authors || []).join(", ") || "unknown authors";
    const meta = [p.year, p.venue].filter(Boolean).join(" · ");
    return el("div.card", {}, [
      // Year/venue used to lead the card, which put a publication detail above
      // the title. It's now a footnote just above the buttons, and it's simply
      // absent when there's nothing to say rather than showing an em-dash.
      el("div.spread", {}, [
        el("div.row", { style: "gap:2px" }, [
          el("button.btn-sm.repo-move", { title: "move earlier", disabled: idx === 0,
            onclick: () => move(list, idx, -1), text: "◀" }),
          el("button.btn-sm.repo-move", { title: "move later", disabled: idx === list.length - 1,
            onclick: () => move(list, idx, 1), text: "▶" }),
        ]),
        statusPill(p.status || "unread"),
      ]),
      el("h3", { style: "margin:8px 0 4px;cursor:pointer",
        onclick: () => window.PM.selectPaper(p.id) , text: p.title }),
      el("div.sub", { text: authors }),
      el("div.row", { style: "margin-top:6px;gap:6px;flex-wrap:wrap" }, [
        kindTag(p),
        p.url ? el("a.repo-link", { href: p.url, target: "_blank", rel: "noopener noreferrer",
          title: p.url, onclick: (e) => e.stopPropagation(), text: "↗ link" }) : null,
      ]),
      p.arxiv_id ? el("div.mono", { style: "font-size:10.5px;color:var(--muted);margin-top:6px", text: "arXiv:" + p.arxiv_id }) : null,
      meta ? el("div.mono", { style: "font-size:11px;color:var(--muted);margin-top:10px", text: meta }) : null,
      el("div.row", { style: "margin-top:8px" }, [
        el("button.btn-sm", { onclick: () => window.PM.selectPaper(p.id), text: "open" }),
        el("button.btn-sm", { onclick: () => guard(async () => {
          const up = await window.api.papers.cycle(p.id);
          toast("status → " + up.status); load();
        }), text: "cycle status" }),
        el("button.btn-sm", { title: "edit title and details by hand", onclick: () => editModal(p), text: "✎ edit" }),
        el("button.btn-sm.btn-danger", { onclick: () => confirmDo("Delete “" + p.title + "” and its data?", async () => {
          await window.api.papers.del(p.id); toast("deleted"); load();
        }), text: "×" }),
      ]),
    ]);
  }

  async function load() {
    const view = document.getElementById("view-body-repo");
    if (!view) return;
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.status) params.set("status", filters.status);
    if (filters.year) params.set("year", filters.year);
    if (filters.kind) params.set("kind", filters.kind);
    const qs = params.toString() ? "?" + params.toString() : "";
    const all = await guard(() => window.api.papers.list(qs));
    // The "read" filter is explicitly about finished papers, so it ignores the
    // toggle; everywhere else the toggle decides.
    const papers = (filters.status === "read" || showRead())
      ? all : all.filter((p) => (p.status || "unread") !== "read");
    const hidden = all.length - papers.length;
    clear(view);

    if (!papers.length) {
      const filtered = filters.q || filters.status || filters.year || filters.kind;
      view.appendChild(el("div.empty", { text: hidden
        ? "Everything here is finished — " + hidden + " hidden."
        : filtered
          ? "Nothing matches those filters."
          : "Nothing here yet — upload a PDF, or add a book or video series by hand." }));
      return;
    }
    if (hidden) {
      view.appendChild(el("div.sub", { style: "margin-bottom:8px;font-size:11px",
        text: hidden + " finished paper" + (hidden === 1 ? "" : "s") + " hidden" }));
    }
    const grid = el("div.cards");
    papers.forEach((p, i) => grid.appendChild(paperCard(p, papers, i)));
    view.appendChild(grid);
  }

  /* ---- upload ----
     The scan is a choice, not a step. A book whose opening pages are a cover —
     or a scanned one with no text at all — is better typed in, so untick it and
     the local LLM is never called. */
  function uploadBar() {
    const fileInput = el("input", { type: "file", accept: "application/pdf", style: "display:none" });
    const kind = el("select.repo-mini", {}, KINDS.map((k) =>
      el("option", { value: k.key, text: k.icon + " " + k.label })));
    const scan = el("input", { type: "checkbox", id: "repo-scan" });
    scan.checked = true;

    fileInput.addEventListener("change", async () => {
      if (!fileInput.files.length) return;
      const doScan = scan.checked;
      const form = new FormData();
      form.append("file", fileInput.files[0]);
      form.append("kind", kind.value);
      form.append("scan", doScan ? "true" : "false");
      toast(doScan ? "uploading + reading it (local LLM)…" : "uploading…");
      await guard(async () => {
        const p = await window.api.papers.upload(form);
        fileInput.value = "";
        load();
        if (p._warning) {
          // A scan has no text to read, so the title is a filename guess. Open
          // the editor with the reason stated in it — a toast would fade while
          // they're still reading, and the guess would then look like a reading.
          editModal(p, p._warning);
          return;
        }
        if (!doScan) {
          // Nothing was read, so the title is only the filename. Open the editor
          // rather than leaving it sitting there looking finished.
          toast("added — now name it");
          editModal(p, "Not scanned, as you asked. The title is just the filename — set it here.");
          return;
        }
        toast("added: " + p.title + "  [" + (p._extraction_source || "?") + "]");
      });
    });

    return el("div.row", { style: "gap:8px;align-items:center" }, [
      kind,
      el("label.repo-scan-lbl", { title: "Read the first pages with the local LLM to fill in the details. Untick for books and scans." },
        [scan, el("span", { text: "read it" })]),
      el("button.btn-primary", { onclick: () => fileInput.click(), text: "+ Upload PDF" }),
      el("button.btn-primary", { onclick: () => addModal(), title: "a book, a video series, a course — no file needed", text: "+ Add source" }),
      fileInput,
    ]);
  }

  function filterBar() {
    const q = el("input", { placeholder: "search title / author", value: filters.q, style: "width:200px" });
    q.addEventListener("input", () => { filters.q = q.value; load(); });
    const status = el("select", {}, [
      el("option", { value: "", text: "all status" }),
      el("option", { value: "unread", text: "unread" }),
      el("option", { value: "reading", text: "reading" }),
      el("option", { value: "read", text: "read" }),
      el("option", { value: "revisit", text: "revisit" }),
    ]);
    status.value = filters.status;
    status.addEventListener("change", () => { filters.status = status.value; load(); });
    const year = el("input", { placeholder: "year", value: filters.year, style: "width:80px" });
    year.addEventListener("input", () => { filters.year = year.value.trim(); load(); });
    const kind = el("select", {}, [
      el("option", { value: "", text: "all kinds" }),
      ...KINDS.map((k) => el("option", { value: k.key, text: k.icon + " " + k.label })),
    ]);
    kind.value = filters.kind;
    kind.addEventListener("change", () => { filters.kind = kind.value; load(); });

    // Cuts across the other filters, so it's a toggle rather than another
    // dropdown value — "all kinds" should still mean unfinished unless you say.
    const readToggle = el("button.btn-sm");
    const paint = () => {
      const on = showRead();
      readToggle.classList.toggle("heat-on", on);
      readToggle.textContent = on ? "✓ finished shown" : "finished hidden";
      readToggle.title = on ? "hide papers you've finished" : "show finished papers too";
    };
    readToggle.addEventListener("click", () => { setShowRead(!showRead()); paint(); load(); });
    paint();

    return el("div.row", {}, [q, kind, status, year, readToggle]);
  }

  window.Views = window.Views || {};
  window.Views.repo = {
    id: "repo", label: "Repository", scoped: false,
    render(view) {
      clear(view);
      view.appendChild(el("div.view-head", {}, [
        el("div", {}, [ el("h1", { text: "Repository" }),
          el("div.sub", { text: "Everything you read, watch or work through — papers, books, video series, courses. A PDF is optional." }) ]),
        uploadBar(),
      ]));
      view.appendChild(filterBar());
      view.appendChild(el("div", { id: "view-body-repo", style: "margin-top:16px" }));
      load();
    },
  };
})();
