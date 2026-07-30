/* modules.js — THE MASTER MANIFEST of the Mainframe.
   Every module of the personal-OS is declared here in one place: its identity,
   accent colour, topbar text, and which tabs it owns. The shell (app.js) reads
   this to build the module switcher, swap the theme, and render the nav.

   To add a new module later: add one entry here + its tab view files. That's it.
   All modules share one Neo4j graph + the Mainframe activity log, so they can
   cross-link and "talk" to each other. */
(function () {
  window.MODULES = [
    {
      key: "synapse",
      label: "SYNAPSE",
      accent: "#00D4AA",                 // teal
      topbar: "MAINFRAME <span class='brand-accent'>/ SYNAPSE</span>",
      tabs: ["repo", "workspace", "dictionary", "scanner", "refgraph", "timeline", "kg", "deepdive", "decomposition", "headers"],
    },
    {
      key: "pulse",
      label: "PULSE",
      accent: "#F4709C",                 // warm pink
      topbar: "<span class='brand-accent'>PULSE</span> / habits",
      tabs: ["benchmark", "habits", "tracking", "experiments", "routines", "fitness", "nutrition", "recovery", "medical", "medications"],
    },
    {
      key: "vision",
      label: "VISION",
      accent: "#FF4757",                 // red
      topbar: "<span class='brand-accent'>VISION</span> / content",
      // Tabs appear as they're built — app.js filters out any not yet
      // registered in window.Views, so listing the full set here is safe.
      tabs: ["blueprint", "youtube", "writing", "portfolio", "network", "sandbox"],
    },
    {
      key: "vault",
      label: "VAULT",
      accent: "#D4A017",                 // gold
      topbar: "<span class='brand-accent'>VAULT</span> / finance",
      tabs: ["overview", "accounts", "transactions", "budget", "investments",
             "analytics", "inventory", "findiary"],
    },
  ];

  // Mainframe-level tabs — shared services visible in every module.
  // Ideas sits up here (not under Synapse) — ideas arrive from anywhere, and
  // the floating quick-add lets you capture one from any module.
  // "help" sits last — it's the plain-English guide to everything above it.
  // Calendar sits directly after Tasks: tasks are the spine, and the calendar is
  // where they meet actual time. Both are Mainframe-level, not module features.
  window.SHARED_TABS = ["tasks", "calendar", "progress", "work", "ideas", "learning", "activity", "gantt", "mind", "project", "log", "help"];
})();
