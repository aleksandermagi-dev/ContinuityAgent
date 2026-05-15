export const browserTextExtensions = /\.(md|txt|json|ts|tsx|js|jsx|css|html|py|rs|go|java|cs|ya?ml|toml|sql)$/i;
export const browserMaxFiles = 140;
export const browserMaxExcerpt = 1600;
export const browserMaxReadableFileSize = 250_000;

export interface BrowserLikeFile {
  name: string;
  size: number;
  webkitRelativePath?: string;
  text(): Promise<string>;
}

export interface BrowserPayloadFile {
  path: string;
  size: number;
  text?: string;
}

export interface PreparedBrowserFiles {
  files: BrowserPayloadFile[];
  selectedCount: number;
  skippedCount: number;
  truncatedCount: number;
}

export async function prepareBrowserFolderPayload(inputFiles: Iterable<BrowserLikeFile>): Promise<PreparedBrowserFiles> {
  const all = Array.from(inputFiles);
  const prioritized = all.sort((a, b) => priorityFor(relativePath(a)) - priorityFor(relativePath(b))).slice(0, browserMaxFiles);
  const files = await Promise.all(prioritized.map(async (file) => browserFileToPayload(file)));
  return {
    files,
    selectedCount: all.length,
    skippedCount: Math.max(0, all.length - prioritized.length) + files.filter((file) => file.text === undefined && browserTextExtensions.test(file.path)).length,
    truncatedCount: files.filter((file) => (file.text?.length ?? 0) >= browserMaxExcerpt).length
  };
}

export async function browserFileToPayload(file: BrowserLikeFile): Promise<BrowserPayloadFile> {
  const path = relativePath(file);
  if (!browserTextExtensions.test(path) || file.size > browserMaxReadableFileSize) {
    return { path, size: file.size };
  }
  return {
    path,
    size: file.size,
    text: (await file.text()).slice(0, browserMaxExcerpt)
  };
}

export function selectedFolderName(files: Iterable<BrowserLikeFile>) {
  const first = Array.from(files)[0];
  const firstPath = first ? relativePath(first) : "Selected folder";
  return firstPath.split("/")[0] || "Selected folder";
}

function relativePath(file: BrowserLikeFile) {
  return file.webkitRelativePath || file.name;
}

function priorityFor(filePath: string) {
  const lower = filePath.toLowerCase();
  if (/(^|\/)readme\.(md|txt)$/.test(lower)) return 0;
  if (/(^|\/)(package\.json|pyproject\.toml|requirements\.txt|cargo\.toml|tsconfig\.json)$/.test(lower)) return 1;
  if (/(^|\/)(docs?|architecture|adr|decisions?|why)/.test(lower)) return 2;
  if (/(^|\/)(src|server|client|app)\//.test(lower)) return 3;
  if (browserTextExtensions.test(lower)) return 4;
  return 5;
}
