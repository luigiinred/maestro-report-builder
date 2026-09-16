#!/usr/bin/env node
// No AI in this path — pure filesystem scan + string templating. See src/scan.js for the
// discovery logic and src/templates/ for the static app shell it feeds.
const fs = require("fs");
const path = require("path");
const http = require("http");
const { scanArtifactsRoot } = require("../src/scan");

// --serve/--port/--watch are pulled out of argv before the two positional args are read, so
// they can go anywhere on the command line.
const args = process.argv.slice(2);
const serveFlagIndex = args.indexOf("--serve");
const shouldServe = serveFlagIndex !== -1;
if (shouldServe) args.splice(serveFlagIndex, 1);
const watchFlagIndex = args.indexOf("--watch");
const shouldWatch = watchFlagIndex !== -1;
if (shouldWatch) args.splice(watchFlagIndex, 1);
let port = 8765;
const portFlagIndex = args.indexOf("--port");
if (portFlagIndex !== -1) {
  port = Number(args[portFlagIndex + 1]);
  args.splice(portFlagIndex, 2);
}
const [artifactsDirArg, outDirArg] = args;

if (!artifactsDirArg) {
  console.error("Usage: maestro-report-builder <path-to-maestro-.artifacts-dir> [outputDir] [--serve] [--port N] [--watch]");
  console.error("Example: maestro-report-builder ~/Developer/your-app/maestro/.artifacts ./dist --serve --watch");
  process.exit(1);
}

const artifactsDir = path.resolve(artifactsDirArg);
const outDir = path.resolve(outDirArg || "./dist");
const templatesDir = path.join(__dirname, "..", "src", "templates");

if (!fs.existsSync(artifactsDir) || !fs.statSync(artifactsDir).isDirectory()) {
  console.error(`Artifacts directory not found: ${artifactsDir}`);
  process.exit(1);
}

// Set by the --watch loop below and read by build() to decide whether to embed the live-reload
// client script. A plain one-shot build never includes it — no server exists for it to talk to.
let liveReloadEnabled = shouldWatch && shouldServe;

// Runs the full scan → copy → manifest.js pass. Safe to call repeatedly (each call wipes and
// rebuilds outDir from scratch) — that's what --watch does on every filesystem change.
function build({ quiet } = {}) {
  const flows = scanArtifactsRoot(artifactsDir);
  if (flows.length === 0) {
    if (!quiet) console.error(`No flow subdirectories found in ${artifactsDir}`);
    return { flowCount: 0 };
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = {};
  let skippedForNoSteps = 0;

  for (const flow of flows) {
    if (!flow.stepsData) skippedForNoSteps++;

    const flowOutDir = path.join(outDir, flow.key);
    fs.mkdirSync(flowOutDir, { recursive: true });

    let video = null;
    if (flow.videoFile) {
      video = `${flow.key}/recording.mp4`;
      fs.copyFileSync(flow.videoFile, path.join(flowOutDir, "recording.mp4"));
    }

    const screenshots = flow.screenshots.map((s) => {
      const destName = path.basename(s.file);
      fs.copyFileSync(s.file, path.join(flowOutDir, destName));
      return { name: s.name, src: `${flow.key}/${destName}` };
    });

    const native = {};
    if (flow.reportHtmlFile) {
      fs.copyFileSync(flow.reportHtmlFile, path.join(flowOutDir, "report.html"));
      native.report = `${flow.key}/report.html`;
    }
    if (flow.debugLogFile) {
      fs.copyFileSync(flow.debugLogFile, path.join(flowOutDir, "maestro.log"));
      native.debugLog = `${flow.key}/maestro.log`;
    }
    if (flow.failureScreenshotFile) {
      const destName = "failure-screenshot.png";
      fs.copyFileSync(flow.failureScreenshotFile, path.join(flowOutDir, destName));
      native.failureScreenshot = `${flow.key}/${destName}`;
    }
    if (flow.commandsJsonFile) {
      fs.copyFileSync(flow.commandsJsonFile, path.join(flowOutDir, "commands.json"));
      native.commandsJson = `${flow.key}/commands.json`;
    }

    // Retry/re-run history: one entry per _maestro-native/<timestamp>/ dir found, oldest first
    // ("Run 1", "Run 2", ...). Each run gets its own copied commands.json + failure screenshot
    // (namespaced by index so they don't collide with each other or with the "latest run"
    // copies above) so the UI can let you flip between attempts and see each one's actual step
    // tree, not just the final outcome. Video/screenshots are NOT versioned per run — Maestro's
    // SAVE_ARTIFACTS paths aren't retry-aware, so a re-run overwrites the previous attempt's
    // recording/screenshots; only the native step-tree survives per-run.
    let runsOut = null;
    if (flow.runs && flow.runs.length > 0) {
      const runsDir = path.join(flowOutDir, "_runs");
      fs.mkdirSync(runsDir, { recursive: true });
      runsOut = flow.runs.map((run, i) => {
        const entry = { index: i + 1, timestamp: run.timestamp, passed: run.passed, commandsJson: null, failureScreenshot: null };
        if (run.commandsJsonFile) {
          const dest = `run-${i + 1}-commands.json`;
          fs.copyFileSync(run.commandsJsonFile, path.join(runsDir, dest));
          entry.commandsJson = `${flow.key}/_runs/${dest}`;
        }
        if (run.failureScreenshotFile) {
          const dest = `run-${i + 1}-failure.png`;
          fs.copyFileSync(run.failureScreenshotFile, path.join(runsDir, dest));
          entry.failureScreenshot = `${flow.key}/_runs/${dest}`;
        }
        return entry;
      });
    }

    manifest[flow.key] = {
      label: flow.label,
      passed: flow.passed,
      video,
      screenshots,
      native: Object.keys(native).length > 0 ? native : null,
      stepsData: flow.stepsData || [],
      runs: runsOut,
    };
  }

  fs.writeFileSync(
    path.join(outDir, "manifest.js"),
    `window.LIVE_RELOAD = ${liveReloadEnabled};\nwindow.MANIFEST = ${JSON.stringify(manifest, null, 2)};\n`
  );
  fs.copyFileSync(path.join(templatesDir, "app.css"), path.join(outDir, "app.css"));
  fs.copyFileSync(path.join(templatesDir, "app.js"), path.join(outDir, "app.js"));
  fs.copyFileSync(path.join(templatesDir, "index.html"), path.join(outDir, "index.html"));

  if (!quiet) {
    console.log(`Built ${flows.length} flow(s) → ${outDir}`);
    flows.forEach((f) => {
      const status = f.passed === true ? "PASSED" : f.passed === false ? "FAILED" : "no commands.json";
      const runsNote = f.runs && f.runs.length > 1 ? ` (${f.runs.length} runs)` : "";
      console.log(`  ${f.key}: ${status}${runsNote}`);
    });
    if (skippedForNoSteps > 0) {
      console.log(`${skippedForNoSteps} flow(s) had no commands.json — listed with an empty step tree.`);
    }
  }

  return { flowCount: flows.length };
}

build();
console.log("");

if (shouldServe) {
  startServer(outDir, port);
} else if (!shouldWatch) {
  console.log("Video seeking needs a real HTTP server (Range-request support) or S3 static hosting —");
  console.log("opening index.html directly via file:// will load fine but seeking may not work. Locally:");
  console.log(`  maestro-report-builder ${artifactsDirArg} ${path.relative(process.cwd(), outDir) || "."} --serve`);
}

if (shouldWatch) {
  // Debounced: a real test run touches dozens of files in quick succession (screenshots,
  // commands.json, recording.mp4 all landing within the same second) — rebuilding on every
  // single fs event would both waste work and risk reading a half-written file mid-copy.
  let pending = null;
  const REBUILD_DEBOUNCE_MS = 500;
  const watcher = fs.watch(artifactsDir, { recursive: true }, () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      console.log(`[watch] change detected, rebuilding…`);
      build();
      if (shouldServe) broadcastReload();
    }, REBUILD_DEBOUNCE_MS);
  });
  console.log(`[watch] watching ${artifactsDir} for changes (Ctrl+C to stop)`);
  process.on("SIGINT", () => {
    watcher.close();
    process.exit(0);
  });
}

