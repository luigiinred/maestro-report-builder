// Generated report viewer. MANIFEST (including each flow's parsed commands.json as
// `stepsData`) is defined by the sibling manifest.js, loaded before this file.

// Step-tree filtering settings, editable live via the gear popup next to "Test Steps".
// `hiddenFilterKeys` holds filterKey() results (see below) the user has hidden; `hideSkipped`
// removes SKIPPED top-level steps (and their dead sub-trees) entirely rather than just
// collapsing them.
const settings = {
  hideSkipped: true,
  hiddenFilterKeys: new Set([
    "defineVariablesCommand",
    "applyConfigurationCommand",
    "runFlowCommand:setEnv.yml",
  ]),
};

// Whether the bottom inspector panel (Steps tab) is open — persists across flow switches and
// re-renders, unlike `settings` above which is only ever mutated from its own popup.
let inspectorOpen = false;

const INSPECTOR_ICON = `<svg viewBox="0 0 16 16"><path fill="currentColor" d="M1.75 2A.75.75 0 0 0 1 2.75v10.5c0 .414.336.75.75.75h12.5a.75.75 0 0 0 .75-.75V2.75a.75.75 0 0 0-.75-.75ZM2.5 3.5h11v6.25h-11Zm0 7.75h11v1.75h-11Z"/></svg>`;

// A plain command key (e.g. "applyConfigurationCommand") is filterable directly, but
// runFlowCommand wraps many unrelated things — SAVE_ARTIFACTS gates, onboarding, setEnv.yml,
// hideKeyboard.yml — under the same key. Distinguish those by sourceDescription (the file:
// path Maestro records for a runFlow that came from a file, absent for inline `commands:`
// blocks) so "hide setEnv" doesn't also hide unrelated runFlow groups.
function filterKey(entry) {
  const key = Object.keys(entry)[0];
  const body = entry[key];
  if (key === "runFlowCommand" && body.sourceDescription) {
    return `runFlowCommand:${body.sourceDescription}`;
  }
  return key;
}

function filterKeyLabel(key) {
  if (key.startsWith("runFlowCommand:")) return `Run flow — ${key.slice("runFlowCommand:".length)}`;
  return humanizeCommandKey(key);
}

function isHiddenCommand(entry) {
  return settings.hiddenFilterKeys.has(filterKey(entry));
}

function collectFilterKeys(entry, set) {
  const key = Object.keys(entry)[0];
  set.add(filterKey(entry));
  const body = entry[key];
  if (Array.isArray(body.commands)) body.commands.forEach((c) => collectFilterKeys(c, set));
}

// Flow-picker state (left nav) — ?flow= in the URL, defaulting to the first MANIFEST entry.
function currentFlowKey() {
  const f = new URLSearchParams(window.location.search).get("flow");
  return MANIFEST[f] ? f : Object.keys(MANIFEST)[0];
}

function currentFlow() {
  return MANIFEST[currentFlowKey()];
}

function setFlow(key) {
  const url = new URL(window.location);
  url.searchParams.set("flow", key);
  history.replaceState(null, "", url);
  // Picking a specific flow (from the tree, or via the sidebar) always means "show me that
  // flow's steps" — even if the Snapshots page was open when it was clicked.
  currentView = "flow";
  renderMain();
}

// GitHub-style status dots (filled circle, check/x drawn as a stroke), swapped in for the
// plain emoji so the flow list reads like a PR "Files changed" tree rather than a checklist.
const NAV_STATUS_ICON = {
  true: `<svg class="flow-nav-icon" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="var(--green-bg)"/><path d="M4.5 8.3l2.2 2.2 4.8-4.8" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  false: `<svg class="flow-nav-icon" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="var(--red-bg)"/><path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`,
  null: `<svg class="flow-nav-icon" viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" fill="var(--text-dim)"/></svg>`,
};
const FOLDER_ICON = `<svg class="flow-nav-icon" viewBox="0 0 16 16"><path fill="var(--text-dim)" d="M1.75 2.5A.75.75 0 0 1 2.5 1.75h3.19c.28 0 .55.11.75.31l1.06 1.06a.75.75 0 0 0 .53.22h5.27a.75.75 0 0 1 .75.75v8.66a.75.75 0 0 1-.75.75H2.5a.75.75 0 0 1-.75-.75V2.5Z"/></svg>`;

let flowNavFilterText = "";

function humanizeFolderName(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

// Flow keys are "/"-joined directory paths (see findFlowDirs in scan.js) — this rebuilds that
// flat list into a tree so nested flows render as a real folder tree instead of one long list
// with slashes in the labels.
function buildFlowTree(entries) {
  const root = { type: "folder", name: "", children: new Map() };
  entries.forEach(([key, flow]) => {
    const parts = key.split("/");
    let node = root;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) {
        node.children.set(part, { type: "flow", key, flow });
      } else {
        if (!node.children.has(part) || node.children.get(part).type !== "folder") {
          node.children.set(part, { type: "folder", name: part, children: new Map() });
        }
        node = node.children.get(part);
      }
    });
  });
  return root;
}

// Prunes non-matching branches in place (the tree is rebuilt fresh every render, so mutating it
// is safe) and reports whether anything survived, so a filter narrows the tree down to matching
// flows and their ancestor folders instead of just greying out the rest.
function filterFlowTree(node, needle) {
  if (node.type === "flow") return node.flow.label.toLowerCase().includes(needle);
  let anyMatch = false;
  node.children.forEach((child, name) => {
    if (filterFlowTree(child, needle)) anyMatch = true;
    else node.children.delete(name);
  });
  return anyMatch;
}

// GitHub's file tree collapses a run of folders that each have exactly one (folder) child into
// a single row showing the joined path — e.g. "__Snapshots__/CompanyBenefitsScreenSnapshotTests"
// instead of two levels of nesting for a folder that isn't actually branching into anything.
// Run after filterFlowTree so a filter that leaves only one child of a folder collapses it too.
function compactFlowTree(node) {
  if (node.type === "flow") return;
  while (node.children.size === 1) {
    const [[, onlyChild]] = node.children;
    if (onlyChild.type !== "folder") break;
    node.name = node.name ? `${node.name}/${onlyChild.name}` : onlyChild.name;
    node.children = onlyChild.children;
  }
  node.children.forEach((child) => compactFlowTree(child));
}

