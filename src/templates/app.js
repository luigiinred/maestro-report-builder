// Generated report viewer. MANIFEST (including each flow's parsed commands.json as
// `stepsData`) is defined by the sibling manifest.js, loaded before this file.

// Step-tree filtering settings, editable live via the gear popup next to "Test Steps".
// `hiddenFilterKeys` holds filterKey() results (see below) the user has hidden; `hideSkipped`
// removes SKIPPED top-level steps (and their dead sub-trees) entirely rather than just
// collapsing them.
const settings = {
  hideSkipped: true,
  inspectOnHover: true,
  hiddenFilterKeys: new Set([
    "defineVariablesCommand",
    "applyConfigurationCommand",
    "runFlowCommand:setEnv.yml",
  ]),
};

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
  renderMain();
}

function renderFlowNav() {
  const nav = document.getElementById("flow-nav");
  const active = currentFlowKey();
  nav.innerHTML = Object.entries(MANIFEST)
    .map(([key, flow]) => {
      const status = flow.passed === true ? "✅" : flow.passed === false ? "❌" : "•";
      return `
      <div class="flow-nav-item${key === active ? " active" : ""}" data-flow-key="${key}">
        <span class="flow-nav-status">${status}</span>${flow.label}
      </div>`;
    })
    .join("");
  nav.querySelectorAll(".flow-nav-item").forEach((el) => {
    el.addEventListener("click", () => setFlow(el.dataset.flowKey));
  });
}

// Maestro's own reporting artifacts, per flow — populated at build time by scanning each
// flow's _maestro-native/ directory (see src/scan.js in the generator).
function renderNativePanel() {
  const panel = document.getElementById("native-panel");
  const native = currentFlow().native;
  if (!native) {
    panel.innerHTML = `<div class="title">Maestro's own reports</div><div style="color:var(--text-dim)">None captured for this flow.</div>`;
    return;
  }
  panel.innerHTML = `
    <div class="title">Maestro's own reports</div>
    ${native.report ? `<a href="${native.report}" target="_blank">Full HTML report</a>` : ""}
    ${native.commandsJson ? `<a href="${native.commandsJson}" target="_blank">commands.json</a>` : ""}
    ${native.debugLog ? `<a href="${native.debugLog}" target="_blank">maestro.log</a>` : ""}
    ${native.failureScreenshot ? `<a class="fail" href="${native.failureScreenshot}" target="_blank">⚠ auto screenshot-on-failure</a>` : ""}
  `;
}

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
function screenshotForCommand(key, body) {
  if (key !== "takeScreenshotCommand" || !body.path) return null;
  const name = body.path.split("/").pop();
  return (currentFlow().screenshots || []).find((s) => s.name === name) || null;
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
    <div class="row">
      <input type="checkbox" id="inspect-hover-toggle" ${settings.inspectOnHover ? "checked" : ""} />
      <label for="inspect-hover-toggle">Show details on hover</label>
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
  popupEl.querySelector("#inspect-hover-toggle").addEventListener("change", (e) => {
    settings.inspectOnHover = e.target.checked;
    if (!settings.inspectOnHover) document.getElementById("step-tooltip").classList.remove("open");
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

  // Hover a row to see its raw command parameters — directly answers "what condition/config/
  // selector is this step actually using?" for otherwise-opaque labels like "Apply configuration".
  // Gated on settings.inspectOnHover (toggle in the gear popup) so it can be turned off.
  const tooltip = document.getElementById("step-tooltip");
  listEl.querySelectorAll("[data-row-id]").forEach((row) => {
    row.addEventListener("mouseenter", () => {
      if (!settings.inspectOnHover) return;
      const info = ROW_DETAILS.get(row.dataset.rowId);
      if (!info) return;
      const hasParams = Object.keys(info.params).length > 0;
      tooltip.innerHTML = `<div class="tt-title">${info.title}</div><pre>${
        hasParams ? escapeHtml(JSON.stringify(info.params, null, 2)) : "(no parameters)"
      }</pre>`;
      tooltip.classList.add("open");
    });
    row.addEventListener("mousemove", (e) => {
      tooltip.style.left = Math.min(e.clientX + 16, window.innerWidth - 440) + "px";
      tooltip.style.top = Math.min(e.clientY + 16, window.innerHeight - 20) + "px";
    });
    row.addEventListener("mouseleave", () => tooltip.classList.remove("open"));
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
      <h3 style="color:var(--text-dim); font-weight: 500; text-transform: uppercase; font-size: 12px; letter-spacing: 0.04em; margin: 0;">Test Steps — click a row (or ↑/↓) to jump the video there</h3>
      <button id="steps-settings-btn" class="settings-btn" title="Show/hide command types">&#9881;</button>
      <div id="steps-settings-popup" class="settings-popup" hidden></div>
    </div>
    <div class="steps-summary" id="steps-summary"></div>
    <div class="steps-synced">
      <div class="steps-col"><ul class="steps-tree" id="steps-list"></ul></div>
      <div class="video-col">
        ${flow.video ? `<video id="steps-video" src="${flow.video}" controls></video>` : `<div class="steps-error">No recording for this flow.</div>`}
        <div class="seek-hint">${RECORDING_START_TS && RECORDING_STOP_TS ? "Timestamps calibrated to the real recording length — still approximate; see comment in source." : "Recording start/stop not both found; steps aren't seekable."}</div>
      </div>
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

  const video = document.getElementById("steps-video");
  if (video) {
    video.addEventListener("timeupdate", () => {
      if (video.paused) return; // paused: the last click/arrow selection stays authoritative
      highlightStepForPlayback(video);
    });
  }

  renderStepsList();
}

function renderMain() {
  document.getElementById("flow-title").textContent = currentFlow().label;
  renderFlowNav();
  renderNativePanel();
  renderSteps();
}

const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
function openLightbox(src) {
  lightboxImg.src = src;
  lightbox.classList.add("open");
}
lightbox.addEventListener("click", () => lightbox.classList.remove("open"));

// Space toggles video play/pause; up/down arrow keys move the current-step selection and seek
// the video there. preventDefault on Space covers two things at once: the page's own default
// (scrolling down) and the <video> element's native space-to-toggle handling when it has focus
// — without it, a focused video would toggle from both the native handler and this one on the
// same keypress, immediately undoing itself.
document.addEventListener("keydown", (e) => {
  const tag = document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement.isContentEditable) return;

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

renderMain();
