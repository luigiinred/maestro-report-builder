const fs = require("fs");
const path = require("path");

function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
}

// viewLoginFlow -> View Login Flow
// This is a fallback display name derived from the folder name, not the flow YAML's own
// `name:` field — that string isn't captured anywhere in commands.json, so there's nothing on
// disk to read it from without also parsing the .yml source (out of scope: this tool only
// reads maestro/.artifacts/, not the flows directory).
function humanize(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

// A flow can be run more than once, each run getting its own _maestro-native/<timestamp>/
// directory. Timestamps are formatted YYYY-MM-DD_HHMMSS, which sorts correctly as plain
// strings, so the lexicographically last one is the most recent run.
function findLatestTimestampDir(nativeDir) {
  const dirs = listDirs(nativeDir).filter((d) => d !== "debug" && d !== "screenshots");
  if (dirs.length === 0) return null;
  dirs.sort();
  return dirs[dirs.length - 1];
}

function findDebugLog(nativeDir) {
  const debugTestsDir = path.join(nativeDir, "debug", ".maestro", "tests");
  const dirs = listDirs(debugTestsDir).sort();
  if (dirs.length === 0) return null;
  const logPath = path.join(debugTestsDir, dirs[dirs.length - 1], "maestro.log");
  return fs.existsSync(logPath) ? logPath : null;
}

function scanFlow(flowDir, flowKey) {
  const videoPath = path.join(flowDir, "recording.mp4");
  const screenshots = listFiles(flowDir)
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .map((name) => ({ name: path.basename(name, path.extname(name)), file: path.join(flowDir, name) }));
  const reportHtmlPath = path.join(flowDir, "report.html");
  const nativeDir = path.join(flowDir, "_maestro-native");
  const latestTsDir = findLatestTimestampDir(nativeDir);

  let commandsJsonFile = null;
  let failureScreenshotFile = null;
  let stepsData = null;
  let passed = null;

  if (latestTsDir) {
    const tsDirPath = path.join(nativeDir, latestTsDir);
    const files = listFiles(tsDirPath);
    const commandsFile = files.find((f) => f.startsWith("commands-") && f.endsWith(".json"));
    if (commandsFile) {
      commandsJsonFile = path.join(tsDirPath, commandsFile);
      stepsData = JSON.parse(fs.readFileSync(commandsJsonFile, "utf8"));
      passed = !stepsData.some((d) => d.metadata && d.metadata.status === "FAILED");
    }
    const failFile = files.find((f) => f.startsWith("screenshot-") && f.toLowerCase().endsWith(".png"));
    if (failFile) failureScreenshotFile = path.join(tsDirPath, failFile);
  }

  return {
    key: flowKey,
    label: humanize(flowKey),
    passed,
    videoFile: fs.existsSync(videoPath) ? videoPath : null,
    screenshots,
    reportHtmlFile: fs.existsSync(reportHtmlPath) ? reportHtmlPath : null,
    commandsJsonFile,
    debugLogFile: findDebugLog(nativeDir),
    failureScreenshotFile,
    stepsData,
  };
}

// Each direct subdirectory of the artifacts root is treated as one flow — matching the
// maestro/.artifacts/<flowName>/ shape the SAVE_ARTIFACTS pattern writes.
function scanArtifactsRoot(rootDir) {
  return listDirs(rootDir).map((flowKey) => scanFlow(path.join(rootDir, flowKey), flowKey));
}

module.exports = { scanArtifactsRoot };