// A compacted folder's `name` may be a "/"-joined chain (see compactFlowTree) — humanize each
// segment on its own so e.g. "retirement/viewDashboard" doesn't get treated as one long string.
function folderDisplayName(name) {
  return name.split("/").map(humanizeFolderName).join("/");
}

// Folders before flows, alphabetical within each — matches the convention readers already
// know from any file tree (GitHub, Finder, VS Code).
function sortedFlowChildren(node) {
  return [...node.children.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    const an = a.type === "folder" ? folderDisplayName(a.name) : a.flow.label;
    const bn = b.type === "folder" ? folderDisplayName(b.name) : b.flow.label;
    return an.localeCompare(bn);
  });
}

function renderFlowNode(node, active, depth) {
  const indent = 8 + depth * 16;
  if (node.type === "flow") {
    return `
      <div class="flow-nav-item${node.key === active ? " active" : ""}" data-flow-key="${node.key}" style="padding-left:${indent}px">
        <span class="flow-nav-status">${NAV_STATUS_ICON[node.flow.passed]}</span><span class="flow-nav-label">${node.flow.label}</span>
      </div>`;
  }
  const children = sortedFlowChildren(node)
    .map((child) => renderFlowNode(child, active, depth + 1))
    .join("");
  return `
    <details class="flow-nav-folder" open>
      <summary class="flow-nav-folder-row" style="padding-left:${indent}px">
        <span class="disclosure-chevron">&#9656;</span>
        ${FOLDER_ICON}<span class="flow-nav-folder-name">${escapeHtml(folderDisplayName(node.name))}</span>
      </summary>
      ${children}
    </details>`;
}

function renderFlowNav() {
  const nav = document.getElementById("flow-nav");
  const active = currentFlowKey();
  const needle = flowNavFilterText.trim().toLowerCase();
  const tree = buildFlowTree(Object.entries(MANIFEST));
  const hasMatch = !needle || filterFlowTree(tree, needle);
  if (hasMatch) compactFlowTree(tree);
  nav.innerHTML = hasMatch
    ? sortedFlowChildren(tree)
        .map((child) => renderFlowNode(child, active, 0))
        .join("")
    : `<div class="flow-nav-empty">No flows match "${flowNavFilterText}"</div>`;
  nav.querySelectorAll(".flow-nav-item").forEach((el) => {
    el.addEventListener("click", () => setFlow(el.dataset.flowKey));
  });
}

document.getElementById("flow-nav-filter").addEventListener("input", (e) => {
  flowNavFilterText = e.target.value;
  renderFlowNav();
});

const STATUS_ICON = { COMPLETED: "✅", SKIPPED: "⏭️", WARNED: "⚠️", FAILED: "❌" };

