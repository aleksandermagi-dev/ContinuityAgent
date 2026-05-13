import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ExtractionDraft, Project, ProjectCandidate, ProjectImportResult, ProjectOverview } from "../../shared/types";
import "./styles.css";

const tabs = ["Overview", "Project Health", "Timeline / History", "Decisions / Why", "Branches", "Tasks", "Drift / Contradictions", "Connected Ideas", "Reports", "Settings / Integrations"];

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) }
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? response.statusText);
  return response.json() as Promise<T>;
}

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [activeTab, setActiveTab] = useState(tabs[0]);
  const [newProject, setNewProject] = useState({ name: "Azari Tendril Reach", description: "", category: "software" });
  const [note, setNote] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [folderSelectionStatus, setFolderSelectionStatus] = useState("No folder snapshot selected yet.");
  const [scanRootPath, setScanRootPath] = useState("");
  const [scanStatus, setScanStatus] = useState("No project scan started yet.");
  const [candidates, setCandidates] = useState<ProjectCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refreshProjects(selectId?: string) {
    const items = await api<Project[]>("/api/projects");
    setProjects(items);
    const nextId = selectId ?? selectedId ?? items[0]?.id ?? "";
    if (nextId) setSelectedId(nextId);
  }

  async function refreshOverview(id = selectedId) {
    if (!id) return setOverview(null);
    setOverview(await api<ProjectOverview>(`/api/projects/${id}/overview`));
  }

  useEffect(() => {
    refreshProjects().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    refreshOverview().catch((err) => setError(err.message));
  }, [selectedId]);

  async function createProject() {
    setBusy(true);
    setError("");
    try {
      const project = await api<Project>("/api/projects", { method: "POST", body: JSON.stringify({ ...newProject, tags: ["demo"] }) });
      await refreshProjects(project.id);
      setSelectedId(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project");
    } finally {
      setBusy(false);
    }
  }

  async function submitUpdate() {
    if (!overview || !note.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/projects/${overview.project.id}/updates`, { method: "POST", body: JSON.stringify({ note, source: "manual" }) });
      setNote("");
      await refreshOverview(overview.project.id);
      await refreshProjects(overview.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process update");
    } finally {
      setBusy(false);
    }
  }

  async function acceptDraft(draft: ExtractionDraft) {
    if (!overview) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<ProjectOverview>(`/api/projects/${overview.project.id}/extractions/${draft.run_id}/accept`, { method: "POST", body: JSON.stringify({}) });
      setOverview(next);
      await refreshProjects(overview.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept draft");
    } finally {
      setBusy(false);
    }
  }

  async function generateHealth() {
    if (!overview) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/projects/${overview.project.id}/reports/health`, { method: "POST", body: JSON.stringify({}) });
      await refreshOverview(overview.project.id);
      await refreshProjects(overview.project.id);
      setActiveTab("Project Health");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate health report");
    } finally {
      setBusy(false);
    }
  }

  async function addFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    setScanStatus(`Importing ${file.name}...`);
    try {
      const isText = /\.(md|txt|json|ts|tsx|js|jsx|css|html|py|rs|go|java|cs|ya?ml|toml|sql)$/i.test(file.name);
      const result = await api<ProjectImportResult>("/api/projects/from-file", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          path: file.webkitRelativePath || file.name,
          size: file.size,
          text: isText ? await file.text() : undefined
        })
      });
      await refreshProjects(result.project.id);
      setSelectedId(result.project.id);
      setActiveTab("Project Health");
      setScanStatus(`Created ${result.project.name} from ${file.name}. Review draft created.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add file");
      setScanStatus("Add File did not complete.");
    } finally {
      setBusy(false);
    }
  }

  async function scanProjectsFromPath() {
    if (!scanRootPath.trim()) return;
    setBusy(true);
    setError("");
    setScanStatus(`Scanning ${scanRootPath.trim()} for projects...`);
    try {
      const response = await api<{ candidates: ProjectCandidate[] }>("/api/project-discovery/scan", { method: "POST", body: JSON.stringify({ rootPath: scanRootPath }) });
      setCandidates(response.candidates);
      setScanStatus(response.candidates.length ? `Found ${response.candidates.length} project candidate${response.candidates.length === 1 ? "" : "s"}.` : "No trackable projects found.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not scan for projects");
      setScanStatus("Project scan failed.");
    } finally {
      setBusy(false);
    }
  }

  async function scanProjectsFromFolder(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    const selected = Array.from(files).slice(0, 600);
    const firstPath = selected[0]?.webkitRelativePath || selected[0]?.name || "Selected folder";
    const folderName = firstPath.split("/")[0] || "Selected folder";
    setScanStatus(`Scanning ${folderName} for projects...`);
    try {
      const payloadFiles = await Promise.all(selected.map(async (file) => {
        const relativePath = file.webkitRelativePath || file.name;
        const isText = /\.(md|txt|json|ts|tsx|js|jsx|css|html|py|rs|go|java|cs|ya?ml|toml|sql)$/i.test(relativePath);
        return { path: relativePath, size: file.size, text: isText ? await file.text() : undefined };
      }));
      const response = await api<{ candidates: ProjectCandidate[] }>("/api/project-discovery/scan", { method: "POST", body: JSON.stringify({ folderName, files: payloadFiles }) });
      setCandidates(response.candidates);
      setScanStatus(response.candidates.length ? `Found ${response.candidates.length} project candidate${response.candidates.length === 1 ? "" : "s"} in ${folderName}.` : `No trackable projects found in ${folderName}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not scan selected folder");
      setScanStatus("Project scan failed.");
    } finally {
      setBusy(false);
    }
  }

  async function trackCandidate(candidate: ProjectCandidate) {
    setBusy(true);
    setError("");
    setScanStatus(`Tracking ${candidate.name}...`);
    try {
      const result = await api<ProjectImportResult>("/api/project-discovery/track", { method: "POST", body: JSON.stringify({ candidate }) });
      await refreshProjects(result.project.id);
      setSelectedId(result.project.id);
      setActiveTab("Project Health");
      setScanStatus(`Tracking ${result.project.name}. Review draft and detected checks are ready.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not track project");
      setScanStatus("Track project did not complete.");
    } finally {
      setBusy(false);
    }
  }

  async function scanLocalPath() {
    if (!overview || !folderPath.trim()) return;
    setBusy(true);
    setError("");
    setFolderSelectionStatus(`Scanning ${folderPath.trim()}...`);
    try {
      await api(`/api/projects/${overview.project.id}/folder-snapshots`, { method: "POST", body: JSON.stringify({ folderPath }) });
      await refreshOverview(overview.project.id);
      await refreshProjects(overview.project.id);
      setActiveTab("Settings / Integrations");
      setFolderSelectionStatus(`Scanned ${folderPath.trim()} and created a review draft.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not scan folder");
      setFolderSelectionStatus("Folder scan did not complete.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadBrowserFolder(files: FileList | null) {
    if (!overview || !files?.length) return;
    const selectedCount = files.length;
    const firstPath = files[0]?.webkitRelativePath || files[0]?.name || "selected folder";
    const folderName = firstPath.split("/")[0] || "Selected folder";
    setBusy(true);
    setError("");
    setFolderSelectionStatus(`Importing ${selectedCount} file${selectedCount === 1 ? "" : "s"} from ${folderName}...`);
    try {
      const selected = Array.from(files).slice(0, 80);
      const payloadFiles = await Promise.all(selected.map(async (file) => {
        const relativePath = file.webkitRelativePath || file.name;
        const isText = /\.(md|txt|json|ts|tsx|js|jsx|css|html|py|rs|go|java|cs|ya?ml|toml|sql)$/i.test(relativePath);
        return {
          path: relativePath,
          size: file.size,
          text: isText ? await file.text() : undefined
        };
      }));
      await api(`/api/projects/${overview.project.id}/folder-snapshots`, { method: "POST", body: JSON.stringify({ folderName, files: payloadFiles }) });
      await refreshOverview(overview.project.id);
      await refreshProjects(overview.project.id);
      setActiveTab("Settings / Integrations");
      setFolderSelectionStatus(`Imported ${payloadFiles.length} visible file${payloadFiles.length === 1 ? "" : "s"} from ${folderName}. Review draft created.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import selected folder");
      setFolderSelectionStatus("Folder selection did not import.");
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => overview ? {
    decisions: overview.decisions.length,
    branches: overview.branches.filter((item) => item.status !== "merged" && item.status !== "abandoned").length,
    tasks: overview.tasks.filter((item) => item.status !== "complete").length,
    drift: overview.driftWarnings.length
  } : { decisions: 0, branches: 0, tasks: 0, drift: 0 }, [overview]);

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Local-first cognition layer</p>
          <h1>Project Continuity Agent</h1>
        </div>
        <section className="createPanel">
          <input aria-label="Project name" value={newProject.name} onChange={(event) => setNewProject({ ...newProject, name: event.target.value })} />
          <textarea aria-label="Project description" placeholder="Short project description" value={newProject.description} onChange={(event) => setNewProject({ ...newProject, description: event.target.value })} />
          <button onClick={createProject} disabled={busy || !newProject.name.trim()}>Create project</button>
        </section>
        <nav className="projectList" aria-label="Projects">
          {projects.map((project) => (
            <button className={project.id === selectedId ? "selected" : ""} key={project.id} onClick={() => setSelectedId(project.id)}>
              <strong>{project.name}</strong>
              <span>{project.status} · health {project.health_score || "new"}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        {error && <div className="error">{error}</div>}
        <section className="onboardingPanel">
          <div>
            <p className="eyebrow">Project onboarding</p>
            <h3>Add file or scan for projects</h3>
            <p className="muted">Add File creates a project from a README/doc/config file. Scan for Projects finds trackable folders and detects checks before import.</p>
          </div>
          <div className="onboardingActions">
            <label className="filePicker">
              Add File
              <input
                type="file"
                accept=".md,.txt,.json,.ts,.tsx,.js,.jsx,.css,.html,.py,.rs,.go,.java,.cs,.yaml,.yml,.toml,.sql"
                onChange={(event) => {
                  addFile(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
                disabled={busy}
              />
            </label>
            <label className="filePicker secondaryPicker">
              Scan selected folder
              <input
                type="file"
                multiple
                {...{ webkitdirectory: "", directory: "" }}
                onChange={(event) => {
                  scanProjectsFromFolder(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
                disabled={busy}
              />
            </label>
            <div className="pathScan">
              <input placeholder="C:\Users\you\Projects" value={scanRootPath} onChange={(event) => setScanRootPath(event.target.value)} />
              <button onClick={scanProjectsFromPath} disabled={busy || !scanRootPath.trim()}>Scan path</button>
            </div>
          </div>
          <p className="folderStatus">{scanStatus}</p>
          {candidates.length > 0 && (
            <div className="candidateGrid">
              {candidates.map((candidate) => (
                <article key={candidate.id} className="candidateCard">
                  <div>
                    <strong>{candidate.name}</strong>
                    <span>{Math.round(candidate.confidence * 100)}% confidence</span>
                  </div>
                  <p>{candidate.readme_preview || "No README preview available."}</p>
                  <div className="draftCounts">
                    <span>{candidate.detected_stack.join(", ") || "Unknown stack"}</span>
                    <span>{candidate.detected_checks.length} checks</span>
                    <span>{candidate.evidence_files.length} evidence files</span>
                  </div>
                  <button onClick={() => trackCandidate(candidate)} disabled={busy}>Track project</button>
                </article>
              ))}
            </div>
          )}
        </section>
        {!overview ? (
          <div className="emptyState">Create a project to begin the continuity loop.</div>
        ) : (
          <>
            <header className="projectHeader">
              <div>
                <p className="eyebrow">{overview.project.category} · {overview.project.status}</p>
                <h2>{overview.project.name}</h2>
              </div>
              <div className="metricStrip">
                <Metric label="Decisions" value={counts.decisions} />
                <Metric label="Branches" value={counts.branches} />
                <Metric label="Tasks" value={counts.tasks} />
                <Metric label="Drift" value={counts.drift} />
              </div>
            </header>

            <section className="intake">
              <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Paste a project summary, update, chat log excerpt, repo note, or decision context..." />
              <div className="intakeActions">
                <span>AI extraction creates drafts. Durable state changes only after review.</span>
                <button onClick={submitUpdate} disabled={busy || !note.trim()}>Extract update</button>
              </div>
            </section>

            {overview.pendingDrafts.length > 0 && (
              <section className="draftRail">
                <h3>Drafts awaiting review</h3>
                {overview.pendingDrafts.map((draft) => <DraftCard key={draft.id} draft={draft} onAccept={() => acceptDraft(draft)} busy={busy} />)}
              </section>
            )}

            <nav className="tabs" aria-label="Project sections">
              {tabs.map((tab) => <button className={activeTab === tab ? "active" : ""} key={tab} onClick={() => setActiveTab(tab)}>{tab}</button>)}
            </nav>

            <TabContent
              tab={activeTab}
              overview={overview}
              onGenerateHealth={generateHealth}
              onScanLocalPath={scanLocalPath}
              onUploadBrowserFolder={uploadBrowserFolder}
              folderPath={folderPath}
              setFolderPath={setFolderPath}
              folderSelectionStatus={folderSelectionStatus}
              busy={busy}
            />
          </>
        )}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function DraftCard({ draft, onAccept, busy }: { draft: ExtractionDraft; onAccept: () => void; busy: boolean }) {
  const payload = draft.payload;
  return (
    <article className="draftCard">
      <div>
        <strong>Advisory extraction draft</strong>
        <span>{new Date(draft.created_at).toLocaleString()}</span>
      </div>
      <p>{payload.projectSummary || "No summary update suggested."}</p>
      <div className="draftCounts">
        <span>{payload.decisions.length} decisions</span>
        <span>{payload.tasks.length} tasks</span>
        <span>{payload.branches.length} branches</span>
        <span>{payload.driftWarnings.length} drift warnings</span>
      </div>
      <button onClick={onAccept} disabled={busy}>Accept all into project memory</button>
    </article>
  );
}

function TabContent({
  tab,
  overview,
  onGenerateHealth,
  onScanLocalPath,
  onUploadBrowserFolder,
  folderPath,
  setFolderPath,
  folderSelectionStatus,
  busy
}: {
  tab: string;
  overview: ProjectOverview;
  onGenerateHealth: () => void;
  onScanLocalPath: () => void;
  onUploadBrowserFolder: (files: FileList | null) => void;
  folderPath: string;
  setFolderPath: (value: string) => void;
  folderSelectionStatus: string;
  busy: boolean;
}) {
  if (tab === "Overview") {
    return <Panel title="Project Overview">
      <p className="summaryText">{overview.project.current_state_summary || "No accepted summary yet."}</p>
      <h4>Goals</h4>
      <List items={overview.project.goals} empty="No accepted goals yet." />
      <h4>Recent Changes</h4>
      <List items={overview.events.slice(0, 4).map((event) => event.summary)} empty="No updates yet." />
    </Panel>;
  }
  if (tab === "Project Health") {
    const report = overview.latestHealthReport;
    return <Panel title="Project Health" action={<button onClick={onGenerateHealth} disabled={busy}>Generate health report</button>}>
      {report ? (
        <>
          <div className="scoreGrid">
            <Metric label="Continuity" value={report.continuity_score} />
            <Metric label="Drift" value={report.drift_score} />
            <Metric label="Blocked" value={report.blocked_task_count} />
            <Metric label="Contradictions" value={report.contradiction_count} />
          </div>
          <p>{report.summary}</p>
          <List items={report.recommendations} empty="No recommendations." />
        </>
      ) : <p>No health report generated yet.</p>}
      <h4>Detected Checks</h4>
      <RecordList items={overview.checks.map((item) => ({ title: item.command, meta: `${item.check_type} · confidence ${Math.round(item.confidence * 100)}%`, body: `Source: ${item.source}` }))} />
      <h4>Project Signals</h4>
      <RecordList items={overview.signals.map((item) => ({ title: item.label, meta: `${item.signal_type} · severity ${item.severity}`, body: item.description }))} />
    </Panel>;
  }
  if (tab === "Timeline / History") return <Panel title="Timeline / History"><RecordList items={overview.events.map((event) => ({ title: event.summary, meta: event.timestamp, body: event.source }))} /></Panel>;
  if (tab === "Decisions / Why") return <Panel title="Decisions / Why"><RecordList items={overview.decisions.map((item) => ({ title: item.decision, meta: `confidence ${item.confidence}`, body: item.rationale }))} /></Panel>;
  if (tab === "Branches") return <Panel title="Branches"><RecordList items={overview.branches.map((item) => ({ title: item.branch_name, meta: item.status, body: item.current_summary }))} /></Panel>;
  if (tab === "Tasks") return <Panel title="Tasks"><RecordList items={overview.tasks.map((item) => ({ title: item.task, meta: `${item.status} · priority ${item.priority}`, body: item.rationale || item.blocker_reason }))} /></Panel>;
  if (tab === "Drift / Contradictions") return <Panel title="Drift / Contradictions"><RecordList items={overview.driftWarnings.map((item) => ({ title: item.drift_type, meta: `severity ${item.severity}`, body: `${item.description} ${item.suggested_review}` }))} /></Panel>;
  if (tab === "Connected Ideas") return <Panel title="Connected Ideas"><RecordList items={overview.concepts.map((item) => ({ title: item.concept_name, meta: `weight ${item.weight}`, body: item.description }))} /><p className="muted">Cross-project linking is prepared but disabled in v1 unless explicitly approved later.</p></Panel>;
  if (tab === "Reports") return <Panel title="Reports">
    <div className="exportActions">
      <a href={`/api/projects/${overview.project.id}/export?format=markdown`} target="_blank">Export Markdown</a>
      <a href={`/api/projects/${overview.project.id}/export?format=json`} target="_blank">Export JSON</a>
      <a href={`/api/projects/${overview.project.id}/context-packet?budget=small`} target="_blank">Small Packet</a>
      <a href={`/api/projects/${overview.project.id}/context-packet?budget=medium`} target="_blank">Medium Packet</a>
      <a href={`/api/projects/${overview.project.id}/context-packet?budget=large`} target="_blank">Large Packet</a>
      <a href="/api/benchmarks/azari-continuity-trial" target="_blank">Azari Trial</a>
    </div>
  </Panel>;
  return <Panel title="Settings / Integrations">
    <section className="folderConnect">
      <div>
        <h4>Local Folder</h4>
        <p className="muted">Select a folder snapshot or scan a local path. The agent creates a draft review from indexed files; accepted project memory still requires approval.</p>
      </div>
      <div className="folderControls">
        <label className="filePicker">
          Select folder snapshot
          <input
            type="file"
            multiple
            // Browser-supported folder picker attributes.
            {...{ webkitdirectory: "", directory: "" }}
            onChange={(event) => {
              onUploadBrowserFolder(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
            disabled={busy}
          />
        </label>
        <div className="pathScan">
          <input placeholder="C:\Users\you\Projects\example" value={folderPath} onChange={(event) => setFolderPath(event.target.value)} />
          <button onClick={onScanLocalPath} disabled={busy || !folderPath.trim()}>Scan path</button>
        </div>
      </div>
      <p className="folderStatus">{folderSelectionStatus}</p>
      <RecordList items={overview.folderSnapshots.map((item) => ({
        title: item.folder_path,
        meta: `${item.source} · ${item.file_count} files`,
        body: `${item.summary} Extensions: ${item.tracked_extensions.join(", ") || "none"}`
      }))} />
    </section>
    <div className="integrationGrid">
      {["GitHub", "Local folders", "Markdown notes", "Google Docs", "Discord exports", "ChatGPT exports", "Email", "Calendar", "Notion", "Trello", "Obsidian"].map((item) => <span key={item}>{item}</span>)}
    </div>
    <p className="muted">Integration extension points are reserved for later builds.</p>
  </Panel>;
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="panel"><div className="panelHeader"><h3>{title}</h3>{action}</div>{children}</section>;
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return <ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>;
}

function RecordList({ items }: { items: { title: string; meta: string; body: string }[] }) {
  if (!items.length) return <p className="muted">Nothing accepted here yet.</p>;
  return <div className="recordList">{items.map((item, index) => (
    <article key={`${item.title}-${index}`}>
      <div><strong>{item.title}</strong><span>{item.meta}</span></div>
      <p>{item.body}</p>
    </article>
  ))}</div>;
}

createRoot(document.getElementById("root")!).render(<App />);
