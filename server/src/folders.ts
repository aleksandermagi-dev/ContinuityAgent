import fs from "node:fs";
import path from "node:path";
import type { FolderSnapshot, FolderSnapshotFile } from "../../shared/types";
import { id, now } from "./db";

export const textExtensions = new Set([
  ".md",
  ".txt",
  ".json",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".css",
  ".html",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".cs",
  ".yaml",
  ".yml",
  ".toml",
  ".sql"
]);

export const ignoredDirs = new Set(["node_modules", ".git", "dist", "build", ".next", ".vite", "coverage", ".cache", ".venv", "venv", "target", "data"]);
export const maxFiles = 80;
export const maxExcerpt = 1600;

export interface BrowserFolderFileInput {
  path: string;
  size: number;
  text?: string;
}

export function createSnapshotFromBrowserSelection(projectId: string, folderName: string, files: BrowserFolderFileInput[]): FolderSnapshot {
  const normalized = files.slice(0, maxFiles).map((file) => ({
    path: file.path,
    size: file.size,
    kind: isTextPath(file.path) ? "text" as const : "binary" as const,
    excerpt: isTextPath(file.path) ? (file.text ?? "").slice(0, maxExcerpt) : undefined
  }));
  return buildSnapshot(projectId, folderName || "Browser selected folder", "browser-selection", normalized, files.length);
}

export function createSnapshotFromFiles(
  projectId: string,
  folderPath: string,
  source: FolderSnapshot["source"],
  files: FolderSnapshotFile[],
  actualCount = files.length
): FolderSnapshot {
  return buildSnapshot(projectId, folderPath, source, files.slice(0, maxFiles), actualCount);
}

export function createSnapshotFromLocalPath(projectId: string, folderPath: string): FolderSnapshot {
  const root = path.resolve(folderPath);
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) throw new Error("Folder path must point to a directory.");
  const files: FolderSnapshotFile[] = [];
  walk(root, root, files);
  return buildSnapshot(projectId, root, "local-path", files, files.length);
}

export function snapshotToUpdateNote(snapshot: FolderSnapshot) {
  const fileLines = snapshot.files
    .filter((file) => file.kind === "text")
    .slice(0, 18)
    .map((file) => [`File: ${file.path}`, file.excerpt ? file.excerpt.trim() : "(empty or unreadable)", ""].join("\n"))
    .join("\n");
  return [
    `Folder snapshot from ${snapshot.folder_path}`,
    `Source: ${snapshot.source}`,
    `Files visible: ${snapshot.file_count}`,
    `Tracked extensions: ${snapshot.tracked_extensions.join(", ") || "none"}`,
    "",
    snapshot.summary,
    "",
    fileLines
  ].join("\n").trim();
}

function walk(root: string, dir: string, files: FolderSnapshotFile[]) {
  if (files.length >= maxFiles) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    files.push({ path: path.relative(root, dir).replace(/\\/g, "/") || ".", size: 0, kind: "skipped" });
    return;
  }
  for (const entry of entries) {
    if (files.length >= maxFiles) return;
    const fullPath = path.join(dir, entry.name);
    const relative = path.relative(root, fullPath).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) walk(root, fullPath, files);
      continue;
    }
    if (!entry.isFile()) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      files.push({ path: relative, size: 0, kind: "skipped" });
      continue;
    }
    if (!isTextPath(entry.name)) {
      files.push({ path: relative, size: stat.size, kind: "binary" });
      continue;
    }
    files.push({
      path: relative,
      size: stat.size,
      kind: "text",
      excerpt: safeReadText(fullPath)
    });
  }
}

function buildSnapshot(projectId: string, folderPath: string, source: FolderSnapshot["source"], files: FolderSnapshotFile[], actualCount: number): FolderSnapshot {
  const trackedExtensions = Array.from(new Set(files.map((file) => path.extname(file.path).toLowerCase()).filter(Boolean))).sort();
  const textCount = files.filter((file) => file.kind === "text").length;
  return {
    id: id(),
    project_id: projectId,
    folder_path: folderPath,
    source,
    file_count: actualCount,
    tracked_extensions: trackedExtensions,
    summary: `Indexed ${files.length} file(s), including ${textCount} text file(s), for project continuity review.`,
    files,
    timestamp: now()
  };
}

function isTextPath(filePath: string) {
  return textExtensions.has(path.extname(filePath).toLowerCase());
}

function safeReadText(filePath: string) {
  try {
    return fs.readFileSync(filePath, "utf8").slice(0, maxExcerpt);
  } catch {
    return undefined;
  }
}
