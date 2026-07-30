/* vision-portfolio.js — Vision · Portfolio (VISION_SPEC §4).

   Project showcase cards. Stored as (:PortfolioProject) — deliberately NOT the
   Mainframe-level (:Project) behind the shared Project tab, which is a working
   file store. These are things you show people. */
(function () {
  const { el, clear, toast, guard, confirmDo } = window.ui;
  const V = () => window.api.vision;
  const api = window.api;

  const TYPES = [
    { key: "Code", icon: "💻" }, { key: "Research", icon: "🔬" }, { key: "Video", icon: "🎬" },
    { key: "Design", icon: "🎨" }, { key: "Tool", icon: "🔧" }, { key: "Writing", icon: "✍️" },
    { key: "Other", icon: "📦" },
  ];
  const iconOf = (k) => (TYPES.find((t) => t.key === k) || TYPES[6]).icon;
  const open = new Set();

  function card(p, reload) {
    const isOpen = open.has(p.id);
    const cover = el("div.vpf-cover", p.image ? { style: "background-image:url(" + p.image + ")" } : {});
    if (!p.image) cover.appendChild(el("div.vsb-empty", { style: "font-size:26px", text: iconOf(p.type) }));
    cover.appendChild(el("div.vpf-type", { text: iconOf(p.type) + " " + p.type }));
    cover.addEventListener("click", () => { isOpen ? open.delete(p.id) : open.add(p.id); reload(); });

    const c = el("div.vpf-card", {}, [
      cover,
      el("div", { style: "padding:11px 13px 13px" }, [
        el("div", { style: "font-weight:600;font-size:13px", text: p.title }),
        p.description ? el("div.sub", { style: "margin-top:4px;line-height:1.45", text: p.description }) : null,
        (p.tags || []).length ? el("div.row", { style: "gap:4px;flex-wrap:wrap;margin-top:6px" },
          p.tags.map((t) => el("span.pulse-chip", { style: "font-size:10px", text: t }))) : null,
        p.link ? el("div", { style: "margin-top:7px" }, [
          el("a", { href: p.link, target: "_blank", rel: "noopener noreferrer",
            style: "color:var(--blue);font-size:11px", text: "open ↗" })]) : null,
      ]),
    ]);
    if (!isOpen) return c;

    const body = el("div", { style: "padding:0 13px 13px" });
    const field = (label, node) => el("label.md-field", {}, [el("span.sub", { text: label }), node]);
    const bind = (input, key) => {
      input.addEventListener("blur", () => guard(async () => {
        if ((input.value || "") === (p[key] || "")) return;
        await V().updatePortfolio(p.id, { [key]: input.value }); p[key] = input.value; toast("saved");
      }));
      return input;
    };
    const typeSel = el("select", {}, TYPES.map((t) => el("option", { value: t.key, text: t.icon + " " + t.key })));
    typeSel.value = p.type;
    typeSel.addEventListener("change", () => guard(async () => {
      await V().updatePortfolio(p.id, { type: typeSel.value }); reload();
    }));
    const tagsIn = el("input", { value: (p.tags || []).join(", "), placeholder: "comma, separated" });
    tagsIn.addEventListener("blur", () => guard(async () => {
      const tags = tagsIn.value.split(",").map((x) => x.trim()).filter(Boolean);
      if (tags.join("|") === (p.tags || []).join("|")) return;
      await V().updatePortfolio(p.id, { tags }); p.tags = tags; toast("saved");
    }));
    const imgIn = bind(el("input", { value: p.image || "", placeholder: "image URL" }), "image");

    const fileIn = el("input.img-file", { type: "file", accept: ".png,.jpg,.jpeg,.gif,.webp,.svg" });
    fileIn.addEventListener("change", () => {
      const f = fileIn.files && fileIn.files[0];
      if (!f) return;
      window.Images.nameModal(f.name.replace(/\.[^.]+$/, ""), (name) => guard(async () => {
        const img = await api.images.upload(f, name, "vision", p.id);
        await V().updatePortfolio(p.id, { image: api.images.fileUrl(img.id) });
        fileIn.value = ""; toast("image set"); reload();
      }));
    });

    body.appendChild(el("div.md-grid", {}, [
      field("title", bind(el("input", { value: p.title }), "title")),
      field("type", typeSel),
      field("link", bind(el("input", { value: p.link || "", placeholder: "https://" }), "link")),
      field("tags", tagsIn),
      field("image", imgIn),
    ]));
    const desc = el("textarea.mform-input", { rows: "3", placeholder: "what it is" });
    desc.value = p.description || "";
    desc.addEventListener("blur", () => guard(async () => {
      if ((desc.value || "") === (p.description || "")) return;
      await V().updatePortfolio(p.id, { description: desc.value }); p.description = desc.value; toast("saved");
    }));
    body.appendChild(el("div", { style: "margin-top:9px" }, [el("div.mform-label", { text: "Description" }), desc]));
    body.appendChild(el("div.row", { style: "gap:6px;margin-top:9px" }, [
      fileIn, el("button.btn-sm", { onclick: () => fileIn.click(), text: "⤒ upload image" }),
      el("button.btn-sm.btn-danger", { style: "margin-left:auto",
        onclick: () => confirmDo("Delete “" + p.title + "”?", async () => {
          await V().delPortfolio(p.id); open.delete(p.id); reload();
        }), text: "delete" }),
    ]));
    c.appendChild(body);
    return c;
  }

  window.Views = window.Views || {};
  window.Views.portfolio = {
    id: "portfolio", label: "Portfolio", scoped: false,
    async render(view) {
      clear(view);
      view.appendChild(el("div.view-head", {}, [el("div", {}, [
        el("h1", { text: "Portfolio" }),
        el("div.sub", { text: "Things worth showing people — click a card to edit it." }),
      ])]));

      const titleIn = el("input", { placeholder: "project title", style: "flex:1;min-width:180px" });
      const typeSel = el("select", {}, TYPES.map((t) => el("option", { value: t.key, text: t.icon + " " + t.key })));
      const add = () => guard(async () => {
        if (!titleIn.value.trim()) return toast("give it a title", true);
        await V().createPortfolio({ title: titleIn.value.trim(), type: typeSel.value });
        titleIn.value = ""; toast("added"); reload();
      });
      titleIn.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
      view.appendChild(el("div.row", { style: "margin-bottom:16px" }, [
        titleIn, typeSel, el("button.btn-primary", { onclick: add, text: "+ project" }),
      ]));
      const host = el("div"); view.appendChild(host);

      async function reload() {
        const items = await guard(() => V().portfolio());
        clear(host);
        if (!items.length) {
          host.appendChild(el("div.empty", { text: "Nothing in the portfolio yet." }));
          return;
        }
        const grid = el("div.vpf-grid");
        items.forEach((p) => grid.appendChild(card(p, reload)));
        host.appendChild(grid);
      }
      reload();
    },
  };
})();
