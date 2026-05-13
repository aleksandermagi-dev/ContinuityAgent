import fs from "node:fs";
import path from "node:path";
import type { FileSnapshot, FolderSnapshotFile, ProjectCandidate, ProjectCheck, ProjectSignal } from "../../shared/types";
import { id } from "./db";
import { ignoredDirs, maxExcerpt, maxFiles, textExtensions, type BrowserFolderFileInput } from "./folders";

type CheckDraft = Omit<ProjectCheck, "id" | "project_id" | "last_seen">;
type SignalDraft = Omit<ProjectSignal, "id" | "project_id" | "timestamp">;

const evidenceNames = new Set([
  "readme.md",
  "readme.txt",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "cargo.toml",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts"
]);

const docHints = ["docs/", "doc/", "architecture", "concept", "continuity", "why", "decision", "adr"];

export function createFileSnapshotFromBrowserFile(input: { fileName: string; path?: string; size: number; text?: string }): FileSnapshot {
  const filePath = normalizePath(input.path || input.fileName);
  const parts = filePath.split("/");
  const fileName = parts.at(-1) || input.fileName;
  const parent = parts.length > 1 ? parts.at(-2) || stem(fileName) : stem(fileName);
  const kind = isTextFile(fileName) ? "text" : "binary";
  return {
    file_name: fileName,
    file_path: filePath,
    parent_folder_name: parent,
    size: input.size,
    kind,
    excerpt: kind === "text" ? (input.text ?? "").slice(0, maxExcerpt) : undefined
  };
}

export function createFileSnapshotFromLocalPath(filePath: string): FileSnapshot {
  const resolved = path.resolve(filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error("File path must point to a file.");
  const fileName = path.basename(resolved);
  const kind = isTextFile(fileName) ? "text" : "binary";
  return {
    file_name: fileName,
    file_path: resolved,
    parent_folder_name: path.basename(path.dirname(resolved)) || stem(fileName),
    size: stat.size,
    kind,
    excerpt: kind === "text" ? safeRead(resolved) : undefined
  };
}

export function fileSnapshotToProjectFiles(snapshot: FileSnapshot): FolderSnapshotFile[] {
  return [{
    path: snapshot.file_name,
    size: snapshot.size,
    kind: snapshot.kind,
    excerpt: snapshot.excerpt
  }];
}

export function summarizeFileSnapshot(snapshot: FileSnapshot) {
  const basis = snapshot.excerpt?.trim() || `${snapshot.file_name} is tracked as a ${snapshot.kind} project file.`;
  return compactSummary(basis);
}

export function scanLocalProjects(rootPath: string): ProjectCandidate[] {
  const root = path.resolve(rootPath);
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) throw new Error("Scan path must point to a directory.");
  const candidates: ProjectCandidate[] = [];
  const roots = [
    ...(hasDirectEvidence(root) ? [root] : []),
    ...safeDirents(root).filter((entry) => entry.isDirectory() && !ignoredDirs.has(entry.name)).map((entry) => path.join(root, entry.name))
  ];
  for (const candidateRoot of roots) {
    const candidate = candidateFromLocalPath(candidateRoot);
    if (candidate) candidates.push(candidate);
    if (candidates.length >= 40) break;
  }
  return dedupeCandidates(candidates).sort((a, b) => b.confidence - a.confidence);
}

export function scanBrowserProjects(folderName: string, files: BrowserFolderFileInput[]): ProjectCandidate[] {
  const groups = new Map<string, BrowserFolderFileInput[]>();
  for (const file of files.slice(0, 600)) {
    const normalized = normalizePath(file.path);
    const root = normalized.includes("/") ? normalized.split("/")[0] : folderName || "Selected folder";
    const relative = normalized.includes("/") ? normalized.split("/").slice(1).join("/") : normalized;
    const list = groups.get(root) ?? [];
    list.push({ ...file, path: relative || normalized });
    groups.set(root, list);
  }
  return Array.from(groups.entries())
    .map(([name, group]) => candidateFromFiles(name, name, "browser-selection", group))
    .filter((candidate): candidate is ProjectCandidate => Boolean(candidate))
    .sort((a, b) => b.confidence - a.confidence);
}

