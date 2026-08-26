#!/usr/bin/env node
// No AI in this path — pure filesystem scan + string templating. See src/scan.js for the
// discovery logic and src/templates/ for the static app shell it feeds.
const fs = require("fs");
const path = require("path");
const { scanArtifactsRoot } = require("../src/scan");

const [, , artifactsDirArg, outDirArg] = process.argv;

if (!artifactsDirArg) {
  console.error("Usage: node bin/build.js <path-to-maestro-.artifacts-dir> [outputDir]");
  console.error("Example: node bin/build.js ~/Developer/your-app/maestro/.artifacts ./dist");
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
console.log("Video seeking needs a real HTTP server (Range-request support) or S3 static hosting —");
console.log("opening index.html directly via file:// will load fine but seeking may not work. Locally:");
console.log(`  npx --yes serve -l 8765 ${path.relative(process.cwd(), outDir) || "."}`);
