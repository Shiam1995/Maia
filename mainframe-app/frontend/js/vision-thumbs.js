/* vision-thumbs.js — Vision · YouTube § Thumbnails (VISION_UPDATE_SPEC §5).

   Make several thumbnail options and pick the best. Exactly one can be chosen;
   the chosen one becomes the video's thumbnail and shows on its card.

   Like storyboard panels, an option's image is either a pasted URL (from
   Midjourney/SDXL/wherever) or an upload through the Mainframe image service. */
(function () {
  const { el, toast, guard, confirmDo } = window.ui;
  const V = () => window.api.vision;
  const api = window.api;

  function optionCard(v, t, reload) {
    const shot = el("div.vth-shot" + (t.chosen ? ".chosen" : ""),
      t.image ? { style: "background-image:url(" + t.image + ")" } : {});
    if (!t.image) shot.appendChild(el("div.vsb-empty", { text: "🖼️" }));
    if (t.chosen) shot.appendChild(el("div.vth-check", { text: "✓ chosen" }));

    const style = el("input", { value: t.style || "", placeholder: "style — e.g. face close-up", style: "width:100%;font-size:11px" });
    style.addEventListener("blur", () => guard(async () => {
      if ((style.value || "") === (t.style || "")) return;
      await V().updateThumb(v.id, t.id, { style: style.value }); t.style = style.value; toast("saved");
    }));
    const notes = el("input", { value: t.notes || "", placeholder: "what you like / don't", style: "width:100%;font-size:11px" });
    notes.addEventListener("blur", () => guard(async () => {
      if ((notes.value || "") === (t.notes || "")) return;
      await V().updateThumb(v.id, t.id, { notes: notes.value }); t.notes = notes.value; toast("saved");
    }));
    const image = el("input", { value: t.image || "", placeholder: "image URL", style: "width:100%;font-size:10px" });
    image.addEventListener("blur", () => guard(async () => {
      if ((image.value || "") === (t.image || "")) return;
      await V().updateThumb(v.id, t.id, { image: image.value.trim() }); reload();
    }));

    const fileIn = el("input.img-file", { type: "file", accept: ".png,.jpg,.jpeg,.gif,.webp,.svg" });
    fileIn.addEventListener("change", () => {
      const f = fileIn.files && fileIn.files[0];
      if (!f) return;
      window.Images.nameModal(f.name.replace(/\.[^.]+$/, ""), (name) => guard(async () => {
        const img = await api.images.upload(f, name, "vision", t.id);
        await V().updateThumb(v.id, t.id, { image: api.images.fileUrl(img.id) });
        fileIn.value = ""; toast("image set"); reload();
      }));
    });

    shot.addEventListener("click", () => {
      if (t.chosen) return;
      guard(async () => { await V().updateThumb(v.id, t.id, { chosen: true }); toast("chosen"); reload(); });
    });
    if (!t.chosen) shot.title = "click to choose this thumbnail";

    return el("div.vth-card", {}, [
      shot, image,
      el("div.row", { style: "gap:4px;margin-top:4px" }, [
        fileIn,
        el("button.btn-sm", { style: "font-size:9px;padding:3px 7px", onclick: () => fileIn.click(), text: "⤒ upload" }),
        el("button.ord-btn", { style: "margin-left:auto", title: "delete option",
          text: "×", onclick: () => confirmDo("Delete this thumbnail option?", async () => {
            await V().delThumb(v.id, t.id); reload();
          }) }),
      ]),
      style, notes,
    ]);
  }

  window.VID_SECTIONS = window.VID_SECTIONS || [];
  window.VID_SECTIONS.push({
    key: "thumbnails", label: "🖼️ Thumbnails", order: 50,
    render(host, v, reload) {
      host.appendChild(el("div.row", { style: "margin-bottom:10px" }, [
        el("button.btn-sm", { onclick: () => guard(async () => {
          await V().addThumb(v.id, {}); reload();
        }), text: "+ add option" }),
        el("span.sub", { text: v.thumbs.length
          ? "click an option to choose it — the chosen one shows on the video card"
          : "make a few options, then pick the best" }),
      ]));
      if (!v.thumbs.length) {
        host.appendChild(el("div.sub", { style: "font-style:italic", text: "No thumbnail options yet." }));
        return;
      }
      const row = el("div.vth-row");
      v.thumbs.forEach((t) => row.appendChild(optionCard(v, t, reload)));
      host.appendChild(row);
    },
  });
})();
