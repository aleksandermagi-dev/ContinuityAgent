import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileSnapshotFromBrowserFile, detectChecks, detectSignals, scanBrowserProjectDiscovery, scanLocalProjectDiscovery, scanLocalProjects } from "../server/src/discovery";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pca-discovery-"));
  tempRoots.push(root);
  return root;
}

describe("project discovery", () => {
  it("uses a parent folder name from browser relative paths", () => {
    const snapshot = createFileSnapshotFromBrowserFile({
      fileName: "README.md",
      path: "Azari/README.md",
      size: 28,
      text: "Goal: preserve continuity."
    });

    expect(snapshot.parent_folder_name).toBe("Azari");
    expect(snapshot.excerpt).toContain("preserve continuity");
  });

  it("detects package scripts and Azari-style validation commands", () => {
    const checks = detectChecks([
      { path: "package.json", size: 120, kind: "text", excerpt: JSON.stringify({ scripts: { test: "vitest run", build: "tsc -p tsconfig.json", validate: "node scripts/system_sweep.js" } }) },
      { path: "README.md", size: 40, kind: "text", excerpt: "Run system_sweep before handoff." }
    ]);

    expect(checks.map((check) => check.command)).toContain("npm run test");
    expect(checks.map((check) => check.command)).toContain("npm run validate");
    expect(checks.some((check) => check.check_type === "validation")).toBe(true);
  });

  it("detects candidate projects and skips heavy folders", () => {
    const root = tempProject();
    const app = path.join(root, "Example App");
    fs.mkdirSync(path.join(app, "node_modules"), { recursive: true });
    fs.mkdirSync(path.join(app, ".pytest_cache"), { recursive: true });
    fs.mkdirSync(path.join(app, "src"), { recursive: true });
    fs.writeFileSync(path.join(app, "README.md"), "Goal: example app.\nRun npm test.");
    fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    fs.writeFileSync(path.join(app, "node_modules", "ignored.txt"), "should be ignored");
    fs.writeFileSync(path.join(app, ".pytest_cache", "README.md"), "pytest cache should be ignored");

    const candidates = scanLocalProjects(root);
    expect(candidates[0].name).toBe("Example App");
    expect(candidates[0].evidence_files).toContain("README.md");
    expect(candidates[0].detection_reasons).toContain("README found");
    expect(candidates[0].detection_reasons).toContain("package.json scripts");
    expect(candidates[0].files.some((file) => file.path.includes("node_modules"))).toBe(false);
    expect(candidates[0].files.some((file) => file.path.includes(".pytest_cache"))).toBe(false);
  });

  it("treats a direct project path as one candidate instead of surfacing internal folders", () => {
    const root = tempProject();
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.mkdirSync(path.join(root, "tools"), { recursive: true });
    fs.mkdirSync(path.join(root, ".pytest_cache"), { recursive: true });
    fs.writeFileSync(path.join(root, "README.md"), "Goal: scan this project root.\nRun npm test.");
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    fs.writeFileSync(path.join(root, "docs", "README.md"), "Internal docs should stay inside the root candidate.");
    fs.writeFileSync(path.join(root, "tools", "README.md"), "Internal tools should stay inside the root candidate.");
    fs.writeFileSync(path.join(root, ".pytest_cache", "README.md"), "Cache should not become a candidate.");

    const candidates = scanLocalProjects(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].path).toBe(root);
    expect(candidates[0].name).toBe(path.basename(root));
  });

  it("returns scan warnings for ignored generated folders and no candidates", () => {
    const root = tempProject();
    fs.mkdirSync(path.join(root, ".pytest_cache"), { recursive: true });
    fs.mkdirSync(path.join(root, "logs"), { recursive: true });
    fs.writeFileSync(path.join(root, "notes.tmp"), "temporary output");

    const result = scanLocalProjectDiscovery(root);
    expect(result.candidates).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.code === "generated-folders-skipped")).toBe(true);
    expect(result.warnings.some((warning) => warning.code === "no-candidates")).toBe(true);
  });

  it("returns scan warnings and reason labels for browser-selected folders", () => {
    const result = scanBrowserProjectDiscovery("Selected", [
      { path: "App/README.md", size: 200, text: "Goal: browser scan.\nRun npm test and system_sweep." },
      { path: "App/package.json", size: 120, text: JSON.stringify({ scripts: { test: "vitest run", system_sweep: "node scripts/sweep.js" } }) },
      { path: ".pytest_cache/README.md", size: 20, text: "ignore me" }
    ]);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].detection_reasons).toContain("validation command");
    expect(result.warnings.some((warning) => warning.code === "generated-folders-skipped")).toBe(true);
  });

  it("detects the synthetic stability fixture and suppresses generated folders", () => {
    const root = path.resolve("fixtures", "azari-style-stability-fixture");
    const result = scanLocalProjectDiscovery(root);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].detection_reasons).toContain("why-layer docs");
    expect(result.candidates[0].detected_checks.some((check) => check.command === "npm run system_sweep")).toBe(true);
    expect(result.candidates[0].files.some((file) => file.path.includes(".pytest_cache"))).toBe(false);
    expect(result.candidates[0].readme_preview.length).toBeLessThanOrEqual(520);
    expect(result.warnings.some((warning) => warning.code === "generated-folders-skipped")).toBe(true);
  });

  it("emits stability risk signals when checks are missing", () => {
    const signals = detectSignals([{ path: "README.md", size: 20, kind: "text", excerpt: "A project without commands." }], []);
    expect(signals.some((signal) => signal.label === "No validation check detected")).toBe(true);
  });

  it("detects the synthetic Azari Continuity Trial fixture", () => {
    const root = path.resolve("fixtures", "azari-continuity-trial");
    const candidates = scanLocalProjects(root);
    const candidate = candidates.find((item) => item.name === "azari-continuity-trial");

    expect(candidate).toBeDefined();
    expect(candidate?.evidence_files).toContain("README.md");
    expect(candidate?.signals.some((signal) => signal.signal_type === "why-layer")).toBe(true);
    expect(candidate?.detected_checks.some((check) => check.command === "npm run system_sweep")).toBe(true);
    expect(candidate?.detected_checks.some((check) => check.check_type === "validation")).toBe(true);
    expect(candidate?.files.some((file) => file.path.includes("node_modules"))).toBe(false);
  });
});