// --- Minimal static file server with Range support (video seeking) + SSE live-reload ---
//
// Kept dependency-free (no `serve`/`http-server`/`ws` package) so `--serve` and `--watch` work
// straight out of `npx github:luigiinred/maestro-report-builder` with no separate install step.
let sseClients = [];

function broadcastReload() {
  for (const res of sseClients) {
    try {
      res.write("data: reload\n\n");
    } catch {
      // client already gone; cleaned up on its own 'close' handler below
    }
  }
}

function startServer(rootDir, listenPort) {
  const MIME_TYPES = {
    ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
    ".mp4": "video/mp4", ".log": "text/plain",
  };

  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);

    if (urlPath === "/__live-reload") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("\n");
      sseClients.push(res);
      req.on("close", () => {
        sseClients = sseClients.filter((c) => c !== res);
      });
      return;
    }

    // rootDir is rebuilt from scratch on every watch rebuild (fs.rmSync + mkdirSync in build()),
    // so this always reads whatever the most recent build wrote — no separate cache to bust.
    const filePath = path.join(rootDir, urlPath === "/" ? "/index.html" : urlPath);

    // Resolve + prefix-check guards against a request path escaping rootDir via "..".
    if (!path.resolve(filePath).startsWith(path.resolve(rootDir))) {
      res.writeHead(403).end();
      return;
    }

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404).end("Not found");
        return;
      }
      const contentType = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
      // No-store on everything: outDir is wiped and rebuilt from scratch on every --watch
      // rebuild, so a filename can (and under retries, will) refer to genuinely different bytes
      // across reloads — manifest.js after a rebuild, recording.mp4/*.png after a re-run
      // overwrites a previous attempt's artifacts with the same names. A browser that caches any
      // of those defeats live-reload at exactly the case it exists for: the reload fires, but the
      // page (or a video/screenshot on it) silently reloads the stale cached copy.
      const cacheHeaders = { "Cache-Control": "no-store" };
      const range = req.headers.range;
      if (range) {
        const [startStr, endStr] = range.replace(/^bytes=/, "").split("-");
        const start = Number(startStr);
        const end = endStr ? Number(endStr) : stat.size - 1;
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          "Content-Type": contentType,
          ...cacheHeaders,
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": stat.size,
          "Content-Type": contentType,
          "Accept-Ranges": "bytes",
          ...cacheHeaders,
        });
        fs.createReadStream(filePath).pipe(res);
      }
    });
  });

  server.listen(listenPort, () => {
    console.log(`Serving ${rootDir} at http://localhost:${listenPort} — Ctrl+C to stop.`);
    if (shouldWatch) console.log(`Live reload is on — the page refreshes itself as new data streams in.`);
  });
}