function humanizeCommandKey(key) {
  const spaced = key.replace(/Command$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

// commands.json's flat array isn't just top-level flow steps — Maestro also flattens each
// command *inside* a runFlow/retry's own `commands` array into its own top-level entry with
// real metadata, while the parent's `commands` array separately keeps a metadata-less static
// copy of the same command for structural display. Net effect: every nested step shows up
// twice — once (correctly) in place under its parent, once again floating at the top level.
// Fix: identify which top-level entries are "really" nested duplicates by matching their
// `command` payload (JSON-identical) against every nested child across the whole tree, drop
// those from the top-level list, and thread the real metadata found for them down into the
// nested copy instead — so the nested position gets the real icon/duration/seek time.
// Caveat: matching is by JSON equality, not identity, so two genuinely distinct steps with
// byte-identical params (e.g. the same tapOn repeated in a loop) could be conflated absent a
// stable per-step id from Maestro itself.
function commandKey(entry) {
  return JSON.stringify(entry);
}

function collectNestedCommands(entry, nestedKeys) {
  const key = Object.keys(entry)[0];
  const body = entry[key];
  if (Array.isArray(body.commands)) {
    body.commands.forEach((child) => {
      nestedKeys.add(commandKey(child));
      collectNestedCommands(child, nestedKeys);
    });
  }
}

function shouldShow(entry, metadata) {
  if (isHiddenCommand(entry)) return false;
  if (metadata && settings.hideSkipped && metadata.status === "SKIPPED") return false;
  return true;
}

const STATUS_ICON_SVG = {
  COMPLETED: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#3ecf6b" stroke-width="1.4"/><path d="M5 8.3l2 2 4-4.6" stroke="#3ecf6b" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  WARNED: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#e0a83e" stroke-width="1.4"/><path d="M8 4.8v4" stroke="#e0a83e" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11" r="0.9" fill="#e0a83e"/></svg>`,
  FAILED: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#ff5c5c" stroke-width="1.4"/><path d="M8 4.8v4" stroke="#ff5c5c" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11" r="0.9" fill="#ff5c5c"/></svg>`,
  SKIPPED: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#6b7280" stroke-width="1.4" stroke-dasharray="2 2"/></svg>`,
};
const NEUTRAL_ICON_SVG = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#4b5563" stroke-width="1.2" stroke-dasharray="2 2"/></svg>`;
const CLOCK_SVG = `<svg viewBox="0 0 16 16" width="10" height="10" fill="none"><circle cx="8" cy="8" r="6.3" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.6v3.7l2.4 1.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function statusIconSvg(metadata) {
  return metadata ? STATUS_ICON_SVG[metadata.status] || NEUTRAL_ICON_SVG : NEUTRAL_ICON_SVG;
}

function formatSeek(seconds) {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

// takeScreenshotCommand's own `path` field is the unresolved "${ARTIFACTS_DIR}/<flow>/<name>"
// template Maestro recorded, not a real filesystem path — but its basename matches a name in
// the flow's `screenshots` manifest array, so match on that to find the real image to thumbnail.
function screenshotForCommand(key, body, flow = currentFlow()) {
  if (key !== "takeScreenshotCommand" || !body.path) return null;
  const name = body.path.split("/").pop();
  return (flow.screenshots || []).find((s) => s.name === name) || null;
}

// Row -> raw command parameters, for the hover tooltip. Reset at the top of every
// renderStepsList() call; ids are assigned per render pass, not stable across re-renders.
let ROW_DETAILS = new Map();
let rowIdCounter = 0;

function escapeHtml(str) {
  return str.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Rows are flat full-width flex divs (not nested inline spans) so hover/current/failed
// backgrounds span edge-to-edge at every depth — indentation comes from an inline
// padding-left keyed on `depth`, not from <ul> margins, so a row's own box always fills the
// container width regardless of nesting.
//
// The whole row (leaf or group) is one click target that seeks the video — only the
// disclosure chevron on group rows toggles collapse (wired separately in renderStepsList).
//
// The right-side time is the video-seek timestamp (when this step happened in the recording),
// not the step's own execution duration — data-seek/data-raw-seek carry the same number the
// displayed text shows, so calibrateStepTimestamps() corrects both together once the video's
// real duration is known (see the .step-time-text span it targets).
function renderCommandNode(entry, metadata, recordingStartTs, metadataByCommand, depth) {
  const key = Object.keys(entry)[0];
  const body = entry[key];
  const label = body.label || humanizeCommandKey(key);
  const icon = statusIconSvg(metadata);
  const seekable = metadata && recordingStartTs != null;
  const seekSeconds = seekable ? Math.max(0, (metadata.timestamp - recordingStartTs) / 1000) : null;
  const seekAttrs = seekable ? ` data-seek="${seekSeconds}" data-raw-seek="${seekSeconds}"` : "";
  const timeText = seekable
    ? `${CLOCK_SVG}<span class="step-time-text">${formatSeek(seekSeconds)}</span>`
    : "";
  const screenshot = screenshotForCommand(key, body);
  const thumbnail = screenshot
    ? `<img class="step-thumb" src="${screenshot.src}" alt="" onclick="event.stopPropagation(); openLightbox('${screenshot.src}')" />`
    : "";
  const children = Array.isArray(body.commands)
    ? body.commands
        .map((c) => ({ entry: c, metadata: metadataByCommand.get(commandKey(c)) || null }))
        .filter((c) => shouldShow(c.entry, c.metadata))
    : null;
  const dimClass = metadata && metadata.status === "SKIPPED" ? " dim" : "";
  const failedClass = metadata && metadata.status === "FAILED" ? " status-failed" : "";
  const indent = 10 + depth * 18;

  // Raw params for the hover tooltip — everything on this command except `commands` (children
  // render as their own rows already) and `label` (already the row's own text).
  const rawParams = { ...body };
  delete rawParams.commands;
  delete rawParams.label;
  const rowId = String(rowIdCounter++);
  ROW_DETAILS.set(rowId, { title: humanizeCommandKey(key), params: rawParams });
  const rowIdAttr = ` data-row-id="${rowId}"`;

  if (children) {
    // Skipped steps never ran, so their sub-steps are dead weight — collapse by default
    // instead of auto-expanding (everything else still auto-expands).
    const openAttr = metadata && metadata.status === "SKIPPED" ? "" : "open";
    return `
      <details class="step-group" ${openAttr}>
        <summary class="step-row${dimClass}${failedClass}"${seekAttrs}${rowIdAttr} style="padding-left:${indent}px">
          <span class="disclosure-chevron">&#9656;</span>
          <span class="step-icon">${icon}</span>
          <span class="step-label">${label}</span>
          ${thumbnail}
          <span class="step-duration">${timeText}</span>
        </summary>
        <ul>${children
          .map((c) => `<li>${renderCommandNode(c.entry, c.metadata, recordingStartTs, metadataByCommand, depth + 1)}</li>`)
          .join("")}</ul>
      </details>`;
  }
  return `
    <div class="step-row${dimClass}${failedClass}"${seekAttrs}${rowIdAttr} style="padding-left:${indent + 24}px">
      <span class="step-icon">${icon}</span>
      <span class="step-label">${label}</span>
      ${thumbnail}
      <span class="step-duration">${timeText}</span>
    </div>`;
}

// Every takeScreenshotCommand in stepsData already carries its own real execution metadata
// (see the flattening note above renderCommandNode) — no separate dedup pass needed, just sort
// by timestamp and match each to its file via screenshotForCommand(). Without commands.json,
// there's no capture order to recover, so fall back to scan.js's on-disk listing as-is.
//
// Also appends the flow's auto-captured failure screenshot (Maestro's own native-reporting
// output, see scan.js's failureScreenshotFile) as a trailing entry when present — it isn't part
// of the take-screenshot sequence in commands.json (it comes from a separate debug run), so
// there's no real capture timestamp for it, just a fixed spot at the end.
function computeOrderedScreenshots(flowKey) {
  const flow = MANIFEST[flowKey];
  if (!flow) return [];
  const data = flow.stepsData;
  const shots = [];
  if (!data || data.length === 0) {
    (flow.screenshots || []).forEach((s) => shots.push({ screenshot: s, seekSeconds: null, label: null }));
  } else {
    const startEntry = data.find((d) => Object.keys(d.command)[0] === "startRecordingCommand");
    const startTs = startEntry ? startEntry.metadata.timestamp : null;
    [...data]
      .sort((a, b) => a.metadata.timestamp - b.metadata.timestamp)
      .filter((d) => Object.keys(d.command)[0] === "takeScreenshotCommand")
      .forEach((d) => {
        const body = d.command.takeScreenshotCommand;
        const screenshot = screenshotForCommand("takeScreenshotCommand", body, flow);
        if (!screenshot) return;
        const seekSeconds = startTs != null ? Math.max(0, (d.metadata.timestamp - startTs) / 1000) : null;
        shots.push({ screenshot, seekSeconds, label: body.label || null });
      });
  }
  if (flow.native && flow.native.failureScreenshot) {
    shots.push({
      screenshot: { name: "failure-screenshot", src: flow.native.failureScreenshot },
      seekSeconds: null,
      label: "Auto-captured on failure",
      isFailure: true,
    });
  }
  return shots;
}

// Same leaf order the sidebar tree renders in (folders-before-flows, alphabetical) — reused so
// the global Snapshots page and the sidebar agree on ordering, without needing the sidebar's
// display-only path compaction.
function allFlowKeysInOrder() {
  const tree = buildFlowTree(Object.entries(MANIFEST));
  const keys = [];
  (function walk(node) {
    sortedFlowChildren(node).forEach((child) => {
      if (child.type === "flow") keys.push(child.key);
      else walk(child);
    });
  })(tree);
  return keys;
}

// The flat cross-flow list the global lightbox (opened from the Snapshots page) navigates —
// every flow's screenshots back to back, each tagged with its own flow so the lightbox can
// update the current flow selection as ←/→ crosses from one flow's shots into the next's.
function computeAllScreenshots() {
  return allFlowKeysInOrder().flatMap((key) => {
    const flow = MANIFEST[key];
    return computeOrderedScreenshots(key).map((o) => ({ ...o, flowKey: key, flowLabel: flow.label }));
  });
}

// Shared between the per-flow Screenshots tab and the global Snapshots page. `isFailure`
// entries (see computeOrderedScreenshots) get a red-tinted border and a warning glyph in place
// of a seek time, since they have neither.
function renderScreenshotCard(o, index) {
  const name = o.label || o.screenshot.name;
  return `
    <figure class="screenshot-card${o.isFailure ? " is-failure" : ""}" data-index="${index}">
      <img src="${o.screenshot.src}" alt="${escapeHtml(name)}" />
      <figcaption>
        <span class="sc-index">${index + 1}</span>
        <span class="sc-name">${escapeHtml(name)}</span>
        ${o.seekSeconds != null ? `<span class="sc-seek">${formatSeek(o.seekSeconds)}</span>` : o.isFailure ? `<span class="sc-seek sc-fail">&#9888;</span>` : ""}
      </figcaption>
    </figure>`;
}

function renderScreenshotsTab() {
  const el = document.getElementById("screenshots-section");
  const ordered = computeOrderedScreenshots(currentFlowKey());
  const hasStepsData = !!(currentFlow().stepsData && currentFlow().stepsData.length);

  if (ordered.length === 0) {
    el.innerHTML = `<div class="steps-error">No screenshots captured for this flow.</div>`;
    return;
  }

  el.innerHTML = `
    ${hasStepsData ? "" : `<div class="seek-hint" style="margin-bottom:12px;">No commands.json for this flow — showing on-disk order, not confirmed capture order.</div>`}
    <div class="screenshot-grid">
      ${ordered.map((o, i) => renderScreenshotCard(o, i)).join("")}
    </div>`;

  el.querySelectorAll(".screenshot-card img").forEach((img, i) => {
    img.addEventListener("click", () => openLightbox(ordered[i].screenshot.src));
  });
}

// The "Snapshots" sidebar tab — every flow's screenshots on one page, grouped into a section
// per flow (labeled with its pass/fail status), independent of whatever flow happens to be
// selected. A flow with none still gets a section, just with a "No snapshots" placeholder,
// rather than disappearing from the page.
function renderGlobalSnapshotsView() {
  const el = document.getElementById("main-view-snapshots");
  const flowKeys = allFlowKeysInOrder();

  const sections = flowKeys
    .map((key) => {
      const flow = MANIFEST[key];
      const shots = computeOrderedScreenshots(key);
      const statusClass = flow.passed === true ? "passed" : flow.passed === false ? "failed" : "unknown";
      const statusText = flow.passed === true ? "Passed" : flow.passed === false ? "Failed" : "No steps";
      return `
        <section class="snapshot-section">
          <div class="snapshot-section-header">
            <span class="flow-status-pill ${statusClass}">${statusText}</span>
            <span class="snapshot-section-title">${escapeHtml(flow.label)}</span>
            <span class="flow-key-tag">${escapeHtml(key)}</span>
          </div>
          ${
            shots.length
              ? `<div class="screenshot-grid">${shots.map((o, i) => renderScreenshotCard(o, i)).join("")}</div>`
              : `<div class="snapshot-section-empty">No snapshots</div>`
          }
        </section>`;
    })
    .join("");

  el.innerHTML = `
    <div class="snapshots-page-header">
      <h1>All Snapshots</h1>
      <span class="flow-key-tag">${flowKeys.length} flow${flowKeys.length === 1 ? "" : "s"}</span>
    </div>
    <div class="snapshots-page-body">${sections || `<div class="steps-error">No flows found.</div>`}</div>`;

  el.querySelectorAll(".screenshot-card img").forEach((img) => {
    img.addEventListener("click", () => openLightbox(img.getAttribute("src"), { global: true }));
  });
}

let activeTab = "steps";

// Top-level page: "flow" shows the selected flow's Steps/Screenshots tabs (#main-view-flow),
// "snapshots" shows the cross-flow grid (#main-view-snapshots) — toggled by the sidebar's
// Flows/Snapshots tabs, independent of `activeTab` above (that's the Steps/Screenshots split
// *within* the flow view).
let currentView = "flow";

function renderTabs() {
  document.querySelectorAll(".pr-tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === activeTab));
  document.getElementById("steps-section").hidden = activeTab !== "steps";
  document.getElementById("screenshots-section").hidden = activeTab !== "screenshots";
  if (activeTab === "screenshots") renderScreenshotsTab();
}

document.querySelectorAll(".pr-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.tab;
    renderTabs();
  });
});

document.querySelectorAll(".view-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentView = btn.dataset.view;
    renderMain();
  });
});

// Per-flow state — reset in renderSteps() whenever the current flow changes.
let STEPS_DATA = null;
let RECORDING_START_TS = null;
let RECORDING_STOP_TS = null;
let NESTED_COMMAND_KEYS = null; // Set of commandKey() for every command nested under some parent
let METADATA_BY_COMMAND = null; // commandKey() -> queue of that command's real metadata occurrences
let SEEKABLE_NODES = []; // chronological .step-row[data-seek] elements, for up/down nav

// commandKey() matches by JSON content, so two genuinely distinct steps with byte-identical
// params (e.g. two separate "Wait for animation to end" calls with no other distinguishing
// field) collide on the same key. A flat Map (one value per key) would make the SECOND
// occurrence's lookup silently return the FIRST occurrence's metadata for every match after
// it — both nested copies would show the same timestamp, breaking click-to-seek accuracy and
// causing two rows to appear "current" at once. Fix: keep a per-key FIFO queue built in
// chronological order, and have each lookup consume the next unclaimed item instead of
// re-reading one shared value. This only produces correct pairings if collecting and consuming
// both walk the tree in the same deterministic order — they do, since both are driven by the
// same STEPS_DATA/child arrays every render pass.
function buildMetadataQueues(data) {
  const queues = new Map();
  [...data]
    .sort((a, b) => a.metadata.timestamp - b.metadata.timestamp)
    .forEach((d) => {
      const k = commandKey(d.command);
      if (!queues.has(k)) queues.set(k, { items: [], index: 0 });
      queues.get(k).items.push(d.metadata);
    });
  return {
    reset() {
      queues.forEach((q) => { q.index = 0; });
    },
    get(key) {
      const q = queues.get(key);
      if (!q) return null;
      return q.items[q.index++] ?? null;
    },
  };
}

// The raw per-step timestamp offset has two known error sources confirmed by reading Maestro's
// own source (mobile-dev-inc/Maestro): screenrecord.sh sleeps 2s after launching
// `simctl recordVideo` before signaling back that recording has started, and
// stopRecordingCommand blocks on a real SIGINT+wait for simctl to exit — so the true offset
// isn't a clean single constant, and may differ across Maestro versions anyway. Rather than
// hardcode a guess, calibrate empirically: we know two ground-truth points — the nominal
// (stopRecording − startRecording) timestamp delta, and the video's real reported duration once
// its metadata loads — so scale every raw offset by their ratio. This exactly corrects the two
// endpoints and linearly interpolates in between; it doesn't know whether the true drift is
// front-loaded, back-loaded, or spread out, but it's a real measurement-based correction rather
// than an assumption.
function calibrateStepTimestamps(video) {
  if (!RECORDING_START_TS || !RECORDING_STOP_TS || !isFinite(video.duration) || video.duration <= 0) return;
  const nominalDuration = (RECORDING_STOP_TS - RECORDING_START_TS) / 1000;
  if (nominalDuration <= 0) return;
  const scale = video.duration / nominalDuration;
  document.querySelectorAll(".step-row[data-raw-seek]").forEach((node) => {
    const raw = Number(node.dataset.rawSeek);
    const corrected = Math.min(video.duration, raw * scale);
    node.dataset.seek = corrected;
    const textEl = node.querySelector(".step-time-text");
    if (textEl) textEl.textContent = formatSeek(corrected);
  });
}

// The step<->video sync is two-way, but only one direction is ever active at a time, gated on
// play state: paused -> step drives video (click/arrow-key selection seeks it, and always
// pauses first so selecting a step never unexpectedly starts playback); playing -> video drives
// step (see highlightStepForPlayback below, wired to timeupdate with a `video.paused` guard so
// it goes quiet the instant playback stops, leaving the last click/arrow selection in place).
function selectStep(node) {
  if (!node) return;
  document.querySelectorAll(".step-row.current-step").forEach((r) => r.classList.remove("current-step"));
  node.classList.add("current-step");
  const video = document.getElementById("steps-video");
  const seconds = Number(node.dataset.seek);
  video.pause();
  video.currentTime = Math.min(seconds, video.duration || seconds);
  node.scrollIntoView({ block: "nearest" });
}

// Follows along while the video is actively playing: highlights whichever step has the
// largest seek time at or before the current playback position. Scans every node rather than
// assuming SEEKABLE_NODES is time-sorted — it isn't always, since tree/document order and
// chronological order can genuinely disagree (a nested child can sit far from where its
// timestamp would place it in a flat sort). Wired to timeupdate with a `video.paused` check at
// the call site, so it's a no-op while paused.
function highlightStepForPlayback(video) {
  if (SEEKABLE_NODES.length === 0) return;
  let current = null;
  let bestSeek = -Infinity;
  for (const node of SEEKABLE_NODES) {
    const seek = Number(node.dataset.seek);
    if (seek <= video.currentTime && seek > bestSeek) {
      current = node;
      bestSeek = seek;
    }
  }
  document.querySelectorAll(".step-row.current-step").forEach((r) => {
    if (r !== current) r.classList.remove("current-step");
  });
  if (current) current.classList.add("current-step");
}

function renderSettingsPopup() {
  const allKeys = new Set();
  STEPS_DATA.forEach((d) => collectFilterKeys(d.command, allKeys));
  const sortedKeys = [...allKeys].sort((a, b) => filterKeyLabel(a).localeCompare(filterKeyLabel(b)));

  const keyRows = sortedKeys
    .map(
      (k) => `
      <div class="row">
        <input type="checkbox" data-filter-key="${k}" ${settings.hiddenFilterKeys.has(k) ? "" : "checked"} />
        <label>${filterKeyLabel(k)}</label>
      </div>`
    )
    .join("");

  return `
    <div class="row">
      <input type="checkbox" id="hide-skipped-toggle" ${settings.hideSkipped ? "checked" : ""} />
      <label for="hide-skipped-toggle">Hide skipped steps</label>
    </div>
    <div class="divider"></div>
    <div class="group-title">Show / hide command types</div>
    <div class="key-list">${keyRows}</div>`;
}

function wireSettingsPopup(popupEl) {
  popupEl.querySelector("#hide-skipped-toggle").addEventListener("change", (e) => {
    settings.hideSkipped = e.target.checked;
    renderStepsList();
  });
  popupEl.querySelectorAll("[data-filter-key]").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const key = e.target.dataset.filterKey;
      if (e.target.checked) settings.hiddenFilterKeys.delete(key);
      else settings.hiddenFilterKeys.add(key);
      renderStepsList();
      // Rebuild the popup itself too — the set of keys visible in the *remaining* tree can
      // shrink once a parent type is hidden, so stale checkboxes for now-absent keys would hang
      // around otherwise.
      popupEl.innerHTML = renderSettingsPopup();
      wireSettingsPopup(popupEl);
    });
  });
}

// Re-renders just the summary counts + step list + click-to-seek handlers from STEPS_DATA,
// applying current `settings`. Called on load and on every settings change.
function renderStepsList() {
  const listEl = document.getElementById("steps-list");
  const summaryEl = document.getElementById("steps-summary");
  const video = document.getElementById("steps-video");

  const sorted = [...STEPS_DATA]
    // Drop top-level entries that are really just the flattened record of a step nested
    // somewhere else in the tree — those render in place under their parent instead.
    .filter((d) => !NESTED_COMMAND_KEYS.has(commandKey(d.command)))
    .filter((d) => shouldShow(d.command, d.metadata))
    .sort((a, b) => a.metadata.timestamp - b.metadata.timestamp);

  // Counts reflect every real execution record (including nested ones we're about to render
  // in place), not just the deduplicated top-level rows, so they still add up to the true
  // pass/fail/skip totals for the run.
  const counts = STEPS_DATA.filter((d) => shouldShow(d.command, d.metadata)).reduce((acc, d) => {
    acc[d.metadata.status] = (acc[d.metadata.status] || 0) + 1;
    return acc;
  }, {});
  summaryEl.innerHTML = Object.entries(counts)
    .map(([s, n]) => `${STATUS_ICON[s] || "•"} <b>${n}</b> ${s.toLowerCase()}`)
    .join("&nbsp;&nbsp;&nbsp;");

  ROW_DETAILS = new Map();
  rowIdCounter = 0;
  METADATA_BY_COMMAND.reset();
  listEl.innerHTML = sorted
    .map((d) => `<li>${renderCommandNode(d.command, d.metadata, RECORDING_START_TS, METADATA_BY_COMMAND, 0)}</li>`)
    .join("");

  // Hover a row to see its raw command parameters in the bottom inspector panel — directly
  // answers "what condition/config/selector is this step actually using?" for otherwise-opaque
  // labels like "Apply configuration". Gated on `inspectorOpen` (the panel's own toggle) rather
  // than a separate setting — there's no reason to compute this while the panel is closed.
  // Content deliberately isn't cleared on mouseleave: unlike a cursor-following tooltip, this
  // panel is meant to stay put and be read after the mouse has moved on.
  const inspectorContent = document.getElementById("inspector-content");
  const inspectorSubtitle = document.getElementById("inspector-subtitle");
  listEl.querySelectorAll("[data-row-id]").forEach((row) => {
    row.addEventListener("mouseenter", () => {
      if (!inspectorOpen) return;
      const info = ROW_DETAILS.get(row.dataset.rowId);
      if (!info) return;
      const hasParams = Object.keys(info.params).length > 0;
      inspectorSubtitle.textContent = info.title;
      inspectorContent.textContent = hasParams ? JSON.stringify(info.params, null, 2) : "(no parameters)";
    });
  });

  // The whole row seeks; only its disclosure chevron (group rows only) toggles collapse.
  // The chevron's own handler calls stopPropagation, so it never reaches this row listener.
  listEl.querySelectorAll(".step-row[data-seek]").forEach((row) => {
    row.addEventListener("click", (e) => {
      // preventDefault blocks the native toggle-on-click-anywhere-in-summary behavior for
      // group rows — without it, clicking a group row's body would both seek AND collapse it.
      e.preventDefault();
      selectStep(row);
    });
  });
  listEl.querySelectorAll(".disclosure-chevron").forEach((chevron) => {
    chevron.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const details = chevron.closest("details.step-group");
      if (details) details.open = !details.open;
    });
  });

  SEEKABLE_NODES = Array.from(listEl.querySelectorAll(".step-row[data-seek]"));
  calibrateStepTimestamps(video);
}

// Steps data is embedded at build time (flow.stepsData, from manifest.js) — no fetch(), so
// this works over file:// too, not just http://.
function renderSteps() {
  const el = document.getElementById("steps-section");
  const flow = currentFlow();
  if (!flow.stepsData || flow.stepsData.length === 0) {
    el.innerHTML = `<div class="steps-error">No commands.json captured for this flow.</div>`;
    return;
  }

  STEPS_DATA = flow.stepsData;

  const startEntry = STEPS_DATA.find((d) => Object.keys(d.command)[0] === "startRecordingCommand");
  RECORDING_START_TS = startEntry ? startEntry.metadata.timestamp : null;
  const stopEntry = STEPS_DATA.find((d) => Object.keys(d.command)[0] === "stopRecordingCommand");
  RECORDING_STOP_TS = stopEntry ? stopEntry.metadata.timestamp : null;

  NESTED_COMMAND_KEYS = new Set();
  STEPS_DATA.forEach((d) => collectNestedCommands(d.command, NESTED_COMMAND_KEYS));
  METADATA_BY_COMMAND = buildMetadataQueues(STEPS_DATA);

  el.innerHTML = `
    <div class="steps-header">
      <button id="steps-settings-btn" class="settings-btn" title="Show/hide command types">&#9881;</button>
      <button id="inspector-toggle-btn" class="settings-btn${inspectorOpen ? " active" : ""}" title="Toggle inspector panel">${INSPECTOR_ICON}</button>
      <div id="steps-settings-popup" class="settings-popup" hidden></div>
    </div>
    <div class="steps-summary" id="steps-summary"></div>
    <div class="steps-synced">
      <div class="steps-col"><ul class="steps-tree" id="steps-list"></ul></div>
      <div class="video-col">
        ${flow.video ? `<video id="steps-video" src="${flow.video}" controls></video>` : `<div class="steps-error">No recording for this flow.</div>`}
        ${RECORDING_START_TS && RECORDING_STOP_TS ? "" : `<div class="seek-hint">Recording start/stop not both found; steps aren't seekable.</div>`}
      </div>
    </div>
    <div class="inspector-panel" id="inspector-panel"${inspectorOpen ? "" : " hidden"}>
      <div class="resizer inspector-resizer" id="inspector-resizer"></div>
      <div class="inspector-header">
        <span class="inspector-title">Inspector</span>
        <span class="inspector-subtitle" id="inspector-subtitle">Hover a step to see its raw parameters</span>
        <button class="inspector-close-btn" id="inspector-close-btn" title="Hide inspector" aria-label="Hide inspector">&times;</button>
      </div>
      <pre class="inspector-content" id="inspector-content"></pre>
    </div>`;

  const popup = document.getElementById("steps-settings-popup");
  const settingsBtn = document.getElementById("steps-settings-btn");
  popup.innerHTML = renderSettingsPopup();
  wireSettingsPopup(popup);
  settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    popup.hidden = !popup.hidden;
  });
  document.addEventListener("click", (e) => {
    // Exclude the toggle button itself — its own click handler (above) already flipped
    // `hidden` for this same event; without this check, this listener runs right after and
    // immediately closes what the button just opened.
    if (!popup.hidden && !popup.contains(e.target) && e.target !== settingsBtn) popup.hidden = true;
  });

  const inspectorToggleBtn = document.getElementById("inspector-toggle-btn");
  const inspectorPanel = document.getElementById("inspector-panel");
  const inspectorCloseBtn = document.getElementById("inspector-close-btn");
  function setInspectorOpen(open) {
    inspectorOpen = open;
    inspectorPanel.hidden = !open;
    inspectorToggleBtn.classList.toggle("active", open);
  }
  inspectorToggleBtn.addEventListener("click", () => setInspectorOpen(!inspectorOpen));
  inspectorCloseBtn.addEventListener("click", () => setInspectorOpen(false));

  const video = document.getElementById("steps-video");
  if (video) {
    video.addEventListener("timeupdate", () => {
      if (video.paused) return; // paused: the last click/arrow selection stays authoritative
      highlightStepForPlayback(video);
    });
  }

  renderStepsList();
}

function renderFlowMainView() {
  const flow = currentFlow();
  document.getElementById("flow-title").textContent = flow.label;
  document.getElementById("flow-key-tag").textContent = currentFlowKey();
  const pill = document.getElementById("flow-status-pill");
  pill.className = `flow-status-pill ${flow.passed === true ? "passed" : flow.passed === false ? "failed" : "unknown"}`;
  pill.textContent = flow.passed === true ? "Passed" : flow.passed === false ? "Failed" : "No steps";
  renderSteps();
  restoreResizerSizes();
  document.getElementById("screenshots-tab-count").textContent = computeOrderedScreenshots(currentFlowKey()).length;
  activeTab = "steps";
  renderTabs();
}

function renderMain() {
  renderFlowNav();
  document.querySelectorAll(".view-tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === currentView));
  updateSidebarVisibility();
  document.getElementById("main-view-flow").hidden = currentView !== "flow";
  document.getElementById("main-view-snapshots").hidden = currentView !== "snapshots";
  if (currentView === "snapshots") {
    renderGlobalSnapshotsView();
  } else {
    renderFlowMainView();
  }
}

const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxCaption = document.getElementById("lightbox-caption");
const lightboxPrevBtn = document.getElementById("lightbox-prev");
const lightboxNextBtn = document.getElementById("lightbox-next");
const lightboxFilmstrip = document.getElementById("lightbox-filmstrip");

// By default the lightbox navigates the *current flow's full capture-order list* (same one the
// Screenshots tab shows), regardless of whether it was opened from a step row's inline
// thumbnail or from that tab — so ←/→ always means "previous/next screenshot taken", not
// "next thumbnail in whichever list happened to render it". Opened with {global: true} (only
// from the Snapshots page) it instead navigates every flow's screenshots back to back —
// lightboxIsGlobal gates the flow-sync behavior in renderLightboxContent() below.
let lightboxList = [];
let lightboxIndex = -1;
let lightboxIsGlobal = false;

// The filmstrip's <img> elements are only rebuilt here (once per open), not on every nav step —
// renderLightboxContent() just toggles .active and scrolls, so stepping through never reloads
// or flickers thumbnails that are already in the DOM.
function buildLightboxFilmstrip() {
  lightboxFilmstrip.innerHTML = lightboxList
    .map((o, i) => `<img class="filmstrip-thumb" data-index="${i}" src="${o.screenshot.src}" alt="" />`)
    .join("");
  lightboxFilmstrip.hidden = lightboxList.length < 2;
  lightboxFilmstrip.querySelectorAll(".filmstrip-thumb").forEach((thumb) => {
    thumb.addEventListener("click", (e) => {
      e.stopPropagation();
      lightboxIndex = Number(thumb.dataset.index);
      renderLightboxContent();
    });
  });
}

function renderLightboxContent() {
  const item = lightboxList[lightboxIndex];
  if (!item) return;
  lightboxImg.src = item.screenshot.src;
  const name = item.label || item.screenshot.name;
  const displayName = lightboxIsGlobal && item.flowLabel ? `${item.flowLabel} / ${name}` : name;
  const time = item.seekSeconds != null ? formatSeek(item.seekSeconds) : null;
  lightboxCaption.innerHTML = `<span class="lb-name">${escapeHtml(displayName)}</span>${
    time ? `<span class="lb-time">${time}</span>` : ""
  }`;
  const hasMultiple = lightboxList.length > 1;
  lightboxPrevBtn.hidden = !hasMultiple;
  lightboxNextBtn.hidden = !hasMultiple;

  lightboxFilmstrip.querySelectorAll(".filmstrip-thumb").forEach((thumb, i) => {
    thumb.classList.toggle("active", i === lightboxIndex);
  });
  const activeThumb = lightboxFilmstrip.querySelector(".filmstrip-thumb.active");
  if (activeThumb) activeThumb.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });

  // Crossing into another flow's screenshots updates which flow is "selected" (sidebar
  // highlight + ?flow= in the URL) — cheaply, without a full renderMain(), since the lightbox
  // sits on top of and hides whatever the main content currently is.
  if (lightboxIsGlobal && item.flowKey && item.flowKey !== currentFlowKey()) {
    const url = new URL(window.location);
    url.searchParams.set("flow", item.flowKey);
    history.replaceState(null, "", url);
    renderFlowNav();
  }
}

function openLightbox(src, { global = false } = {}) {
  lightboxIsGlobal = global;
  lightboxList = global ? computeAllScreenshots() : computeOrderedScreenshots(currentFlowKey());
  const found = lightboxList.findIndex((o) => o.screenshot.src === src);
  lightboxIndex = found === -1 ? 0 : found;
  buildLightboxFilmstrip();
  renderLightboxContent();
  lightbox.classList.add("open");
}

function lightboxStep(delta) {
  if (lightboxList.length === 0) return;
  lightboxIndex = (lightboxIndex + delta + lightboxList.length) % lightboxList.length;
  renderLightboxContent();
}

lightbox.addEventListener("click", () => lightbox.classList.remove("open"));
lightboxPrevBtn.addEventListener("click", (e) => { e.stopPropagation(); lightboxStep(-1); });
lightboxNextBtn.addEventListener("click", (e) => { e.stopPropagation(); lightboxStep(1); });
lightboxCaption.addEventListener("click", (e) => e.stopPropagation());
lightboxFilmstrip.addEventListener("click", (e) => e.stopPropagation());

// Space toggles video play/pause; up/down arrow keys move the current-step selection and seek
// the video there. preventDefault on Space covers two things at once: the page's own default
// (scrolling down) and the <video> element's native space-to-toggle handling when it has focus
// — without it, a focused video would toggle from both the native handler and this one on the
// same keypress, immediately undoing itself.
document.addEventListener("keydown", (e) => {
  const tag = document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement.isContentEditable) return;

  // While the lightbox is open, ←/→ own the keyboard (step through screenshots) instead of
  // the background step list's ↑/↓ or space — the video/steps behind it aren't visible anyway.
  if (lightbox.classList.contains("open")) {
    if (e.key === "ArrowLeft") { e.preventDefault(); lightboxStep(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); lightboxStep(1); }
    return;
  }

  if (e.key === " " || e.code === "Space") {
    e.preventDefault();
    const video = document.getElementById("steps-video");
    if (video) video.paused ? video.play() : video.pause();
    return;
  }

  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  if (SEEKABLE_NODES.length === 0) return;
  e.preventDefault();
  const currentIdx = SEEKABLE_NODES.findIndex((n) => n.classList.contains("current-step"));
  const delta = e.key === "ArrowDown" ? 1 : -1;
  const nextIdx = Math.max(0, Math.min(SEEKABLE_NODES.length - 1, currentIdx + delta));
  selectStep(SEEKABLE_NODES[nextIdx]);
});

// Sidebar visibility has two independent inputs that both have to agree — the user's manual
// collapse toggle, and the top-level view (the sidebar is a flow picker, so it has nothing to
// do on the Snapshots page and hides there regardless of the manual toggle's state). localStorage
// is wrapped in try/catch since some browsers throw on it for file:// origins (opening the report
// directly rather than through the recommended local server still needs to work; only the
// "remember it across reloads" part is allowed to silently fail).
const NAV_COLLAPSED_KEY = "maestroReportNavCollapsed";
const flowNavWrap = document.getElementById("flow-nav-wrap");
const flowNavCollapseBtn = document.getElementById("flow-nav-collapse-btn");
const flowNavExpandBtn = document.getElementById("flow-nav-expand-btn");

let navManuallyCollapsed = false;

function updateSidebarVisibility() {
  flowNavWrap.hidden = currentView !== "flow" || navManuallyCollapsed;
  // The "bring the sidebar back" button only makes sense when the sidebar would otherwise be
  // showing for this view but was manually collapsed — not on the Snapshots page, where
  // main-view-flow (and this button, one of its children) is already hidden entirely.
  flowNavExpandBtn.hidden = !(currentView === "flow" && navManuallyCollapsed);
}

function setNavCollapsed(collapsed) {
  navManuallyCollapsed = collapsed;
  updateSidebarVisibility();
  try {
    localStorage.setItem(NAV_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {}
}

flowNavCollapseBtn.addEventListener("click", () => setNavCollapsed(true));
flowNavExpandBtn.addEventListener("click", () => setNavCollapsed(false));

try {
  navManuallyCollapsed = localStorage.getItem(NAV_COLLAPSED_KEY) === "1";
} catch {}

// Drag-to-resize for the side nav (width) and inspector panel (height). Bound once via
// delegation on `document`, not on the handle elements directly — `#inspector-resizer` is
// recreated by every renderSteps() call (steps-section's innerHTML swap), so binding straight to
// the handle would mean re-attaching (and leaking) a fresh set of document mousemove/mouseup
// listeners on every flow switch instead of resolving the current element by id each time.
const RESIZE_CONFIGS = {
  "nav-resizer": {
    getTarget: () => document.getElementById("flow-nav-wrap"),
    axis: "x",
    min: 160,
    max: 480,
    storageKey: "maestroReportNavWidth",
  },
  "inspector-resizer": {
    getTarget: () => document.getElementById("inspector-panel"),
    axis: "y",
    invert: true, // handle sits on the panel's top edge — dragging up (smaller clientY) grows it
    min: 120,
    max: 500,
    storageKey: "maestroReportInspectorHeight",
  },
};

let activeResize = null;

document.addEventListener("mousedown", (e) => {
  const handle = e.target.closest(".resizer");
  if (!handle) return;
  const config = RESIZE_CONFIGS[handle.id];
  const target = config && config.getTarget();
  if (!target) return;
  const rect = target.getBoundingClientRect();
  activeResize = {
    config,
    handle,
    startPos: config.axis === "x" ? e.clientX : e.clientY,
    startSize: config.axis === "x" ? rect.width : rect.height,
  };
  handle.classList.add("resizing");
  document.body.style.cursor = config.axis === "x" ? "col-resize" : "row-resize";
  document.body.style.userSelect = "none";
  e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
  if (!activeResize) return;
  const { config, startPos, startSize } = activeResize;
  const target = config.getTarget();
  if (!target) return;
  const clientPos = config.axis === "x" ? e.clientX : e.clientY;
  const rawDelta = clientPos - startPos;
  const size = Math.max(config.min, Math.min(config.max, startSize + (config.invert ? -rawDelta : rawDelta)));
  target.style.flex = `0 0 ${size}px`;
});

document.addEventListener("mouseup", () => {
  if (!activeResize) return;
  const { config, handle } = activeResize;
  const target = config.getTarget();
  handle.classList.remove("resizing");
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  if (target) {
    try {
      localStorage.setItem(config.storageKey, target.style.flexBasis);
    } catch {}
  }
  activeResize = null;
});

// Re-applied on every renderMain() (not just at startup) because the inspector panel's DOM is
// rebuilt on every flow switch and would otherwise reset to its CSS default size each time.
function restoreResizerSizes() {
  Object.values(RESIZE_CONFIGS).forEach((config) => {
    let saved = null;
    try {
      saved = localStorage.getItem(config.storageKey);
    } catch {}
    if (!saved) return;
    const target = config.getTarget();
    if (target) target.style.flex = `0 0 ${saved}`;
  });
}

renderMain();
