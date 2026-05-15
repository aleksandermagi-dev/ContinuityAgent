const DEFAULT_API_URL = "http://127.0.0.1:8787";

export function apiBase() {
  return (process.env.CONTINUITY_API_URL ?? process.env.PCA_API_URL ?? DEFAULT_API_URL).replace(/\/$/, "");
}

export async function api(path, options = {}) {
  const response = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text();
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload ? payload.error : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return payload;
}

export async function listProjects() {
  return api("/api/projects");
}

export async function resolveProject(projectRef) {
  if (!projectRef) throw new Error("Project id or name is required.");
  const projects = await listProjects();
  const exact = projects.find((project) => project.id === projectRef || project.name.toLowerCase() === projectRef.toLowerCase());
  if (exact) return exact;
  const partial = projects.filter((project) => project.name.toLowerCase().includes(projectRef.toLowerCase()));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new Error(`Project reference "${projectRef}" matched multiple projects: ${partial.map((project) => project.name).join(", ")}`);
  throw new Error(`Project not found: ${projectRef}`);
}

export async function getContextPacket(projectRef, budget = "medium") {
  const project = await resolveProject(projectRef);
  return api(`/api/projects/${encodeURIComponent(project.id)}/context-packet?budget=${encodeURIComponent(budget)}`);
}

export async function getRecentChanges(projectRef) {
  const project = await resolveProject(projectRef);
  return api(`/api/projects/${encodeURIComponent(project.id)}/recent-changes`);
}

export async function getRelevantDecisions(projectRef, topic = "") {
  const project = await resolveProject(projectRef);
  return api(`/api/projects/${encodeURIComponent(project.id)}/decisions/relevant?topic=${encodeURIComponent(topic)}`);
}

export async function getDetectedChecks(projectRef) {
  const project = await resolveProject(projectRef);
  return api(`/api/projects/${encodeURIComponent(project.id)}/checks`);
}

export async function getHealthReport(projectRef) {
  const project = await resolveProject(projectRef);
  return api(`/api/projects/${encodeURIComponent(project.id)}/health`);
}

export async function recordProjectUpdate(projectRef, note, source = "agent") {
  if (!note?.trim()) throw new Error("Update note is required.");
  const project = await resolveProject(projectRef);
  return api(`/api/projects/${encodeURIComponent(project.id)}/agent-updates`, {
    method: "POST",
    body: JSON.stringify({ note, source })
  });
}

export function compactJson(value) {
  return JSON.stringify(value, null, 2);
}
