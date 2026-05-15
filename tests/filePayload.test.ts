import { describe, expect, it } from "vitest";
import { browserMaxExcerpt, prepareBrowserFolderPayload, selectedFolderName, type BrowserLikeFile } from "../client/src/filePayload";

function file(path: string, text: string, size = text.length): BrowserLikeFile {
  return {
    name: path.split("/").at(-1) ?? path,
    webkitRelativePath: path,
    size,
    async text() {
      return text;
    }
  };
}

describe("browser folder payload preparation", () => {
  it("prioritizes project evidence and caps text excerpts", async () => {
    const longText = "x".repeat(browserMaxExcerpt + 500);
    const prepared = await prepareBrowserFolderPayload([
      file("Example/src/late.ts", "export const late = true;"),
      file("Example/README.md", longText),
      file("Example/package.json", JSON.stringify({ scripts: { test: "vitest run" } }))
    ]);

    expect(prepared.files[0].path).toBe("Example/README.md");
    expect(prepared.files[0].text).toHaveLength(browserMaxExcerpt);
    expect(prepared.files[1].path).toBe("Example/package.json");
    expect(prepared.truncatedCount).toBeGreaterThan(0);
  });

  it("skips reading very large files while preserving their path and size", async () => {
    const prepared = await prepareBrowserFolderPayload([
      file("Example/README.md", "Goal: scan safely."),
      file("Example/large-notes.md", "huge", 1_000_000)
    ]);

    const large = prepared.files.find((item) => item.path === "Example/large-notes.md");
    expect(large?.text).toBeUndefined();
    expect(prepared.skippedCount).toBeGreaterThan(0);
  });

  it("uses the selected folder name from browser relative paths", () => {
    expect(selectedFolderName([file("Continuity Layer/README.md", "hello")])).toBe("Continuity Layer");
  });

  it("keeps single-file payloads capped for imports", async () => {
    const { browserFileToPayload } = await import("../client/src/filePayload");
    const payload = await browserFileToPayload(file("README.md", "a".repeat(browserMaxExcerpt + 10)));

    expect(payload.path).toBe("README.md");
    expect(payload.text).toHaveLength(browserMaxExcerpt);
  });
});
