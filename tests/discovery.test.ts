import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileSnapshotFromBrowserFile, detectChecks, detectSignals, scanLocalProjects } from "../server/src/discovery";

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
    fs.mkdirSync(path.join(app, "src"), { recursive: true });
    fs.writeFileSync(path.join(app, "README.md"), "Goal: example app.\nRun npm test.");
    fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    fs.writeFileSync(path.join(app, "node_modules", "ignored.txt"), "should be ignored");

    const candidates = scanLocalProjects(root);
    expect(candidates[0].name).toBe("Example App");
    expect(candidates[0].evidence_files).toContain("README.md");
    expect(candidates[0].files.some((file) => file.path.includes("node_modules"))).toBe(false);
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
