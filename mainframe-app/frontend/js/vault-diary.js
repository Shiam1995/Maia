/* vault-diary.js — Vault · Diary (VAULT_SPEC §8).
   Financial reflections, reviews and decisions. Its own tab, deliberately not
   folded into transaction notes (spec). */
(function () {
  const { el, clear, toast, guard, confirmDo } = window.ui;
  const api = window.api;
  const V = window.VAULT;

  function card(d, reload) {
    const titleIn = el("input.vlt-diary-title", { value: d.title || "", placeholder: "title (optional)" });
    titleIn.addEventListener("blur", () => guard(async () => {
      if ((titleIn.value || "") === (d.title || "")) return;
      await api.vault.updateDiary(d.id, { title: titleIn.value }); d.title = titleIn.value; toast("saved");
    }));
    const textIn = el("textarea.mform-input", { rows: "4" });
    textIn.value = d.text || "";
    textIn.addEventListener("blur", () => guard(async () => {
      if ((textIn.value || "") === (d.text || "")) return;
      await api.vault.updateDiary(d.id, { text: textIn.value }); d.text = textIn.value; toast("saved");
    }));
    const tagsIn = el("input", { value: (d.tags || []).join(", "),
      placeholder: "tags — e.g. monthly-review, investment-decision", style: "width:100%;font-size:11px" });
    tagsIn.addEventListener("blur", () => guard(async () => {
      const tags = tagsIn.value.split(",").map((x) => x.trim()).filter(Boolean);
      if (tags.join("|") === (d.tags || []).join("|")) return;
      await api.vault.updateDiary(d.id, { tags }); d.tags = tags; toast("saved");
    }));

    return el("div.vault-card", {}, [
      el("div.spread", {}, [
        el("span.sub", { text: V.dateFmt(d.date) }),
        el("button.ord-btn", { title: "delete entry", text: "×",
          onclick: () => confirmDo("Delete this entry?", async () => {
            await api.vault.delDiary(d.id); reload();
          }) }),
      ]),
      titleIn, textIn,
      el("div", { style: "margin-top:7px" }, [tagsIn]),
      (d.tags || []).length ? el("div.row", { style: "gap:4px;flex-wrap:wrap;margin-top:6px" },
        d.tags.map((t) => el("span.pulse-chip", { style: "font-size:10px", text: t }))) : null,
    ]);
  }

  window.Views = window.Views || {};
  window.Views.findiary = {
    id: "findiary", label: "Diary", scoped: false,
    async render(view) {
      clear(view);
      view.appendChild(el("div.view-head", {}, [el("div", {}, [
        el("h1", { text: "Diary" }),
        el("div.sub", { text: "Financial reflections, monthly reviews, decisions and why you made them." }),
      ])]));

      const dateIn = el("input", { type: "date", value: V.todayStr() });
      const titleIn = el("input", { placeholder: "title (optional)", style: "flex:1;min-width:170px" });
      const textIn = el("textarea", { rows: "3", placeholder: "what happened, what you decided, why…", style: "width:100%;margin-top:8px" });
      const add = () => guard(async () => {
        if (!textIn.value.trim()) return toast("write something first", true);
        await api.vault.createDiary({ date: dateIn.value, title: titleIn.value.trim(), text: textIn.value.trim() });
        titleIn.value = ""; textIn.value = ""; toast("entry added"); reload();
      });
      view.appendChild(el("div.vault-card", { style: "margin-bottom:16px" }, [
        el("div.row", {}, [dateIn, titleIn]),
        textIn,
        el("div.row", { style: "margin-top:8px" }, [
          el("button.btn-primary", { onclick: add, text: "+ entry" }),
        ]),
      ]));

      const host = el("div"); view.appendChild(host);

      async function reload() {
        const entries = await guard(() => api.vault.diary());
        clear(host);
        if (!entries.length) {
          host.appendChild(el("div.empty", { text: "No entries yet. Reviews and decisions go here." }));
          return;
        }
        entries.forEach((d) => host.appendChild(card(d, reload)));
      }
      reload();
    },
  };
})();
