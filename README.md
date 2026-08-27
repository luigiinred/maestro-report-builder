# maestro-report-builder

Compiles a static, self-contained HTML report from a `maestro/.artifacts/` directory produced
by Maestro flows run with `-e SAVE_ARTIFACTS=true`. No AI in the build path — `bin/build.js` is
a plain Node script that scans the filesystem and generates static files.

Ported from a throwaway prototype (`your-app/maestro/artifact-report.prototype.html`) built
interactively to answer "what should this report look like" — this project is the real,
scriptable version of that answer.

Two Claude Code skills live in `.claude/skills/` for driving this repeatably:

- **`generate-report`** — wires a Maestro flow for `SAVE_ARTIFACTS` if it isn't already, runs
  it (twice — see [the two-run gotcha](#the-two-run-gotcha)), and builds the static report.
- **`share-report`** — builds (if needed), zips the output, and hands it back as a file ready
  to share internally. Never uploads or deploys anywhere on its own — see
  [Company-data note](#company-data-note).

## What it produces

Per flow found under the artifacts directory:

- A **step tree** parsed from Maestro's own `commands.json` — full-width rows, pass/fail/skip
  status icons, a right-side timestamp calibrated to the real recording length, inline
  screenshot thumbnails on the row that captured them, and a collapsible bottom inspector panel
  (hover a row to see its raw parameters there).
- A **synced video player** — click a step (or use ↑/↓) to jump the video there; while the
  video is playing, the step list follows along instead.
- A **Screenshots tab** alongside the step tree, showing every screenshot captured during the
  flow as a grid in capture order (derived from `commands.json` timestamps), each tagged with
  its seek time — plus the flow's auto-captured failure screenshot (see below), if any.
- A **left nav** with a real folder tree (flows nested under directories collapse the way
  GitHub's file tree does) and a filter box.

Across the whole run:

- A global **Snapshots page** (the sidebar's other tab, alongside Flows) — every flow's
  screenshots on one page, grouped into a section per flow labeled with its pass/fail status. A
  flow with none still gets a section, just with a "No snapshots" placeholder.
- Clicking any screenshot — from a step row, the per-flow Screenshots tab, or the global
  Snapshots page — opens the same fullscreen lightbox (arrow keys, a filmstrip, prev/next). Only
  the Snapshots page's lightbox navigates *across* flows: crossing from one flow's shots into
  the next's updates which flow is selected in the sidebar.

Maestro's own native artifacts (`report.html`, `commands.json`, `maestro.log`) are still copied
into each flow's output subdirectory but not linked from the generated UI; the auto-captured
failure screenshot is the exception — it shows up as a regular (red-bordered) screenshot in both
the per-flow Screenshots tab and the global Snapshots page.

## The SAVE_ARTIFACTS pattern (source-side prerequisite)

This tool only *reads* a `maestro/.artifacts/` directory — it doesn't create one. That
directory only exists if the Maestro flow(s) you ran were wired for it. If a flow isn't wired
yet, add this to it first (all of this lives in the flow's own `.yml`, in the target Maestro
repo — e.g. `your-app`):

**1. Two env vars, off by default:**

```yaml
env:
  SAVE_ARTIFACTS: ${SAVE_ARTIFACTS || "false"}
  ARTIFACTS_DIR: ${ARTIFACTS_DIR || "maestro/.artifacts"}
```

**2. `onFlowStart`/`onFlowComplete` hooks to record the whole run, gated on the flag:**

```yaml
onFlowStart:
  - runFlow:
      when:
        true: ${SAVE_ARTIFACTS == "true"}
      commands:
        - startRecording: "${ARTIFACTS_DIR}/<flowName>/recording"
onFlowComplete:
  - runFlow:
      when:
        true: ${SAVE_ARTIFACTS == "true"}
      commands:
        - stopRecording
```

Note **no file extension** on the `startRecording` name — Maestro appends `.mp4` itself; giving
it `recording.mp4` produces `recording.mp4.mp4`.

**3. Wrap every `takeScreenshot` call the same way, at whatever moments in the flow are worth a
key-moment screenshot:**

```yaml
- runFlow:
    when:
      true: ${SAVE_ARTIFACTS == "true"}
    commands:
      - takeScreenshot:
          path: "${ARTIFACTS_DIR}/<flowName>/<screenshot_name>"
```

Same no-extension rule applies (Maestro appends `.png`).

**4. Run it:**

```bash
maestro test -e SAVE_ARTIFACTS=true path/to/theFlow.yml
```

This alone gets you `<ARTIFACTS_DIR>/<flowName>/recording.mp4` and any `*.png` screenshots at
the flow's top level — enough for `maestro-report-builder` to show video + screenshots, but
**not** the step tree (that needs `commands.json`, which requires a second, differently-flagged
run — see below).

### The two-run gotcha

To get the **step tree**, you additionally need `commands.json`, which only gets written when
you pass `--test-output-dir`/`--debug-output`/`--format HTML-DETAILED` to `maestro test`:

```bash
maestro test \
  -e SAVE_ARTIFACTS=true \
  --test-output-dir maestro/.artifacts/<flowName>/_maestro-native \
  --debug-output maestro/.artifacts/<flowName>/_maestro-native/debug \
  --format HTML-DETAILED \
  --output maestro/.artifacts/<flowName>/report.html \
  path/to/theFlow.yml
```

**The catch:** passing `--test-output-dir` changes where `startRecording`/`takeScreenshot`'s
own explicit paths land — they get nested under
`_maestro-native/screenshots/<the given ARTIFACTS_DIR path>` instead of the flow's top-level
directory this tool expects. So this native-reporting run's *own* video/screenshots aren't
usable directly; only its `_maestro-native/<timestamp>/commands-*.json`,
`_maestro-native/debug/.maestro/tests/<timestamp>/maestro.log`, and
`_maestro-native/<timestamp>/screenshot-❌-*.png` (auto-captured on failure, if any) are.

**In practice, run the flow twice:**

1. The native-reporting invocation above, for `commands.json` + debug log + failure screenshot.
2. The plain invocation (`maestro test -e SAVE_ARTIFACTS=true theFlow.yml`, no extra flags), for
   the correctly-placed top-level `recording.mp4` and screenshots.

`maestro-report-builder` reads from both locations (see [How discovery
works](#how-discovery-works-srcscanjs)) and merges them into one flow entry. This wasn't fixed
at the Maestro-flow level — it's a real design gap in the pattern itself, not something this
tool works around cleverly. The `generate-report` skill runs both invocations for you.

## Usage

Without installing anything, straight from GitHub:

```bash
npx github:luigiinred/maestro-report-builder <path-to-maestro-.artifacts-dir> [outputDir] [--serve] [--port N]
```

Or from a local clone:

```bash
node bin/build.js <path-to-maestro-.artifacts-dir> [outputDir] [--serve] [--port N]
# e.g.
node bin/build.js ~/Developer/your-app/maestro/.artifacts ./dist --serve
```

Or via npm script (defaults output to `./dist`):

```bash
npm run build -- <path-to-maestro-.artifacts-dir> --serve
```

This produces `<outputDir>/` containing `index.html`, `app.css`, `app.js`, `manifest.js`, and
one subdirectory per flow holding its copied video/screenshots/native-report files. The whole
directory is self-contained and portable — copy it anywhere, including an S3 bucket for static
website hosting (subject to the [company-data note](#company-data-note) below).

### Viewing the output

Video **seeking** needs a real HTTP server that supports byte-range requests. Opening
`index.html` directly via `file://` loads fine, but scrubbing/clicking a step to seek may
silently fail to move the video (`<video>.currentTime` gets rejected with no error when the
server — or lack thereof — can't serve a range). Pass `--serve` (optionally `--port N`, default
8765) and the build command starts one itself — no separate step, no extra dependency.

Do **not** use `python3 -m http.server` for this — it ignores Range headers entirely and has
the same silent-seek-failure problem. S3 static website hosting supports Range requests
natively, so a deployed copy doesn't have this issue.

## How the video/step sync works (`src/templates/app.js`)

The step tree and video are two independently-derived views of the same `commands.json`, kept
in sync by a few specific mechanisms:

- **Seek time, not duration.** Each step's right-side timestamp is *when it happened in the
  recording* (`(step.metadata.timestamp - startRecordingTimestamp) / 1000`), not how long the
  step itself took to execute. `startRecordingCommand`'s own timestamp is the zero-point.

- **Calibration against the real video length.** The raw offset above is only approximate —
  Maestro's `simctl`-based recorder has real startup/teardown latency the raw timestamps don't
  fully capture (confirmed by reading Maestro's own source: `screenrecord.sh` sleeps 2s after
  launching `simctl recordVideo` before signaling "started"). Rather than guess at a fixed
  correction, `calibrateStepTimestamps()` scales every raw offset by
  `video.duration / (stopRecordingTimestamp - startRecordingTimestamp)` once the video's real
  `duration` is known (on `loadedmetadata`). This exactly anchors both known reference points
  (t=0 at recording start, the `stopRecording` step at the real end) and linearly interpolates
  between them — it doesn't know whether the true drift is front- or back-loaded, but it's a
  measurement-based correction, not an assumed constant.

- **Deduplication via a per-key FIFO queue, not a flat map.** `commands.json`'s flat array
  isn't just top-level flow steps — Maestro also flattens every command *inside* a
  `runFlow`/`retry`'s own `commands` array into its own top-level entry with real metadata,
  while the parent's `commands` array separately keeps a metadata-less static copy of the same
  command for structural display. Naively, this makes every nested step appear twice. The fix
  (`buildMetadataQueues()` in `app.js`) matches a top-level entry to its nested position by
  JSON-content equality, but two *different* steps can have byte-identical parameters (e.g. two
  separate "Wait for animation to end" calls) and collide on that same key — a flat `Map` would
  silently return the *first* occurrence's metadata for every later match, corrupting
  timestamps for anything after the first collision. The queue keeps one FIFO list per key,
  built in chronological order, and each lookup consumes the next unclaimed item — correct as
  long as collection and consumption walk the tree in the same order, which they do (both driven
  by the same `commands.json` data every render).

- **Two-way sync, one direction active at a time, gated on play state.** Paused: clicking a
  step (or ↑/↓) seeks the video and pauses it first, so selecting a step never surprises you
  with playback. Playing: `highlightStepForPlayback()` runs on `timeupdate` (guarded on
  `!video.paused`) and highlights whichever step has the largest seek time at or before the
  current playback position — scanning every node rather than assuming the list is
  time-sorted, since tree/document order and chronological order can genuinely disagree (a
  nested child can sit far from where its timestamp would place it in a flat sort).

- **Screenshots are matched by filename, not by any explicit id.** A `takeScreenshotCommand`'s
  own `path` field is the *unresolved* `"${ARTIFACTS_DIR}/<flow>/<name>"` template Maestro
  recorded — not a real filesystem path. `screenshotForCommand()` takes the basename of that
  path and looks it up against the flow's `screenshots` array (built by `src/scan.js` from the
  actual `.png` files on disk) to find the real image for the inline thumbnail.

## How discovery works (`src/scan.js`)

A directory counts as a flow once it has any file SAVE_ARTIFACTS/native-reporting actually
writes into it (`recording.mp4`, a `*.png`, `report.html`, or a `_maestro-native/` subfolder).
Anything above that — a plain directory with no such files, just more subdirectories — is
treated as a grouping folder, not a flow, and discovery recurses into it. So
`.artifacts/viewLoginFlow/` is one flow, but `.artifacts/retirement/viewDashboard/` also works —
`retirement/` is a grouping folder, `viewDashboard/` is the flow — and the left nav renders that
nesting as a real folder tree instead of one flat list. Nesting can go arbitrarily deep; there's
no requirement that every flow sit at the same depth.

Within a flow directory:

| What | Where it's found |
|---|---|
| Video | `<flow>/recording.mp4` |
| Screenshots | Any `*.png` directly in `<flow>/` |
| Maestro's HTML report | `<flow>/report.html` |
| `commands.json`, native debug log, failure screenshot | `<flow>/_maestro-native/<latest-timestamp>/` — the lexicographically-last timestamped subfolder is used if a flow was run more than once |
| Pass/fail | Derived from `commands.json`: `passed = true` unless any step has `metadata.status === "FAILED"` |
| Display label | Humanized from the flow directory's own name (e.g. `viewLoginFlow` → "View Login Flow"), not its full path — the flow YAML's own `name:` string isn't captured anywhere in `commands.json`, so there's nothing on disk to read the real title from without also parsing the `.yml` source, which this tool doesn't do |

## Company-data note

Report output contains real product screenshots/video, even when the underlying data is
synthetic test data. Don't publish the generated output to a personal or public destination —
check your organization's data-handling policy. This tool only produces local static files (and
the `share-report` skill only zips them); neither uploads or deploys anything anywhere. Internal
sharing (e.g. attaching the zip in an internal Slack channel) is fine; a personal AWS account or
a public/link-accessible bucket is not, regardless of how synthetic the underlying test data is.
