/* vision-network.js — Vision · Network (VISION_SPEC §5).

   Content-world contacts: who they are, where you connect, how you know them.
   Avatar falls back to the initial letter when there's no image. */
(function () {
  const { el, clear, toast, guard, confirmDo } = window.ui;
  const V = () => window.api.vision;
  const api = window.api;

  const open = new Set();

  function card(c, reload) {
    const isOpen = open.has(c.id);
    const avatar = c.avatar
      ? el("div.vnet-avatar", { style: "background-image:url(" + c.avatar + ")" })
      : el("div.vnet-avatar.initial", { text: (c.name || "?").trim().charAt(0).toUpperCase() });

    const head = el("div.row", { style: "gap:11px;cursor:pointer;align-items:flex-start",
      onclick: () => { isOpen ? open.delete(c.id) : open.add(c.id); reload(); } }, [
      avatar,
      el("div", { style: "flex:1;min-width:0" }, [
        el("div.row", { style: "gap:7px;flex-wrap:wrap" }, [
          el("span", { style: "font-weight:600", text: c.name }),
          c.platform ? el("span.vw-tag", { style: "color:var(--blue)", text: c.platform }) : null,
        ]),
        c.role ? el("div.sub", { style: "margin-top:2px", text: c.role }) : null,
        c.notes && !isOpen ? el("div.sub", { style: "margin-top:4px", text: c.notes }) : null,
      ]),
      el("button.ord-btn", { text: isOpen ? "▾" : "▸" }),
    ]);
    const wrap = el("div.vision-card", {}, [head]);
    if (!isOpen) return wrap;

    const body = el("div", { style: "margin-top:12px;padding-top:11px;border-top:1px solid var(--border)" });
    const field = (label, node) => el("label.md-field", {}, [el("span.sub", { text: label }), node]);
    const bind = (input, key) => {
      input.addEventListener("blur", () => guard(async () => {
        if ((input.value || "") === (c[key] || "")) return;
        await V().updateContact(c.id, { [key]: input.value }); c[key] = input.value; toast("saved");
      }));
      return input;
    };
    const fileIn = el("input.img-file", { type: "file", accept: ".png,.jpg,.jpeg,.gif,.webp,.svg" });
    fileIn.addEventListener("change", () => {
      const f = fileIn.files && fileIn.files[0];
      if (!f) return;
      window.Images.nameModal(f.name.replace(/\.[^.]+$/, ""), (name) => guard(async () => {
        const img = await api.images.upload(f, name, "vision", c.id);
        await V().updateContact(c.id, { avatar: api.images.fileUrl(img.id) });
        fileIn.value = ""; toast("avatar set"); reload();
      }));
    });

    body.appendChild(el("div.md-grid", {}, [
      field("name", bind(el("input", { value: c.name }), "name")),
      field("role", bind(el("input", { value: c.role || "", placeholder: "e.g. AI YouTuber" }), "role")),
      field("platform", bind(el("input", { value: c.platform || "", placeholder: "where you connect" }), "platform")),
      field("link", bind(el("input", { value: c.link || "", placeholder: "profile URL" }), "link")),
      field("avatar", bind(el("input", { value: c.avatar || "", placeholder: "image URL" }), "avatar")),
    ]));
    const notes = el("textarea.mform-input", { rows: "3", placeholder: "how you know them, collaboration ideas" });
    notes.value = c.notes || "";
    notes.addEventListener("blur", () => guard(async () => {
      if ((notes.value || "") === (c.notes || "")) return;
      await V().updateContact(c.id, { notes: notes.value }); c.notes = notes.value; toast("saved");
    }));
    body.appendChild(el("div", { style: "margin-top:9px" }, [el("div.mform-label", { text: "Notes" }), notes]));
    body.appendChild(el("div.row", { style: "gap:6px;margin-top:9px" }, [
      fileIn, el("button.btn-sm", { onclick: () => fileIn.click(), text: "⤒ upload avatar" }),
      c.link ? el("a.btn-sm", { href: c.link, target: "_blank", rel: "noopener noreferrer",
        style: "text-decoration:none", text: "open ↗" }) : null,
      el("button.btn-sm.btn-danger", { style: "margin-left:auto",
        onclick: () => confirmDo("Delete “" + c.name + "”?", async () => {
          await V().delContact(c.id); open.delete(c.id); reload();
        }), text: "delete" }),
    ]));
    wrap.appendChild(body);
    return wrap;
  }

  window.Views = window.Views || {};
  window.Views.network = {
    id: "network", label: "Network", scoped: false,
    async render(view) {
      clear(view);
      view.appendChild(el("div.view-head", {}, [el("div", {}, [
        el("h1", { text: "Network" }),
        el("div.sub", { text: "People in the content world — who they are and how you know them." }),
      ])]));

      const nameIn = el("input", { placeholder: "name", style: "flex:1;min-width:150px" });
      const roleIn = el("input", { placeholder: "role (optional)", style: "flex:1;min-width:150px" });
      const add = () => guard(async () => {
        if (!nameIn.value.trim()) return toast("a contact needs a name", true);
        await V().createContact({ name: nameIn.value.trim(), role: roleIn.value.trim() });
        nameIn.value = roleIn.value = ""; toast("added"); reload();
      });
      nameIn.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
      view.appendChild(el("div.row", { style: "margin-bottom:16px" }, [
        nameIn, roleIn, el("button.btn-primary", { onclick: add, text: "+ contact" }),
      ]));
      const host = el("div"); view.appendChild(host);

      async function reload() {
        const items = await guard(() => V().network());
        clear(host);
        if (!items.length) {
          host.appendChild(el("div.empty", { text: "No contacts yet." }));
          return;
        }
        items.forEach((c) => host.appendChild(card(c, reload)));
      }
      reload();
    },
  };
})();
