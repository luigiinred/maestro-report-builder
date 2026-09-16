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

// A flow can be run more than once (a retry, or several manual re-runs), each getting its own
// _maestro-native/<timestamp>/ directory. Timestamps are formatted YYYY-MM-DD_HHMMSS, which
// sorts correctly as plain strings.
function findTimestampDirs(nativeDir) {
  const dirs = listDirs(nativeDir).filter((d) => d !== "debug" && d !== "screenshots");
  dirs.sort();
  return dirs;
}

// The debug log directory (_maestro-native/debug/.maestro/tests/<timestamp>/) is keyed by its
// own timestamp, written by a separate --debug-output invocation than the one that produced a
// given _maestro-native/<timestamp>/ commands.json dir. There's no guaranteed 1:1 correspondence
// between the two timestamp sets, so debug logs are matched to a run by closest-preceding
// timestamp (the debug log for a run is written moments before/around the same invocation),
// falling back to the single most recent log if a run's own timestamp sorts before every log.
function findDebugLogDirs(nativeDir) {
  const debugTestsDir = path.join(nativeDir, "debug", ".maestro", "tests");
  return listDirs(debugTestsDir).sort();
}

function debugLogForRunTimestamp(nativeDir, runTimestamp, debugLogDirs) {
  if (debugLogDirs.length === 0) return null;
  const candidates = debugLogDirs.filter((d) => d <= runTimestamp);
  const chosen = candidates.length > 0 ? candidates[candidates.length - 1] : debugLogDirs[debugLogDirs.length - 1];
  const logPath = path.join(nativeDir, "debug", ".maestro", "tests", chosen, "maestro.log");
  return fs.existsSync(logPath) ? logPath : null;
}

// One run's worth of native-reporting data (one _maestro-native/<timestamp>/ directory).
function scanRun(nativeDir, timestamp, debugLogDirs) {
  const tsDirPath = path.join(nativeDir, timestamp);
  const files = listFiles(tsDirPath);

  let commandsJsonFile = null;
  let stepsData = null;
  let passed = null;
  const commandsFile = files.find((f) => f.startsWith("commands-") && f.endsWith(".json"));
  if (commandsFile) {
    commandsJsonFile = path.join(tsDirPath, commandsFile);
    stepsData = JSON.parse(fs.readFileSync(commandsJsonFile, "utf8"));
    passed = !stepsData.some((d) => d.metadata && d.metadata.status === "FAILED");
  }

  let failureScreenshotFile = null;
  const failFile = files.find((f) => f.startsWith("screenshot-") && f.toLowerCase().endsWith(".png"));
  if (failFile) failureScreenshotFile = path.join(tsDirPath, failFile);

  return {
    timestamp,
    passed,
    stepsData,
    commandsJsonFile,
    failureScreenshotFile,
    debugLogFile: debugLogForRunTimestamp(nativeDir, timestamp, debugLogDirs),
  };
}

function scanFlow(flowDir, flowKey) {
  const videoPath = path.join(flowDir, "recording.mp4");
  const screenshots = listFiles(flowDir)
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .map((name) => ({ name: path.basename(name, path.extname(name)), file: path.join(flowDir, name) }));
  const reportHtmlPath = path.join(flowDir, "report.html");
  const nativeDir = path.join(flowDir, "_maestro-native");

  const debugLogDirs = findDebugLogDirs(nativeDir);
  const runs = findTimestampDirs(nativeDir).map((ts) => scanRun(nativeDir, ts, debugLogDirs));
  // Most-recent-first isn't right either: retry order matters ("run 1, run 2, ... until it
  // passes"), so keep chronological (ascending) order — the UI numbers them 1..N in this order.
  const latestRun = runs.length > 0 ? runs[runs.length - 1] : null;

  return {
    key: flowKey,
    label: humanize(flowKey.split("/").pop()),
    // Overall pass/fail reflects the most recent attempt, matching retry semantics (a flow
    // that failed once then passed on retry should read as passing overall).
    passed: latestRun ? latestRun.passed : null,
    videoFile: fs.existsSync(videoPath) ? videoPath : null,
    screenshots,
    reportHtmlFile: fs.existsSync(reportHtmlPath) ? reportHtmlPath : null,
    commandsJsonFile: latestRun ? latestRun.commandsJsonFile : null,
    debugLogFile: latestRun ? latestRun.debugLogFile : null,
    failureScreenshotFile: latestRun ? latestRun.failureScreenshotFile : null,
    stepsData: latestRun ? latestRun.stepsData : null,
    runs,
  };
}

// A directory "is" a flow (a leaf) once it has any of the files SAVE_ARTIFACTS/native-reporting
// actually writes into it — otherwise it's just a grouping folder the user organized flows
// under (e.g. `.artifacts/retirement/viewDashboard`), and discovery recurses into it instead.
function looksLikeFlowDir(dir) {
  if (fs.existsSync(path.join(dir, "recording.mp4"))) return true;
  if (fs.existsSync(path.join(dir, "report.html"))) return true;
  if (fs.existsSync(path.join(dir, "_maestro-native"))) return true;
  return listFiles(dir).some((name) => name.toLowerCase().endsWith(".png"));
}

// Depth-first so a flow nested arbitrarily deep under grouping folders is still found; flowKey
// is the "/"-joined path from the artifacts root, which doubles as both the manifest key and
// the folder path the left nav's tree is built from (see renderFlowNav in app.js).
function findFlowDirs(dir, flowKey) {
  if (looksLikeFlowDir(dir)) return [{ dir, flowKey }];
  return listDirs(dir).flatMap((name) =>
    findFlowDirs(path.join(dir, name), flowKey ? `${flowKey}/${name}` : name)
  );
}

function scanArtifactsRoot(rootDir) {
  return findFlowDirs(rootDir, "").map(({ dir, flowKey }) => scanFlow(dir, flowKey));
}

module.exports = { scanArtifactsRoot };
