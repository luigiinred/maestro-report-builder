#!/usr/bin/env node
// No AI in this path — pure filesystem scan + string templating. See src/scan.js for the
// discovery logic and src/templates/ for the static app shell it feeds.
const fs = require("fs");
const path = require("path");
const http = require("http");
const { scanArtifactsRoot } = require("../src/scan");

// --serve/--port are pulled out of argv before the two positional args are read, so they can
// go anywhere on the command line (`maestro-report-builder .artifacts --serve` and
// `maestro-report-builder --serve .artifacts` both work).
const args = process.argv.slice(2);
const serveFlagIndex = args.indexOf("--serve");
const shouldServe = serveFlagIndex !== -1;
if (shouldServe) args.splice(serveFlagIndex, 1);
let port = 8765;
const portFlagIndex = args.indexOf("--port");
if (portFlagIndex !== -1) {
  port = Number(args[portFlagIndex + 1]);
  args.splice(portFlagIndex, 2);
}
const [artifactsDirArg, outDirArg] = args;

if (!artifactsDirArg) {
  console.error("Usage: maestro-report-builder <path-to-maestro-.artifacts-dir> [outputDir] [--serve] [--port N]");
  console.error("Example: maestro-report-builder ~/Developer/your-app/maestro/.artifacts ./dist --serve");
  process.exit(1);
}

const artifactsDir = path.resolve(artifactsDirArg);
const outDir = path.resolve(outDirArg || "./dist");
const templatesDir = path.join(__dirname, "..", "src", "templates");

if (!fs.existsSync(artifactsDir) || !fs.statSync(artifactsDir).isDirectory()) {
  console.error(`Artifacts directory not found: ${artifactsDir}`);
  process.exit(1);
}

const flows = scanArtifactsRoot(artifactsDir);
if (flows.length === 0) {
  console.error(`No flow subdirectories found in ${artifactsDir}`);
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const manifest = {};
let skippedForNoSteps = 0;

for (const flow of flows) {
  if (!flow.stepsData) {
    // No commands.json found (e.g. the run never got as far as generating native artifacts) —
    // still list the flow so it's not silently invisible, just with an empty step tree.
    skippedForNoSteps++;
  }

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
  if (flow.commandsJsonFile) {
    fs.copyFileSync(flow.commandsJsonFile, path.join(flowOutDir, "commands.json"));
    native.commandsJson = `${flow.key}/commands.json`;
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

  manifest[flow.key] = {
    label: flow.label,
    passed: flow.passed,
    video,
    screenshots,
    native: Object.keys(native).length > 0 ? native : null,
    stepsData: flow.stepsData || [],
  };
}

fs.writeFileSync(path.join(outDir, "manifest.js"), `window.MANIFEST = ${JSON.stringify(manifest, null, 2)};\n`);
fs.copyFileSync(path.join(templatesDir, "app.css"), path.join(outDir, "app.css"));
fs.copyFileSync(path.join(templatesDir, "app.js"), path.join(outDir, "app.js"));
fs.copyFileSync(path.join(templatesDir, "index.html"), path.join(outDir, "index.html"));

console.log(`Built ${flows.length} flow(s) → ${outDir}`);
flows.forEach((f) => {
  const status = f.passed === true ? "PASSED" : f.passed === false ? "FAILED" : "no commands.json";
  console.log(`  ${f.key}: ${status}`);
});
if (skippedForNoSteps > 0) {
  console.log(`${skippedForNoSteps} flow(s) had no commands.json — listed with an empty step tree.`);
}
console.log("");

if (shouldServe) {
  serveWithRangeSupport(outDir, port);
} else {
  console.log("Video seeking needs a real HTTP server (Range-request support) or S3 static hosting —");
  console.log("opening index.html directly via file:// will load fine but seeking may not work. Locally:");
  console.log(`  maestro-report-builder ${artifactsDirArg} ${path.relative(process.cwd(), outDir) || "."} --serve`);
}

// Minimal static file server with Range support (video seeking depends on it — see the README's
// "Viewing the output" section) so `--serve` doesn't need a separate serve/http-server dependency
// or a second npx round-trip.
function serveWithRangeSupport(rootDir, listenPort) {
  const MIME_TYPES = {
    ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
    ".mp4": "video/mp4", ".log": "text/plain",
  };

  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
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
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": stat.size,
          "Content-Type": contentType,
          "Accept-Ranges": "bytes",
        });
        fs.createReadStream(filePath).pipe(res);
      }
    });
  });

  server.listen(listenPort, () => {
    console.log(`Serving ${rootDir} at http://localhost:${listenPort} — Ctrl+C to stop.`);
  });
}