export function candidateFromFiles(name: string, candidatePath: string, source: ProjectCandidate["source"], files: BrowserFolderFileInput[]): ProjectCandidate | undefined {
  const capped = files.slice(0, maxFiles);
  const normalized: FolderSnapshotFile[] = capped.map((file) => {
    const filePath = normalizePath(file.path);
    const kind = isTextFile(filePath) ? "text" as const : "binary" as const;
    return { path: filePath, size: file.size, kind, excerpt: kind === "text" ? (file.text ?? "").slice(0, maxExcerpt) : undefined };
  });
  const evidence = evidenceFromFiles(normalized);
  if (!evidence.length && normalized.length < 2) return undefined;
  const readme = findReadme(normalized);
  const checks = detectChecks(normalized);
  const signals = detectSignals(normalized, checks);
  return {
    id: id(),
    name,
    path: candidatePath,
    evidence_files: evidence,
    readme_preview: compactSummary(readme?.excerpt || normalized.find((file) => file.excerpt)?.excerpt || ""),
    detected_stack: detectStack(normalized),
    detected_checks: checks,
    signals,
    confidence: confidenceFor(evidence, checks, signals),
    files: normalized,
    source
  };
}

function candidateFromLocalPath(candidateRoot: string): ProjectCandidate | undefined {
  const files = collectLocalFiles(candidateRoot);
  if (!files.length) return undefined;
  return candidateFromFiles(path.basename(candidateRoot), candidateRoot, "local-path", files.map((file) => ({
    path: file.path,
    size: file.size,
    text: file.excerpt
  })));
}

function hasDirectEvidence(root: string) {
  return safeDirents(root).some((entry) => entry.isFile() && evidenceNames.has(entry.name.toLowerCase()));
}

function collectLocalFiles(root: string): FolderSnapshotFile[] {
  const files: FolderSnapshotFile[] = [];
  function walk(dir: string, depth: number) {
    if (files.length >= maxFiles || depth > 3) return;
    for (const entry of safeDirents(dir)) {
      if (files.length >= maxFiles) return;
      const fullPath = path.join(dir, entry.name);
      const relative = normalizePath(path.relative(root, fullPath));
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = safeStat(fullPath);
      if (!stat) {
        files.push({ path: relative, size: 0, kind: "skipped" });
        continue;
      }
      const kind = isTextFile(relative) ? "text" : "binary";
      files.push({ path: relative, size: stat.size, kind, excerpt: kind === "text" ? safeRead(fullPath) : undefined });
    }
  }
  walk(root, 0);
  return files;
}

export function detectChecks(files: FolderSnapshotFile[]): CheckDraft[] {
  const checks: CheckDraft[] = [];
  const packageFile = files.find((file) => file.path.toLowerCase().endsWith("package.json") && file.excerpt);
  if (packageFile?.excerpt) {
    try {
      const parsed = JSON.parse(packageFile.excerpt);
      const scripts = parsed.scripts ?? {};
      for (const [name, command] of Object.entries<string>(scripts)) {
        checks.push({
          command: `npm run ${name}`,
          check_type: typeFromCommand(`${name} ${command}`),
          source: packageFile.path,
          confidence: /test|build|lint|typecheck|check|validate|health|sweep/i.test(name) ? 0.95 : 0.65
        });
      }
    } catch {
      checks.push(...commandLines(packageFile.excerpt, packageFile.path));
    }
  }
  if (files.some((file) => file.path.toLowerCase().endsWith("pyproject.toml"))) {
    checks.push({ command: "pytest", check_type: "test", source: "pyproject.toml", confidence: 0.8 });
  }
  if (files.some((file) => file.path.toLowerCase().endsWith("requirements.txt"))) {
    checks.push({ command: "pytest", check_type: "test", source: "requirements.txt", confidence: 0.6 });
  }
  for (const file of files.filter((item) => /readme|\.md$|\.txt$/i.test(item.path) && item.excerpt)) {
    checks.push(...commandLines(file.excerpt ?? "", file.path));
  }
  return dedupeChecks(checks).slice(0, 16);
}

