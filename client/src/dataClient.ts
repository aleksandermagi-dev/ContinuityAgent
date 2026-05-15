import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

type HttpOptions = RequestInit & { body?: BodyInit | null };

export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function chooseNativeProjectFolder() {
  if (!isTauriRuntime()) return undefined;
  const selected = await open({ directory: true, multiple: false, title: "Select project folder" });
  return typeof selected === "string" ? selected : undefined;
}

function parseBody(options?: HttpOptions) {
  if (!options?.body || typeof options.body !== "string") return {};
  try {
    return JSON.parse(options.body);
  } catch {
    return {};
  }
}

function methodFor(options?: HttpOptions) {
  return (options?.method ?? "GET").toUpperCase();
}

function pathWithoutQuery(path: string) {
  return path.split("?")[0];
}

function queryValue(path: string, key: string) {
  const [, query] = path.split("?");
  if (!query) return undefined;
  return new URLSearchParams(query).get(key) ?? undefined;
}

async function tauriApi<T>(path: string, options?: HttpOptions): Promise<T> {
  const method = methodFor(options);
  const body = parseBody(options);
  const cleanPath = pathWithoutQuery(path);

  if (cleanPath === "/api/projects" && method === "GET") {
    return invoke<T>("list_projects");
  }
  if (cleanPath === "/api/projects" && method === "POST") {
    return invoke<T>("create_project", { input: body });
  }
  if (cleanPath === "/api/workflows/modules" && method === "GET") {
    return invoke<T>("list_workflow_modules");
  }
  if (cleanPath === "/api/project-discovery/scan" && method === "POST") {
    return invoke<T>("scan_local_projects", { input: body });
  }
  if (cleanPath === "/api/project-discovery/track" && method === "POST") {
    return invoke<T>("track_candidate", { input: body });
  }

  const projectMatch = cleanPath.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && method === "DELETE") {
    return invoke<T>("delete_project", { projectId: projectMatch[1] });
  }

  const overviewMatch = cleanPath.match(/^\/api\/projects\/([^/]+)\/overview$/);
  if (overviewMatch && method === "GET") {
    return invoke<T>("get_overview", { projectId: overviewMatch[1] });
  }

  const updateMatch = cleanPath.match(/^\/api\/projects\/([^/]+)\/updates$/);
  if (updateMatch && method === "POST") {
    return invoke<T>("add_project_update", { projectId: updateMatch[1], input: body });
  }

  const acceptExtractionMatch = cleanPath.match(/^\/api\/projects\/([^/]+)\/extractions\/([^/]+)\/accept$/);
  if (acceptExtractionMatch && method === "POST") {
    return invoke<T>("accept_extraction", { projectId: acceptExtractionMatch[1], runId: acceptExtractionMatch[2], input: body });
  }

  const folderSnapshotMatch = cleanPath.match(/^\/api\/projects\/([^/]+)\/folder-snapshots$/);
  if (folderSnapshotMatch && method === "POST") {
    return invoke<T>("add_folder_snapshot", { projectId: folderSnapshotMatch[1], input: body });
  }

  const healthMatch = cleanPath.match(/^\/api\/projects\/([^/]+)\/reports\/health$/);
  if (healthMatch && method === "POST") {
    return invoke<T>("generate_health_report", { projectId: healthMatch[1] });
  }

  const exportMatch = cleanPath.match(/^\/api\/projects\/([^/]+)\/export$/);
  if (exportMatch && method === "GET") {
    return invoke<T>("export_project", { projectId: exportMatch[1], format: queryValue(path, "format") ?? "json" });
  }

  const packetMatch = cleanPath.match(/^\/api\/projects\/([^/]+)\/context-packet$/);
  if (packetMatch && method === "GET") {
    return invoke<T>("get_context_packet", { projectId: packetMatch[1], budget: queryValue(path, "budget") ?? "small" });
  }

  const runWorkflowMatch = cleanPath.match(/^\/api\/projects\/([^/]+)\/workflows\/([^/]+)\/run$/);
  if (runWorkflowMatch && method === "POST") {
    return invoke<T>("run_workflow", { projectId: runWorkflowMatch[1], moduleId: runWorkflowMatch[2], input: body });
  }

  const acceptWorkflowMatch = cleanPath.match(/^\/api\/projects\/([^/]+)\/workflows\/runs\/([^/]+)\/accept$/);
  if (acceptWorkflowMatch && method === "POST") {
    return invoke<T>("accept_workflow", { projectId: acceptWorkflowMatch[1], runId: acceptWorkflowMatch[2], input: body });
  }

  const rejectWorkflowMatch = cleanPath.match(/^\/api\/projects\/([^/]+)\/workflows\/runs\/([^/]+)\/reject$/);
  if (rejectWorkflowMatch && method === "POST") {
    return invoke<T>("reject_workflow", { projectId: rejectWorkflowMatch[1], runId: rejectWorkflowMatch[2], input: body });
  }

  throw new Error(`Desktop command not implemented for ${method} ${path}`);
}

export async function api<T>(path: string, options?: HttpOptions): Promise<T> {
  if (isTauriRuntime()) return tauriApi<T>(path, options);

  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) }
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? response.statusText);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
