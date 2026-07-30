/* vision-blueprint.js — Vision · Blueprint: user-built content pipelines.

   Blueprint is a TEMPLATE BUILDER, not a fixed workflow. Nothing about a stage
   is hardcoded: the user names it and defines its inputs, outputs, tools and
   process. Videos and writing pieces will later be assigned to a pipeline and
   take their kanban stages from its stage list.

   Stages render as connected boxes with → between them, reorderable with ▲▼
   (which read as ◀▶ here since the flow runs left-to-right). */
(function () {
  const { el, clear, toast, guard, confirmDo } = window.ui;
  const api = window.api;
  const V = () => api.vision;

  const open = new Set();      // expanded process notes, by stage id
  let host = null;

  const lines = (s) => (s || "").split("\n").map((x) => x.trim()).filter(Boolean);

  /* --- stage editor: one modal for both add and edit -------------------- */
  function stageModal(pipeline, stage, reload) {
    const editing = !!stage;
    const name = el("input.mform-input", { placeholder: "e.g. LLM Script Refinement", value: editing ? stage.name : "" });
    const inputs = el("textarea.mform-input", { rows: "3", placeholder: "one per line — what feeds into this stage" });
    const outputs = el("textarea.mform-input", { rows: "3", placeholder: "one per line — what this stage produces" });
    const tools = el("textarea.mform-input", { rows: "3", placeholder: "one per line — e.g. Claude — script refinement" });
    const process = el("textarea.mform-input", { rows: "5", placeholder: "step by step, how you actually do this stage" });
    if (editing) {
      inputs.value = (stage.inputs || []).join("\n");
      outputs.value = (stage.outputs || []).join("\n");
      tools.value = (stage.tools || []).join("\n");
      process.value = stage.process || "";
    }
    const field = (l, n, hint) => el("div.mform-full", {}, [
      el("div.mform-label", { text: l }), n,
      hint ? el("div.sub", { style: "margin-top:3px", text: hint }) : null,
    ]);

    const overlay = el("div.modal-overlay");
    const close = () => overlay.remove();
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
    const save = () => guard(async () => {
      if (!name.value.trim()) return toast("the stage needs a name", true);
      const body = {
        name: name.value.trim(), inputs: lines(inputs.value),
        outputs: lines(outputs.value), tools: lines(tools.value),
        process: process.value.trim(),
      };
      if (editing) await V().updateStage(pipeline.id, stage.id, body);
      else await V().addStage(pipeline.id, body);
      close(); toast(editing ? "stage saved" : "stage added"); reload();
    });
    overlay.appendChild(el("div.modal.vis-modal", {}, [
      el("div.modal-title", { text: (editing ? "Edit stage — " : "New stage — ") + pipeline.name }),
      field("Stage name", name),
      el("div.mform-row", {}, [field("Inputs", inputs, "one per line"), field("Outputs", outputs, "one per line")]),
      field("Tools / LLMs", tools, "one per line — these become shared nodes you can query across the graph"),
      field("Process", process, "your checklist for this stage"),
      el("div.row", { style: "margin-top:16px;gap:8px;justify-content:flex-end" }, [
        el("button.btn-sm.btn-primary", { onclick: save, text: editing ? "Save stage" : "Add stage" }),
        el("button.btn-sm", { onclick: close, text: "Cancel" }),
      ]),
    ]));
    document.body.appendChild(overlay);
    name.focus();
  }

  /* --- one stage box ----------------------------------------------------- */
  function stageBox(pipeline, stage, idx, reload) {
    const isOpen = open.has(stage.id);
    const move = (dir) => guard(async () => {
      const ids = pipeline.stages.map((s) => s.id);
      const j = idx + dir;
      if (j < 0 || j >= ids.length) return;
      const tmp = ids[idx]; ids[idx] = ids[j]; ids[j] = tmp;
      await V().reorderStages(pipeline.id, ids);
      reload();
    });

    const box = el("div.vstage", {}, [
      el("div.spread", {}, [
        el("div.row", { style: "gap:7px;min-width:0" }, [
          el("span.vstage-num", { text: String(idx + 1) }),
          el("span.vstage-name", { text: stage.name }),
        ]),
        el("div.row", { style: "gap:3px" }, [
          el("button.ord-btn", { title: "move earlier", text: "◀", onclick: () => move(-1), disabled: idx === 0 }),
          el("button.ord-btn", { title: "move later", text: "▶", onclick: () => move(1), disabled: idx === pipeline.stages.length - 1 }),
          el("button.ord-btn", { title: "edit stage", text: "✎", onclick: () => stageModal(pipeline, stage, reload) }),
          el("button.ord-btn", { title: "delete stage", text: "×", onclick: () => confirmDo("Delete stage “" + stage.name + "”?", async () => {
            await V().delStage(pipeline.id, stage.id); open.delete(stage.id); reload();
          }) }),
        ]),
      ]),
    ]);

    if ((stage.inputs || []).length) {
      box.appendChild(el("div.vstage-io", {}, [
        el("div.vstage-iolabel", { text: "in" }),
        ...stage.inputs.map((i) => el("div.vio-in", { text: "→ " + i })),
      ]));
    }
    if ((stage.outputs || []).length) {
      box.appendChild(el("div.vstage-io", {}, [
        el("div.vstage-iolabel", { text: "out" }),
        ...stage.outputs.map((o) => el("div.vio-out", { text: "← " + o })),
      ]));
    }
    if ((stage.tools || []).length) {
      box.appendChild(el("div.row", { style: "gap:4px;flex-wrap:wrap;margin-top:8px" },
        stage.tools.map((t) => el("span.vtool", { text: "🤖 " + t }))));
    }
    if (stage.process) {
      const p = el("div.vstage-process" + (isOpen ? "" : ".clamped"), { text: stage.process });
      p.addEventListener("click", () => { isOpen ? open.delete(stage.id) : open.add(stage.id); reload(); });
      p.title = isOpen ? "click to collapse" : "click to expand";
      box.appendChild(p);
    }
    // anything can carry images — a stage often has a reference screenshot
    window.Images.mount(box, { module: "vision", contextId: stage.id, surface: "vision-stage", title: "Images" });
    return box;
  }

  /* --- one pipeline card ------------------------------------------------- */
  function pipelineCard(p, reload) {
    const title = el("input.vis-title", { value: p.name });
    title.addEventListener("blur", () => guard(async () => {
      const nv = title.value.trim();
      if (!nv || nv === p.name) { title.value = p.name; return; }
      await V().updatePipeline(p.id, { name: nv }); p.name = nv; toast("renamed");
    }));
    const desc = el("input.vis-desc", { value: p.description || "", placeholder: "what this pipeline is for (optional)" });
    desc.addEventListener("blur", () => guard(async () => {
      if ((desc.value || "") === (p.description || "")) return;
      await V().updatePipeline(p.id, { description: desc.value }); p.description = desc.value; toast("saved");
    }));

    const card = el("div.vision-card", {}, [
      el("div.spread", {}, [
        el("div", { style: "flex:1;min-width:0" }, [title, desc]),
        el("div.row", { style: "gap:6px" }, [
          el("button.btn-sm", { onclick: () => stageModal(p, null, reload), text: "+ stage" }),
          el("button.btn-sm.btn-danger", { onclick: () => confirmDo("Delete pipeline “" + p.name + "” and all its stages?", async () => {
            await V().delPipeline(p.id); reload();
          }), text: "delete" }),
        ]),
      ]),
    ]);

    if (!p.stages.length) {
      card.appendChild(el("div.sub", { style: "margin-top:12px;font-style:italic",
        text: "No stages yet. A pipeline is whatever you define — add the first stage." }));
      return card;
    }
    // stages as connected boxes, flowing left→right with → between them
    const flow = el("div.vflow");
    p.stages.forEach((s, i) => {
      if (i) flow.appendChild(el("div.vflow-arrow", { text: "→" }));
      flow.appendChild(stageBox(p, s, i, reload));
    });
    card.appendChild(flow);
    return card;
  }

  window.Views = window.Views || {};
  window.Views.blueprint = {
    id: "blueprint", label: "Blueprint", scoped: false,
    async render(view) {
      clear(view);
      view.appendChild(el("div.view-head", {}, [el("div", {}, [
        el("h1", { text: "Blueprint" }),
        el("div.sub", { text: "Your own content pipelines. Define every stage — its inputs, outputs, tools and process. Videos and writing pieces get assigned to one and follow its stages." }),
      ])]));

      const nameIn = el("input", { placeholder: "new pipeline name — e.g. YouTube Production", style: "flex:1;min-width:200px" });
      const add = () => guard(async () => {
        if (!nameIn.value.trim()) return toast("give the pipeline a name", true);
        await V().createPipeline({ name: nameIn.value.trim() });
        nameIn.value = ""; toast("pipeline created"); reload();
      });
      nameIn.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
      view.appendChild(el("div.row", { style: "margin-bottom:16px" }, [
        nameIn, el("button.btn-primary", { onclick: add, text: "+ pipeline" }),
      ]));

      host = el("div"); view.appendChild(host);

      async function reload() {
        const pipes = await guard(() => V().pipelines());
        clear(host);
        if (!pipes.length) {
          host.appendChild(el("div.empty", { text: "No pipelines yet. Name one above — then build its stages." }));
          return;
        }
        pipes.forEach((p) => host.appendChild(pipelineCard(p, reload)));
      }
      reload();
    },
  };
})();