export function detectSignals(files: FolderSnapshotFile[], checks = detectChecks(files)): SignalDraft[] {
  const signals: SignalDraft[] = [];
  const lowerPaths = files.map((file) => file.path.toLowerCase());
  const docs = lowerPaths.filter((file) => /readme|docs?\//.test(file));
  if (docs.length) {
    signals.push({ signal_type: "documentation", label: "Project docs present", description: `Found documentation: ${docs.slice(0, 4).join(", ")}`, severity: 1, source: docs[0] });
  } else {
    signals.push({ signal_type: "stability-risk", label: "Missing obvious docs", description: "No README or docs folder was found during the scan.", severity: 3, source: "project scan" });
  }
  const entry = lowerPaths.find((file) => /(^|\/)(src\/main|src\/index|main\.py|app\.py|server\/src\/index|client\/src\/main)/.test(file));
  if (entry) signals.push({ signal_type: "entrypoint", label: "Entrypoint detected", description: `Likely source entrypoint: ${entry}`, severity: 1, source: entry });
  const textPaths = files.filter((file) => file.kind === "text").map((file) => file.path.toLowerCase());
  const why = textPaths.find((file) => docHints.some((hint) => file.includes(hint)));
  if (why) signals.push({ signal_type: "why-layer", label: "Why-layer candidate", description: `Found a possible rationale or architecture note: ${why}`, severity: 1, source: why });
  if (!checks.some((check) => ["test", "validation"].includes(check.check_type))) {
    signals.push({ signal_type: "stability-risk", label: "No validation check detected", description: "No test, validation, health, or sweep command was detected.", severity: 3, source: "project scan" });
  }
  const stacks = detectStack(files);
  for (const stack of stacks) {
    signals.push({ signal_type: "stack", label: stack, description: `${stack} project signal detected.`, severity: 1, source: "project scan" });
  }
  return signals.slice(0, 14);
}

function commandLines(text: string, source: string): CheckDraft[] {
  const matches = text.match(/(?:npm (?:run [\w:-]+|test|build)|pnpm [\w:-]+|yarn [\w:-]+|pytest(?: [\w.\\/-]+)?|python -m pytest|vitest(?: run)?|tsc(?: -p [\w.\\/-]+)?|cargo test|go test \.\/\.\.\.|system_sweep|validate|health check)/gi) ?? [];
  return matches.map((command) => ({
    command: command.trim(),
    check_type: typeFromCommand(command),
    source,
    confidence: /system_sweep|validate|health|test|pytest|vitest/i.test(command) ? 0.9 : 0.65
  }));
}

function typeFromCommand(command: string): CheckDraft["check_type"] {
  if (/system_sweep|validate|validation|health|check/i.test(command)) return "validation";
  if (/test|pytest|vitest/i.test(command)) return "test";
  if (/build/i.test(command)) return "build";
  if (/lint/i.test(command)) return "lint";
  if (/typecheck|tsc/i.test(command)) return "typecheck";
  if (/run|start|dev/i.test(command)) return "run";
  return "unknown";
}

function evidenceFromFiles(files: FolderSnapshotFile[]) {
  return files.map((file) => file.path).filter((file) => {
    const lower = file.toLowerCase();
    return evidenceNames.has(path.basename(lower)) || lower.startsWith("docs/") || lower.startsWith("src/");
  }).slice(0, 12);
}

function findReadme(files: FolderSnapshotFile[]) {
  return files.find((file) => /(^|\/)readme\.(md|txt)$/i.test(file.path) && file.excerpt);
}

function detectStack(files: FolderSnapshotFile[]) {
  const paths = files.map((file) => file.path.toLowerCase());
  const stacks = new Set<string>();
  if (paths.some((file) => file.endsWith("package.json"))) stacks.add("Node/TypeScript");
  if (paths.some((file) => file.endsWith("pyproject.toml") || file.endsWith("requirements.txt"))) stacks.add("Python");
  if (paths.some((file) => file.endsWith("cargo.toml"))) stacks.add("Rust");
  if (paths.some((file) => file.endsWith("vite.config.ts"))) stacks.add("Vite");
  if (paths.some((file) => file.includes("react") || file.endsWith(".tsx"))) stacks.add("React");
  return Array.from(stacks);
}

function confidenceFor(evidence: string[], checks: CheckDraft[], signals: SignalDraft[]) {
  return Math.min(0.98, 0.25 + evidence.length * 0.08 + checks.length * 0.08 + signals.filter((signal) => signal.signal_type !== "stability-risk").length * 0.05);
}

function dedupeChecks(checks: CheckDraft[]) {
  const seen = new Set<string>();
  return checks.filter((check) => {
    const key = `${check.command}|${check.check_type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeCandidates(candidates: ProjectCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.path)) return false;
    seen.add(candidate.path);
    return candidate.confidence >= 0.32;
  });
}

function compactSummary(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 520 ? `${compact.slice(0, 517)}...` : compact;
}

function safeDirents(dir: string) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeStat(filePath: string) {
  try {
    return fs.statSync(filePath);
  } catch {
    return undefined;
  }
}

function safeRead(filePath: string) {
  try {
    return fs.readFileSync(filePath, "utf8").slice(0, maxExcerpt);
  } catch {
    return undefined;
  }
}

function isTextFile(filePath: string) {
  return textExtensions.has(path.extname(filePath).toLowerCase());
}

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, "/");
}

function stem(fileName: string) {
  return path.basename(fileName, path.extname(fileName)) || "Imported Project";
}
