/* vault-inventory.js — Vault · Inventory (VAULT_SPEC §7).

   Three separate sections, deliberately not merged (spec: do NOT combine
   need/want into one list):
     1. What you have  — active / in-use / owned / stored, grouped by category
     2. Need to buy    — red border, with estimated price
     3. Want to buy    — purple border, the wishlist */
(function () {
  const { el, clear, toast, guard, confirmDo } = window.ui;
  const api = window.api;
  const V = window.VAULT;

  const CATS = [
    { key: "tech", icon: "🖥" }, { key: "books", icon: "📚" }, { key: "gaming", icon: "🎮" },
    { key: "tools", icon: "🛠" }, { key: "clothing", icon: "👕" },
    { key: "furniture", icon: "🪑" }, { key: "other", icon: "📌" },
  ];
  const icon = (k) => (CATS.find((c) => c.key === k) || CATS[6]).icon;

  const STATUS = {
    active: "var(--green)", "in-use": "var(--teal)", owned: "var(--dim)",
    stored: "var(--dim)", need: "var(--red)", want: "var(--purple)",
    broken: "var(--red)", sold: "var(--muted)",
  };
  const ALL_STATUS = Object.keys(STATUS);
  const HAVE = ["active", "in-use", "owned", "stored"];

  function itemRow(it, reload) {
    const statusSel = el("select.cellinput", { style: "color:" + (STATUS[it.status] || "var(--dim)") },
      ALL_STATUS.map((s) => el("option", { value: s, text: s })));
    statusSel.value = it.status;
    statusSel.addEventListener("change", () => guard(async () => {
      await api.vault.updateItem(it.id, { status: statusSel.value }); toast("status changed"); reload();
    }));
    const nameIn = el("input", { value: it.name, style: "flex:1;min-width:120px;background:transparent;border:none;padding:0" });
    nameIn.addEventListener("blur", () => guard(async () => {
      const nv = nameIn.value.trim();
      if (!nv || nv === it.name) { nameIn.value = it.name; return; }
      await api.vault.updateItem(it.id, { name: nv }); it.name = nv; toast("saved");
    }));
    const locIn = el("input", { value: it.location || "", placeholder: "where?", style: "width:130px" });
    locIn.addEventListener("blur", () => guard(async () => {
      if ((locIn.value || "") === (it.location || "")) return;
      await api.vault.updateItem(it.id, { location: locIn.value }); it.location = locIn.value; toast("saved");
    }));
    const valIn = el("input", { type: "number", step: "0.01", value: String(it.value || 0),
      style: "width:92px;text-align:right" });
    valIn.addEventListener("blur", () => guard(async () => {
      const nv = parseFloat(valIn.value);
      if (isNaN(nv) || nv === Number(it.value)) return;
      await api.vault.updateItem(it.id, { value: nv }); it.value = nv; toast("saved");
    }));

    return el("div.vlt-item", {}, [
      el("div.row", { style: "gap:8px;min-width:0;flex:1" }, [
        el("span", { style: "font-size:14px", text: icon(it.category) }), nameIn,
      ]),
      el("div.row", { style: "gap:6px;flex:0 0 auto" }, [
        locIn, statusSel, valIn,
        it.link ? el("a.btn-sm", { href: it.link, target: "_blank", rel: "noopener noreferrer",
          style: "text-decoration:none", text: "↗" }) : null,
        el("button.ord-btn", { title: "delete", text: "×",
          onclick: () => confirmDo("Delete “" + it.name + "”?", async () => {
            await api.vault.delItem(it.id); reload();
          }) }),
      ]),
    ]);
  }

  function section(title, items, cls, reload, note) {
    const box = el("div.vault-card" + (cls ? "." + cls : ""));
    const total = items.reduce((s, i) => s + Number(i.value || 0), 0);
    box.appendChild(el("div.spread", { style: "margin-bottom:8px" }, [
      el("span.sub", { text: title + " · " + items.length }),
      total ? el("span.vlt-figure", { text: V.money(total) }) : null,
    ]));
    if (note) box.appendChild(el("div.sub", { style: "margin-bottom:8px;font-style:italic", text: note }));
    if (!items.length) {
      box.appendChild(el("div.sub", { style: "font-style:italic", text: "Nothing here." }));
      return box;
    }
    items.forEach((it) => box.appendChild(itemRow(it, reload)));
    return box;
  }

  window.Views = window.Views || {};
  window.Views.inventory = {
    id: "inventory", label: "Inventory", scoped: false,
    async render(view) {
      clear(view);
      view.appendChild(el("div.view-head", {}, [el("div", {}, [
        el("h1", { text: "Inventory" }),
        el("div.sub", { text: "What you own, where it is, and what you still need or want to buy." }),
      ])]));

      const nameIn = el("input", { placeholder: "item name", style: "flex:1;min-width:160px" });
      const catSel = el("select", {}, CATS.map((c) => el("option", { value: c.key, text: c.icon + " " + c.key })));
      const statusSel = el("select", {}, ALL_STATUS.map((s) => el("option", { value: s, text: s })));
      statusSel.value = "owned";
      const locIn = el("input", { placeholder: "location", style: "width:140px" });
      const valIn = el("input", { type: "number", step: "0.01", placeholder: "value £", style: "width:100px" });
      const add = () => guard(async () => {
        if (!nameIn.value.trim()) return toast("name the item", true);
        await api.vault.createItem({ name: nameIn.value.trim(), category: catSel.value,
          status: statusSel.value, location: locIn.value.trim(), value: parseFloat(valIn.value) || 0 });
        nameIn.value = locIn.value = valIn.value = ""; toast("added"); reload();
      });
      nameIn.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
      view.appendChild(el("div.row", { style: "margin-bottom:16px" }, [
        nameIn, catSel, statusSel, locIn, valIn,
        el("button.btn-primary", { onclick: add, text: "+ item" }),
      ]));

      const host = el("div"); view.appendChild(host);

      async function reload() {
        const items = await guard(() => api.vault.inventory());
        clear(host);
        if (!items.length) {
          host.appendChild(el("div.empty", { text: "Nothing tracked yet." }));
          return;
        }
        const have = items.filter((i) => HAVE.includes(i.status));
        const need = items.filter((i) => i.status === "need");
        const want = items.filter((i) => i.status === "want");
        const rest = items.filter((i) => ["broken", "sold"].includes(i.status));

        // "what you have", grouped by category
        const haveBox = el("div.vault-card");
        const haveTotal = have.reduce((s, i) => s + Number(i.value || 0), 0);
        haveBox.appendChild(el("div.spread", { style: "margin-bottom:8px" }, [
          el("span.sub", { text: "WHAT YOU HAVE · " + have.length }),
          haveTotal ? el("span.vlt-figure", { text: V.money(haveTotal) }) : null,
        ]));
        if (!have.length) haveBox.appendChild(el("div.sub", { style: "font-style:italic", text: "Nothing here." }));
        CATS.forEach((c) => {
          const inCat = have.filter((i) => i.category === c.key);
          if (!inCat.length) return;
          haveBox.appendChild(el("div.sub", { style: "margin:10px 0 3px", text: c.icon + " " + c.key.toUpperCase() }));
          inCat.forEach((it) => haveBox.appendChild(itemRow(it, reload)));
        });
        host.appendChild(haveBox);

        host.appendChild(section("NEED TO BUY", need, "vlt-need", reload, "essentials you're missing"));
        host.appendChild(section("WANT TO BUY", want, "vlt-want", reload, "the wishlist"));
        if (rest.length) host.appendChild(section("BROKEN / SOLD", rest, "", reload));
      }
      reload();
    },
  };
})();
