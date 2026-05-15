use chrono::Utc;
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{collections::HashSet, fs, path::{Path, PathBuf}, sync::Mutex};
use tauri::Manager;
use uuid::Uuid;
use walkdir::WalkDir;

struct AppState {
    db: Mutex<Connection>,
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn id() -> String {
    Uuid::new_v4().to_string()
}

fn json_text(value: Value) -> String {
    serde_json::to_string(&value).unwrap_or_else(|_| "[]".to_string())
}

fn parse_json(text: String, fallback: Value) -> Value {
    serde_json::from_str(&text).unwrap_or(fallback)
}

fn app_error<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

fn migrate(db: &Connection) -> rusqlite::Result<()> {
    db.pragma_update(None, "foreign_keys", "ON")?;
    db.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT 'software',
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          goals TEXT NOT NULL DEFAULT '[]',
          current_state_summary TEXT NOT NULL DEFAULT '',
          health_score INTEGER NOT NULL DEFAULT 0,
          tags TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS project_events (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          summary TEXT NOT NULL,
          source TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          related_decision_ids TEXT NOT NULL DEFAULT '[]',
          related_task_ids TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS extraction_runs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          event_id TEXT NOT NULL REFERENCES project_events(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          provider TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS extraction_drafts (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          event_id TEXT NOT NULL REFERENCES project_events(id) ON DELETE CASCADE,
          payload TEXT NOT NULL,
          accepted_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS decision_records (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          decision TEXT NOT NULL,
          rationale TEXT NOT NULL,
          constraints TEXT NOT NULL DEFAULT '[]',
          tradeoffs TEXT NOT NULL DEFAULT '[]',
          alternatives_considered TEXT NOT NULL DEFAULT '[]',
          failed_paths TEXT NOT NULL DEFAULT '[]',
          served_goal TEXT NOT NULL DEFAULT '',
          reversal_conditions TEXT NOT NULL DEFAULT '[]',
          confidence REAL NOT NULL DEFAULT 0.6,
          source TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          provenance_event_id TEXT,
          provenance_extraction_run_id TEXT
        );
        CREATE TABLE IF NOT EXISTS concept_nodes (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          concept_name TEXT NOT NULL,
          description TEXT NOT NULL,
          weight REAL NOT NULL DEFAULT 0.5,
          related_concepts TEXT NOT NULL DEFAULT '[]',
          first_seen TEXT NOT NULL,
          last_seen TEXT NOT NULL,
          provenance_event_id TEXT,
          provenance_extraction_run_id TEXT
        );
        CREATE TABLE IF NOT EXISTS branch_records (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          branch_name TEXT NOT NULL,
          description TEXT NOT NULL,
          status TEXT NOT NULL,
          reason_created TEXT NOT NULL,
          current_summary TEXT NOT NULL,
          linked_decisions TEXT NOT NULL DEFAULT '[]',
          timestamp TEXT NOT NULL,
          provenance_event_id TEXT,
          provenance_extraction_run_id TEXT
        );
        CREATE TABLE IF NOT EXISTS task_records (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          task TEXT NOT NULL,
          status TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 3,
          rationale TEXT NOT NULL DEFAULT '',
          linked_decision TEXT NOT NULL DEFAULT '',
          blocker_reason TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          provenance_event_id TEXT,
          provenance_extraction_run_id TEXT
        );
        CREATE TABLE IF NOT EXISTS drift_warnings (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          drift_type TEXT NOT NULL,
          description TEXT NOT NULL,
          severity INTEGER NOT NULL DEFAULT 2,
          evidence TEXT NOT NULL DEFAULT '[]',
          suggested_review TEXT NOT NULL DEFAULT '',
          timestamp TEXT NOT NULL,
          provenance_event_id TEXT,
          provenance_extraction_run_id TEXT
        );
        CREATE TABLE IF NOT EXISTS project_health_reports (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          continuity_score INTEGER NOT NULL,
          drift_score INTEGER NOT NULL,
          unresolved_branch_count INTEGER NOT NULL,
          stale_assumption_count INTEGER NOT NULL,
          blocked_task_count INTEGER NOT NULL,
          contradiction_count INTEGER NOT NULL,
          summary TEXT NOT NULL,
          recommendations TEXT NOT NULL DEFAULT '[]',
          timestamp TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS folder_snapshots (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          folder_path TEXT NOT NULL,
          source TEXT NOT NULL,
          file_count INTEGER NOT NULL,
          tracked_extensions TEXT NOT NULL DEFAULT '[]',
          summary TEXT NOT NULL,
          files TEXT NOT NULL DEFAULT '[]',
          timestamp TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS project_checks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          command TEXT NOT NULL,
          check_type TEXT NOT NULL,
          source TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 0.7,
          last_seen TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS project_signals (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          signal_type TEXT NOT NULL,
          label TEXT NOT NULL,
          description TEXT NOT NULL,
          severity INTEGER NOT NULL DEFAULT 1,
          source TEXT NOT NULL,
          timestamp TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workflow_runs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          module_id TEXT NOT NULL,
          status TEXT NOT NULL,
          input_summary TEXT NOT NULL,
          output TEXT NOT NULL,
          review_required INTEGER NOT NULL DEFAULT 1,
          rejection_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          accepted_at TEXT,
          rejected_at TEXT
        );
        "#,
    )?;
    Ok(())
}

fn project_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, String>(0)?,
        "name": row.get::<_, String>(1)?,
        "description": row.get::<_, String>(2)?,
        "category": row.get::<_, String>(3)?,
        "status": row.get::<_, String>(4)?,
        "created_at": row.get::<_, String>(5)?,
        "updated_at": row.get::<_, String>(6)?,
        "goals": parse_json(row.get::<_, String>(7)?, json!([])),
        "current_state_summary": row.get::<_, String>(8)?,
        "health_score": row.get::<_, i64>(9)?,
        "tags": parse_json(row.get::<_, String>(10)?, json!([]))
    }))
}

fn get_project_value(db: &Connection, project_id: &str) -> rusqlite::Result<Option<Value>> {
    db.query_row(
        "SELECT id,name,description,category,status,created_at,updated_at,goals,current_state_summary,health_score,tags FROM projects WHERE id=?",
        [project_id],
        project_row,
    ).optional()
}

fn query_values(db: &Connection, sql: &str, project_id: &str, mapper: fn(&rusqlite::Row<'_>) -> rusqlite::Result<Value>) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = db.prepare(sql)?;
    let rows = stmt.query_map([project_id], mapper)?;
    rows.collect()
}

fn event_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, String>(0)?,
        "project_id": row.get::<_, String>(1)?,
        "event_type": row.get::<_, String>(2)?,
        "summary": row.get::<_, String>(3)?,
        "source": row.get::<_, String>(4)?,
        "timestamp": row.get::<_, String>(5)?,
        "related_decision_ids": parse_json(row.get::<_, String>(6)?, json!([])),
        "related_task_ids": parse_json(row.get::<_, String>(7)?, json!([]))
    }))
}

fn draft_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, String>(0)?,
        "run_id": row.get::<_, String>(1)?,
        "project_id": row.get::<_, String>(2)?,
        "event_id": row.get::<_, String>(3)?,
        "payload": parse_json(row.get::<_, String>(4)?, json!({})),
        "accepted_at": row.get::<_, Option<String>>(5)?,
        "created_at": row.get::<_, String>(6)?
    }))
}

fn workflow_modules() -> Value {
    json!([
      {"id":"pr-reviewer","name":"PR Reviewer","purpose":"Review a diff or patch for bugs, tests, security, regressions, and maintainability issues.","trigger_type":"patch","required_context":["diff or patch text"],"output_type":"review-report","risk_level":"medium","review_required":true},
      {"id":"doc-writer","name":"Doc Writer","purpose":"Detect documentation drift and draft README/docs/docstring updates.","trigger_type":"change-notes","required_context":["change summary or patch text"],"output_type":"documentation-draft","risk_level":"low","review_required":true},
      {"id":"refactor-tracker","name":"Refactor Tracker","purpose":"Find TODO/FIXME, large files, duplicate-looking patterns, and maintainability risks.","trigger_type":"project-snapshot","required_context":["tracked folder snapshot"],"output_type":"refactor-report","risk_level":"medium","review_required":true}
    ])
}

fn extraction_payload(note: &str, source: &str) -> Value {
    let lowered = note.to_lowercase();
    let summary = note.lines().find(|line| line.trim().len() > 24).unwrap_or(note).trim();
    let mut tasks = Vec::new();
    let mut decisions = Vec::new();
    let mut branches = Vec::new();
    let mut drift = Vec::new();
    for line in note.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let l = line.to_lowercase();
        if l.contains("todo") || l.contains("task") || l.contains("need to") || l.contains("implement") {
            tasks.push(json!({"task": line, "status": if l.contains("block") {"blocked"} else {"active"}, "priority": 3, "rationale": "Extracted from project update.", "linked_decision": "", "blocker_reason": if l.contains("block") {line} else {""}, "source": source}));
        }
        if l.contains("decided") || l.contains("decision") || l.contains("because") || l.contains("rationale") {
            decisions.push(json!({"decision": line, "rationale": "Heuristic extraction from update context.", "constraints": [], "tradeoffs": [], "alternatives_considered": [], "failed_paths": [], "served_goal": "", "reversal_conditions": [], "confidence": 0.58, "source": source}));
        }
        if l.contains("branch") || l.contains("unresolved") || l.contains("later") || l.contains("option") {
            branches.push(json!({"branch_name": line.chars().take(64).collect::<String>(), "description": line, "status": "unresolved", "reason_created": "Extracted as an unresolved path.", "current_summary": line, "linked_decisions": [], "source": source}));
        }
    }
    if lowered.contains("no longer") || lowered.contains("changed") || lowered.contains("drift") || lowered.contains("conflict") {
        drift.push(json!({"drift_type": "direction-change", "description": "Update language suggests the project direction or assumptions changed.", "severity": 2, "evidence": [summary], "suggested_review": "Review why the change happened and whether old decisions still hold.", "source": source}));
    }
    json!({
        "projectSummary": summary,
        "goals": [],
        "decisions": decisions,
        "concepts": [],
        "branches": branches,
        "tasks": tasks,
        "driftWarnings": drift
    })
}

#[tauri::command]
fn list_projects(state: tauri::State<'_, AppState>) -> Result<Value, String> {
    let db = state.db.lock().map_err(app_error)?;
    let mut stmt = db.prepare("SELECT id,name,description,category,status,created_at,updated_at,goals,current_state_summary,health_score,tags FROM projects ORDER BY updated_at DESC").map_err(app_error)?;
    let rows = stmt.query_map([], project_row).map_err(app_error)?;
    let items: rusqlite::Result<Vec<_>> = rows.collect();
    Ok(json!(items.map_err(app_error)?))
}

#[tauri::command]
fn create_project(state: tauri::State<'_, AppState>, input: Value) -> Result<Value, String> {
    let db = state.db.lock().map_err(app_error)?;
    let project_id = id();
    let ts = now();
    let name = input["name"].as_str().unwrap_or("").trim();
    if name.is_empty() {
        return Err("Project name is required.".to_string());
    }
    db.execute(
        "INSERT INTO projects (id,name,description,category,status,created_at,updated_at,goals,current_state_summary,health_score,tags) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        params![
            project_id,
            name,
            input["description"].as_str().unwrap_or(""),
            input["category"].as_str().unwrap_or("software"),
            "active",
            ts,
            ts,
            "[]",
            "",
            0,
            json_text(input.get("tags").cloned().unwrap_or(json!([])))
        ],
    ).map_err(app_error)?;
    get_project_value(&db, &project_id).map_err(app_error)?.ok_or_else(|| "Project was not created.".to_string())
}

#[tauri::command]
fn delete_project(state: tauri::State<'_, AppState>, project_id: String) -> Result<Value, String> {
    let db = state.db.lock().map_err(app_error)?;
    let changed = db.execute("DELETE FROM projects WHERE id=?", [project_id]).map_err(app_error)?;
    if changed == 0 {
        return Err("Project not found.".to_string());
    }
    Ok(json!({"ok": true}))
}

#[tauri::command]
fn get_overview(state: tauri::State<'_, AppState>, project_id: String) -> Result<Value, String> {
    let db = state.db.lock().map_err(app_error)?;
    overview_value(&db, &project_id).map_err(app_error)
}

fn overview_value(db: &Connection, project_id: &str) -> rusqlite::Result<Value> {
    let project = get_project_value(db, project_id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    let events = query_values(db, "SELECT id,project_id,event_type,summary,source,timestamp,related_decision_ids,related_task_ids FROM project_events WHERE project_id=? ORDER BY timestamp DESC", project_id, event_row)?;
    let drafts = query_values(db, "SELECT id,run_id,project_id,event_id,payload,accepted_at,created_at FROM extraction_drafts WHERE project_id=? AND accepted_at IS NULL ORDER BY created_at DESC", project_id, draft_row)?;
    Ok(json!({
        "project": project,
        "events": events,
        "decisions": query_json_table(db, "decision_records", project_id)?,
        "concepts": query_json_table(db, "concept_nodes", project_id)?,
        "branches": query_json_table(db, "branch_records", project_id)?,
        "tasks": query_json_table(db, "task_records", project_id)?,
        "driftWarnings": query_json_table(db, "drift_warnings", project_id)?,
        "latestHealthReport": latest_health(db, project_id)?,
        "pendingDrafts": drafts,
        "folderSnapshots": query_json_table(db, "folder_snapshots", project_id)?,
        "checks": query_json_table(db, "project_checks", project_id)?,
        "signals": query_json_table(db, "project_signals", project_id)?,
        "workflowRuns": query_workflow_runs(db, project_id)?
    }))
}

fn query_json_table(db: &Connection, table: &str, project_id: &str) -> rusqlite::Result<Vec<Value>> {
    let sql = format!("SELECT * FROM {table} WHERE project_id=? ORDER BY rowid DESC");
    let mut stmt = db.prepare(&sql)?;
    let names: Vec<String> = stmt.column_names().iter().map(|name| name.to_string()).collect();
    let rows = stmt.query_map([project_id], |row| {
        let mut object = serde_json::Map::new();
        for (index, name) in names.iter().enumerate() {
            let text: rusqlite::Result<String> = row.get(index);
            if let Ok(value) = text {
                if matches!(name.as_str(), "goals" | "tags" | "constraints" | "tradeoffs" | "alternatives_considered" | "failed_paths" | "reversal_conditions" | "related_concepts" | "linked_decisions" | "evidence" | "recommendations" | "tracked_extensions" | "files") {
                    object.insert(name.clone(), parse_json(value, json!([])));
                } else {
                    object.insert(name.clone(), json!(value));
                }
            } else if let Ok(value) = row.get::<_, i64>(index) {
                object.insert(name.clone(), json!(value));
            } else if let Ok(value) = row.get::<_, f64>(index) {
                object.insert(name.clone(), json!(value));
            } else {
                object.insert(name.clone(), Value::Null);
            }
        }
        Ok(Value::Object(object))
    })?;
    rows.collect()
}

fn latest_health(db: &Connection, project_id: &str) -> rusqlite::Result<Option<Value>> {
    let reports = query_json_table(db, "project_health_reports", project_id)?;
    Ok(reports.into_iter().next())
}

fn query_workflow_runs(db: &Connection, project_id: &str) -> rusqlite::Result<Vec<Value>> {
    let mut runs = query_json_table(db, "workflow_runs", project_id)?;
    for run in &mut runs {
        if let Some(output) = run.get("output").and_then(Value::as_str) {
            run["output"] = serde_json::from_str(output).unwrap_or(json!({}));
        }
        run["review_required"] = json!(run.get("review_required").and_then(Value::as_str).map(|value| value == "1").unwrap_or(true));
    }
    Ok(runs)
}

#[tauri::command]
fn add_project_update(state: tauri::State<'_, AppState>, project_id: String, input: Value) -> Result<Value, String> {
    let db = state.db.lock().map_err(app_error)?;
    let note = input["note"].as_str().unwrap_or("").trim();
    if note.is_empty() {
        return Err("Update note is required.".to_string());
    }
    let source = input["source"].as_str().unwrap_or("manual");
    create_event_and_draft(&db, &project_id, "update", note, source)?;
    overview_value(&db, &project_id).map_err(app_error)
}

fn create_event_and_draft(db: &Connection, project_id: &str, event_type: &str, note: &str, source: &str) -> Result<Value, String> {
    let event_id = id();
    let run_id = id();
    let draft_id = id();
    let ts = now();
    let summary = note.chars().take(220).collect::<String>();
    db.execute("INSERT INTO project_events (id,project_id,event_type,summary,source,timestamp,related_decision_ids,related_task_ids) VALUES (?,?,?,?,?,?,?,?)",
        params![event_id, project_id, event_type, summary, source, ts, "[]", "[]"]).map_err(app_error)?;
    db.execute("INSERT INTO extraction_runs (id,project_id,event_id,status,provider,created_at) VALUES (?,?,?,?,?,?)",
        params![run_id, project_id, event_id, "draft", "tauri-heuristic", ts]).map_err(app_error)?;
    let payload = extraction_payload(note, source);
    db.execute("INSERT INTO extraction_drafts (id,run_id,project_id,event_id,payload,created_at) VALUES (?,?,?,?,?,?)",
        params![draft_id, run_id, project_id, event_id, json_text(payload.clone()), ts]).map_err(app_error)?;
    Ok(payload)
}

#[tauri::command]
fn accept_extraction(state: tauri::State<'_, AppState>, project_id: String, run_id: String, _input: Value) -> Result<Value, String> {
    let db = state.db.lock().map_err(app_error)?;
    let draft: Value = db.query_row("SELECT id,event_id,payload FROM extraction_drafts WHERE project_id=? AND run_id=? AND accepted_at IS NULL", params![project_id, run_id], |row| {
        Ok(json!({"id": row.get::<_, String>(0)?, "event_id": row.get::<_, String>(1)?, "payload": parse_json(row.get::<_, String>(2)?, json!({}))}))
    }).map_err(app_error)?;
    let ts = now();
    let event_id = draft["event_id"].as_str().unwrap_or("");
    let payload = &draft["payload"];
    if let Some(summary) = payload["projectSummary"].as_str() {
        db.execute("UPDATE projects SET current_state_summary=?, updated_at=? WHERE id=?", params![summary, ts, project_id]).map_err(app_error)?;
    }
    insert_payload_records(&db, &project_id, event_id, &run_id, payload)?;
    db.execute("UPDATE extraction_drafts SET accepted_at=? WHERE project_id=? AND run_id=?", params![ts, project_id, run_id]).map_err(app_error)?;
    db.execute("UPDATE extraction_runs SET status='accepted' WHERE project_id=? AND id=?", params![project_id, run_id]).map_err(app_error)?;
    overview_value(&db, &project_id).map_err(app_error)
}

fn insert_payload_records(db: &Connection, project_id: &str, event_id: &str, run_id: &str, payload: &Value) -> Result<(), String> {
    let ts = now();
    for item in payload["decisions"].as_array().unwrap_or(&Vec::new()) {
        db.execute("INSERT INTO decision_records (id,project_id,decision,rationale,constraints,tradeoffs,alternatives_considered,failed_paths,served_goal,reversal_conditions,confidence,source,timestamp,provenance_event_id,provenance_extraction_run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            params![id(), project_id, item["decision"].as_str().unwrap_or("Decision"), item["rationale"].as_str().unwrap_or(""), json_text(item["constraints"].clone()), json_text(item["tradeoffs"].clone()), json_text(item["alternatives_considered"].clone()), json_text(item["failed_paths"].clone()), item["served_goal"].as_str().unwrap_or(""), json_text(item["reversal_conditions"].clone()), item["confidence"].as_f64().unwrap_or(0.55), item["source"].as_str().unwrap_or("draft"), ts, event_id, run_id]).map_err(app_error)?;
    }
    for item in payload["branches"].as_array().unwrap_or(&Vec::new()) {
        db.execute("INSERT INTO branch_records (id,project_id,branch_name,description,status,reason_created,current_summary,linked_decisions,timestamp,provenance_event_id,provenance_extraction_run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            params![id(), project_id, item["branch_name"].as_str().unwrap_or("Unresolved branch"), item["description"].as_str().unwrap_or(""), item["status"].as_str().unwrap_or("unresolved"), item["reason_created"].as_str().unwrap_or("Draft accepted."), item["current_summary"].as_str().unwrap_or(""), json_text(item["linked_decisions"].clone()), ts, event_id, run_id]).map_err(app_error)?;
    }
    for item in payload["tasks"].as_array().unwrap_or(&Vec::new()) {
        db.execute("INSERT INTO task_records (id,project_id,task,status,priority,rationale,linked_decision,blocker_reason,created_at,updated_at,provenance_event_id,provenance_extraction_run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            params![id(), project_id, item["task"].as_str().unwrap_or("Task"), item["status"].as_str().unwrap_or("active"), item["priority"].as_i64().unwrap_or(3), item["rationale"].as_str().unwrap_or(""), item["linked_decision"].as_str().unwrap_or(""), item["blocker_reason"].as_str().unwrap_or(""), ts, ts, event_id, run_id]).map_err(app_error)?;
    }
    for item in payload["driftWarnings"].as_array().unwrap_or(&Vec::new()) {
        db.execute("INSERT INTO drift_warnings (id,project_id,drift_type,description,severity,evidence,suggested_review,timestamp,provenance_event_id,provenance_extraction_run_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
            params![id(), project_id, item["drift_type"].as_str().unwrap_or("drift"), item["description"].as_str().unwrap_or(""), item["severity"].as_i64().unwrap_or(2), json_text(item["evidence"].clone()), item["suggested_review"].as_str().unwrap_or("Review this item."), ts, event_id, run_id]).map_err(app_error)?;
    }
    Ok(())
}

#[tauri::command]
fn list_workflow_modules() -> Result<Value, String> {
    Ok(workflow_modules())
}

#[tauri::command]
fn scan_local_projects(input: Value) -> Result<Value, String> {
    let root = input["rootPath"].as_str().ok_or_else(|| "A local rootPath is required in desktop mode.".to_string())?;
    scan_path(Path::new(root))
}

fn scan_path(root: &Path) -> Result<Value, String> {
    if !root.exists() {
        return Err("Selected folder does not exist.".to_string());
    }
    let ignored = ["node_modules", ".git", "dist", "build", ".cache", "coverage", ".venv", "target"];
    let mut files = Vec::new();
    let mut ignored_count = 0;
    let mut unreadable_count = 0;
    for entry in WalkDir::new(root).max_depth(5).into_iter().filter_entry(|entry| {
        let name = entry.file_name().to_string_lossy();
        let skip = ignored.iter().any(|item| item == &name.as_ref());
        if skip { ignored_count += 1; }
        !skip
    }).take(500) {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                unreadable_count += 1;
                continue;
            }
        };
        if !entry.file_type().is_file() { continue; }
        let path = entry.path();
        let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        if size > 512_000 { continue; }
        let text = fs::read_to_string(path).unwrap_or_else(|_| {
            unreadable_count += 1;
            String::new()
        });
        if text.is_empty() && size > 0 { continue; }
        let rel = path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/");
        files.push(json!({"path": rel, "size": size, "kind": "text", "excerpt": text.chars().take(4000).collect::<String>()}));
    }
    let candidate = candidate_from_files(root, files)?;
    let mut warnings = Vec::new();
    if ignored_count > 0 {
        warnings.push(json!({"code":"generated-folders-skipped","message": format!("Skipped {ignored_count} generated/cache folder(s)."),"severity":"info"}));
    }
    if unreadable_count > 0 {
        warnings.push(json!({"code":"unreadable-files-skipped","message": format!("Skipped {unreadable_count} unreadable file(s)."),"severity":"info"}));
    }
    let candidates = if candidate["confidence"].as_f64().unwrap_or(0.0) > 0.15 { vec![candidate] } else { warnings.push(json!({"code":"no-candidates","message":"No strong project root found.","severity":"warning"})); Vec::new() };
    Ok(json!({"candidates": candidates, "warnings": warnings, "ignored_folder_count": ignored_count, "unreadable_file_count": unreadable_count, "scanned_at": now()}))
}

fn candidate_from_files(root: &Path, files: Vec<Value>) -> Result<Value, String> {
    let name = root.file_name().map(|value| value.to_string_lossy().to_string()).unwrap_or_else(|| "Tracked Project".to_string());
    let mut evidence = Vec::new();
    let mut reasons = Vec::new();
    let mut stack = HashSet::new();
    let mut checks = Vec::new();
    let mut signals = Vec::new();
    let mut readme = String::new();
    for file in &files {
        let path = file["path"].as_str().unwrap_or("");
        let lower = path.to_lowercase();
        let excerpt = file["excerpt"].as_str().unwrap_or("");
        if lower.contains("readme") {
            evidence.push(path.to_string());
            reasons.push("README found");
            readme = excerpt.chars().take(700).collect();
        }
        if lower.ends_with("package.json") {
            evidence.push(path.to_string());
            reasons.push("package.json scripts");
            stack.insert("Node/TypeScript".to_string());
            for check in detect_package_checks(excerpt, path) {
                checks.push(check);
            }
        }
        if lower.ends_with("pyproject.toml") || lower.ends_with("requirements.txt") {
            stack.insert("Python".to_string());
            reasons.push("Python project files");
            checks.push(json!({"command":"pytest","check_type":"test","source":path,"confidence":0.65}));
        }
        if lower.contains("src/") || lower.starts_with("src") {
            reasons.push("source entrypoint");
        }
        if lower.contains("why") || lower.contains("architecture") || excerpt.to_lowercase().contains("why-layer") {
            reasons.push("why-layer docs");
            signals.push(json!({"signal_type":"why-layer","label":"Why-layer docs","description":"Project contains reasoning or architecture notes that may preserve decision context.","severity":1,"source":path}));
        }
        let text = excerpt.to_lowercase();
        if text.contains("system_sweep") || text.contains("validation") || text.contains("health check") {
            reasons.push("validation command");
            checks.push(json!({"command":"system_sweep or validation command referenced in docs","check_type":"validation","source":path,"confidence":0.72}));
        }
    }
    reasons.sort();
    reasons.dedup();
    let confidence = (0.25 + reasons.len() as f64 * 0.11 + checks.len() as f64 * 0.06).min(0.95);
    Ok(json!({
        "id": id(),
        "name": name,
        "path": root.to_string_lossy(),
        "evidence_files": evidence,
        "detection_reasons": reasons,
        "readme_preview": readme,
        "detected_stack": stack.into_iter().collect::<Vec<_>>(),
        "detected_checks": checks,
        "signals": signals,
        "confidence": confidence,
        "files": files,
        "source": "local-path"
    }))
}

fn detect_package_checks(text: &str, source: &str) -> Vec<Value> {
    let mut checks = Vec::new();
    let re = Regex::new(r#""([^"]*(test|build|lint|typecheck|check|validate|health|sweep)[^"]*)"\s*:\s*"([^"]+)""#).unwrap();
    for cap in re.captures_iter(text) {
        let name = cap.get(1).map(|m| m.as_str()).unwrap_or("check");
        let command = format!("npm run {name}");
        let kind = if name.contains("test") {"test"} else if name.contains("build") {"build"} else if name.contains("lint") {"lint"} else if name.contains("type") {"typecheck"} else {"validation"};
        checks.push(json!({"command": command, "check_type": kind, "source": source, "confidence": 0.86}));
    }
    checks
}

#[tauri::command]
fn track_candidate(state: tauri::State<'_, AppState>, input: Value) -> Result<Value, String> {
    let candidate = input.get("candidate").unwrap_or(&input);
    let db = state.db.lock().map_err(app_error)?;
    let project = create_project_from_candidate(&db, candidate)?;
    let project_id = project["id"].as_str().unwrap_or("");
    let snapshot_id = id();
    let ts = now();
    db.execute("INSERT INTO folder_snapshots (id,project_id,folder_path,source,file_count,tracked_extensions,summary,files,timestamp) VALUES (?,?,?,?,?,?,?,?,?)",
        params![snapshot_id, project_id, candidate["path"].as_str().unwrap_or(""), candidate["source"].as_str().unwrap_or("local-path"), candidate["files"].as_array().map(|a| a.len()).unwrap_or(0) as i64, "[]", candidate["readme_preview"].as_str().unwrap_or(""), json_text(candidate["files"].clone()), ts]).map_err(app_error)?;
    for check in candidate["detected_checks"].as_array().unwrap_or(&Vec::new()) {
        db.execute("INSERT INTO project_checks (id,project_id,command,check_type,source,confidence,last_seen) VALUES (?,?,?,?,?,?,?)",
            params![id(), project_id, check["command"].as_str().unwrap_or("check"), check["check_type"].as_str().unwrap_or("unknown"), check["source"].as_str().unwrap_or("scan"), check["confidence"].as_f64().unwrap_or(0.7), ts]).map_err(app_error)?;
    }
    for signal in candidate["signals"].as_array().unwrap_or(&Vec::new()) {
        db.execute("INSERT INTO project_signals (id,project_id,signal_type,label,description,severity,source,timestamp) VALUES (?,?,?,?,?,?,?,?)",
            params![id(), project_id, signal["signal_type"].as_str().unwrap_or("stack"), signal["label"].as_str().unwrap_or("Project signal"), signal["description"].as_str().unwrap_or(""), signal["severity"].as_i64().unwrap_or(1), signal["source"].as_str().unwrap_or("scan"), ts]).map_err(app_error)?;
    }
    let payload = create_event_and_draft(&db, project_id, "project-import", candidate["readme_preview"].as_str().unwrap_or("Imported project folder."), "local-folder")?;
    Ok(json!({"project": project, "snapshot": query_json_table(&db, "folder_snapshots", project_id).map_err(app_error)?.first().cloned().unwrap_or(json!({})), "draft": {"payload": payload}, "checks": query_json_table(&db, "project_checks", project_id).map_err(app_error)?, "signals": query_json_table(&db, "project_signals", project_id).map_err(app_error)?}))
}

fn create_project_from_candidate(db: &Connection, candidate: &Value) -> Result<Value, String> {
    let project_id = id();
    let ts = now();
    let name = candidate["name"].as_str().unwrap_or("Tracked Project");
    let summary = candidate["readme_preview"].as_str().unwrap_or("");
    db.execute("INSERT INTO projects (id,name,description,category,status,created_at,updated_at,goals,current_state_summary,health_score,tags) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        params![project_id, name, summary, "software", "active", ts, ts, "[]", summary, 0, json_text(json!(["imported"]))]).map_err(app_error)?;
    get_project_value(db, &project_id).map_err(app_error)?.ok_or_else(|| "Project import failed.".to_string())
}

#[tauri::command]
fn add_folder_snapshot(state: tauri::State<'_, AppState>, project_id: String, input: Value) -> Result<Value, String> {
    let db = state.db.lock().map_err(app_error)?;
    if let Some(path) = input["folderPath"].as_str() {
        let result = scan_path(Path::new(path))?;
        let candidate = result["candidates"].as_array().and_then(|items| items.first()).cloned().ok_or_else(|| "No project candidate found in folder.".to_string())?;
        db.execute("INSERT INTO folder_snapshots (id,project_id,folder_path,source,file_count,tracked_extensions,summary,files,timestamp) VALUES (?,?,?,?,?,?,?,?,?)",
            params![id(), project_id, path, "local-path", candidate["files"].as_array().map(|a| a.len()).unwrap_or(0) as i64, "[]", candidate["readme_preview"].as_str().unwrap_or(""), json_text(candidate["files"].clone()), now()]).map_err(app_error)?;
        create_event_and_draft(&db, &project_id, "folder-snapshot", candidate["readme_preview"].as_str().unwrap_or("Folder snapshot imported."), "local-folder")?;
    }
    overview_value(&db, &project_id).map_err(app_error)
}

#[tauri::command]
fn generate_health_report(state: tauri::State<'_, AppState>, project_id: String) -> Result<Value, String> {
    let db = state.db.lock().map_err(app_error)?;
    let branches = count_where(&db, "branch_records", &project_id, "status NOT IN ('merged','abandoned')")?;
    let blocked = count_where(&db, "task_records", &project_id, "status='blocked'")?;
    let drift = count_all(&db, "drift_warnings", &project_id)?;
    let checks = count_all(&db, "project_checks", &project_id)?;
    let continuity = (82_i64 - branches * 4 - blocked * 6 - drift * 5).clamp(20, 98);
    let drift_score = (drift * 18 + blocked * 8).clamp(0, 100);
    let recommendations = if checks == 0 { json!(["Add or document validation commands before relying on this project state."]) } else { json!(["Run the detected validation checks before major changes.", "Review unresolved branches and stale assumptions."]) };
    db.execute("INSERT INTO project_health_reports (id,project_id,continuity_score,drift_score,unresolved_branch_count,stale_assumption_count,blocked_task_count,contradiction_count,summary,recommendations,timestamp) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        params![id(), project_id, continuity, drift_score, branches, 0, blocked, drift, format!("Continuity is {continuity}/100 with {branches} unresolved branch(es), {blocked} blocked task(s), and {drift} drift warning(s)."), json_text(recommendations), now()]).map_err(app_error)?;
    db.execute("UPDATE projects SET health_score=?, updated_at=? WHERE id=?", params![continuity, now(), project_id]).map_err(app_error)?;
    overview_value(&db, &project_id).map_err(app_error)
}

fn count_all(db: &Connection, table: &str, project_id: &str) -> Result<i64, String> {
    db.query_row(&format!("SELECT COUNT(*) FROM {table} WHERE project_id=?"), [project_id], |row| row.get(0)).map_err(app_error)
}

fn count_where(db: &Connection, table: &str, project_id: &str, condition: &str) -> Result<i64, String> {
    db.query_row(&format!("SELECT COUNT(*) FROM {table} WHERE project_id=? AND {condition}"), [project_id], |row| row.get(0)).map_err(app_error)
}

#[tauri::command]
fn export_project(state: tauri::State<'_, AppState>, project_id: String, format: String) -> Result<Value, String> {
    let db = state.db.lock().map_err(app_error)?;
    let overview = overview_value(&db, &project_id).map_err(app_error)?;
    if format == "markdown" {
        let project = &overview["project"];
        return Ok(json!({
            "format": "markdown",
            "content": format!("# {}\n\n{}\n\n## Current State\n{}\n", project["name"].as_str().unwrap_or("Project"), project["description"].as_str().unwrap_or(""), project["current_state_summary"].as_str().unwrap_or(""))
        }));
    }
    Ok(overview)
}

#[tauri::command]
fn get_context_packet(state: tauri::State<'_, AppState>, project_id: String, budget: String) -> Result<Value, String> {
    let db = state.db.lock().map_err(app_error)?;
    let overview = overview_value(&db, &project_id).map_err(app_error)?;
    let limit = match budget.as_str() { "large" => 12, "medium" => 7, _ => 4 };
    Ok(json!({
        "project_id": project_id,
        "project_name": overview["project"]["name"],
        "budget": budget,
        "generated_at": now(),
        "summary": overview["project"]["current_state_summary"],
        "current_state": overview["project"]["current_state_summary"],
        "recent_changes": overview["events"].as_array().unwrap_or(&Vec::new()).iter().take(limit).cloned().collect::<Vec<_>>(),
        "active_decisions": overview["decisions"].as_array().unwrap_or(&Vec::new()).iter().take(limit).cloned().collect::<Vec<_>>(),
        "unresolved_branches": overview["branches"].as_array().unwrap_or(&Vec::new()).iter().take(limit).cloned().collect::<Vec<_>>(),
        "active_tasks": overview["tasks"].as_array().unwrap_or(&Vec::new()).iter().take(limit).cloned().collect::<Vec<_>>(),
        "detected_checks": overview["checks"].as_array().unwrap_or(&Vec::new()).iter().take(limit).cloned().collect::<Vec<_>>(),
        "drift_and_stability_risks": overview["driftWarnings"].as_array().unwrap_or(&Vec::new()).iter().take(limit).cloned().collect::<Vec<_>>(),
        "recommended_next_review": "Review latest drift warnings, then run detected checks before major work.",
        "provenance": {"event_count": overview["events"].as_array().map(|a| a.len()).unwrap_or(0), "decision_count": overview["decisions"].as_array().map(|a| a.len()).unwrap_or(0), "folder_snapshot_count": overview["folderSnapshots"].as_array().map(|a| a.len()).unwrap_or(0)},
        "approximate_tokens": limit * 180
    }))
}

#[tauri::command]
fn run_workflow(state: tauri::State<'_, AppState>, project_id: String, module_id: String, input: Value) -> Result<Value, String> {
    let db = state.db.lock().map_err(app_error)?;
    let text = input["patch"].as_str().or_else(|| input["changeNotes"].as_str()).or_else(|| input["context"].as_str()).unwrap_or("");
    if module_id != "refactor-tracker" && text.trim().is_empty() {
        return Err("Workflow context is required.".to_string());
    }
    let output = workflow_output(&module_id, text);
    let run_id = id();
    let ts = now();
    db.execute("INSERT INTO workflow_runs (id,project_id,module_id,status,input_summary,output,review_required,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        params![run_id, project_id, module_id, "draft", text.chars().take(180).collect::<String>(), json_text(output.clone()), 1, ts, ts]).map_err(app_error)?;
    db.query_row("SELECT id,project_id,module_id,status,input_summary,output,review_required,rejection_reason,created_at,updated_at,accepted_at,rejected_at FROM workflow_runs WHERE id=?", [run_id], |row| {
        Ok(json!({"id": row.get::<_, String>(0)?, "project_id": row.get::<_, String>(1)?, "module_id": row.get::<_, String>(2)?, "status": row.get::<_, String>(3)?, "input_summary": row.get::<_, String>(4)?, "output": parse_json(row.get::<_, String>(5)?, json!({})), "review_required": row.get::<_, i64>(6)? == 1, "rejection_reason": row.get::<_, Option<String>>(7)?, "created_at": row.get::<_, String>(8)?, "updated_at": row.get::<_, String>(9)?, "accepted_at": row.get::<_, Option<String>>(10)?, "rejected_at": row.get::<_, Option<String>>(11)?}))
    }).map_err(app_error)
}

fn workflow_output(module_id: &str, text: &str) -> Value {
    match module_id {
        "doc-writer" => json!({"summary":"Documentation review created suggested docs guidance pending review.","findings":[{"title":"Potential documentation drift","severity":2,"category":"docs","description":"The supplied change context may need README or docs updates.","evidence":[text.chars().take(160).collect::<String>()],"recommendation":"Review README/docs for changed commands, behavior, or setup notes."}],"draft_comments":["Proposed docs should explain the user-visible change and any new validation steps."],"proposed_patches":[],"implementation_notes":["Suggested only until reviewed.","After acceptance, humans or AI agents may use this output as approved implementation guidance.","Continuity Layer does not silently mutate project files."],"continuity_updates":{"event_summary":"Doc Writer checked for documentation drift.","branch_suggestions":["Review documentation drift from recent change"],"drift_warnings":[{"drift_type":"documentation-drift","description":"Code or behavior may have changed without matching docs.","severity":2,"evidence":[text.chars().take(160).collect::<String>()],"suggested_review":"Update docs or explicitly mark no docs needed."}]}}),
        "refactor-tracker" => json!({"summary":"Refactor tracker produced suggested maintenance guidance pending review.","findings":[{"title":"Review TODO/FIXME and large files","severity":2,"category":"refactor","description":"Desktop parity uses tracked snapshots for deeper refactor scoring; this first pass records the review branch.","evidence":["Tracked project snapshot context"],"recommendation":"Prioritize TODO/FIXME clusters and files with broad responsibility."}],"draft_comments":[],"proposed_patches":[],"implementation_notes":["Suggested only until reviewed.","After acceptance, humans or AI agents may use this output as approved implementation guidance.","Continuity Layer does not silently mutate project files."],"continuity_updates":{"event_summary":"Refactor Tracker reviewed maintainability signals.","branch_suggestions":["Prioritize maintainability review"],"drift_warnings":[]}}),
        _ => json!({"summary":"PR review created suggested fix guidance pending review.","findings":[{"title":"Review patch validation","severity":2,"category":"missing-tests","description":"The patch should be backed by tests or a clear manual verification path.","evidence":[text.chars().take(160).collect::<String>()],"recommendation":"Run or document the smallest validation command that covers this change."}],"draft_comments":["Check for regressions, missing tests, security-sensitive changes, and style consistency."],"proposed_patches":[],"implementation_notes":["Suggested only until reviewed.","After acceptance, humans or AI agents may use this output as approved implementation guidance.","Continuity Layer does not silently mutate project files."],"continuity_updates":{"event_summary":"PR Reviewer inspected a patch/diff.","branch_suggestions":["Follow up on PR review findings"],"drift_warnings":[]}})
    }
}

#[tauri::command]
fn accept_workflow(state: tauri::State<'_, AppState>, project_id: String, run_id: String, _input: Value) -> Result<Value, String> {
    let db = state.db.lock().map_err(app_error)?;
    let output: Value = db.query_row("SELECT output FROM workflow_runs WHERE id=? AND project_id=? AND status='draft'", params![run_id, project_id], |row| Ok(parse_json(row.get::<_, String>(0)?, json!({})))).map_err(app_error)?;
    let ts = now();
    db.execute("UPDATE workflow_runs SET status='accepted', accepted_at=?, updated_at=? WHERE id=? AND project_id=?", params![ts, ts, run_id, project_id]).map_err(app_error)?;
    db.execute("INSERT INTO project_events (id,project_id,event_type,summary,source,timestamp,related_decision_ids,related_task_ids) VALUES (?,?,?,?,?,?,?,?)",
        params![id(), project_id, "workflow", output["continuity_updates"]["event_summary"].as_str().unwrap_or("Workflow output accepted."), "workflow-module", ts, "[]", "[]"]).map_err(app_error)?;
    for branch in output["continuity_updates"]["branch_suggestions"].as_array().unwrap_or(&Vec::new()) {
        db.execute("INSERT INTO branch_records (id,project_id,branch_name,description,status,reason_created,current_summary,linked_decisions,timestamp) VALUES (?,?,?,?,?,?,?,?,?)",
            params![id(), project_id, branch.as_str().unwrap_or("Workflow follow-up"), "Workflow-created review branch.", "unresolved", "Accepted workflow recommendation.", branch.as_str().unwrap_or(""), "[]", ts]).map_err(app_error)?;
    }
    overview_value(&db, &project_id).map_err(app_error)
}

#[tauri::command]
fn reject_workflow(state: tauri::State<'_, AppState>, project_id: String, run_id: String, input: Value) -> Result<Value, String> {
    let db = state.db.lock().map_err(app_error)?;
    let ts = now();
    db.execute("UPDATE workflow_runs SET status='rejected', rejection_reason=?, rejected_at=?, updated_at=? WHERE id=? AND project_id=?",
        params![input["reason"].as_str().unwrap_or("Rejected."), ts, ts, run_id, project_id]).map_err(app_error)?;
    overview_value(&db, &project_id).map_err(app_error)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data = app.path().app_data_dir().map_err(|err| Box::<dyn std::error::Error>::from(err))?;
            fs::create_dir_all(&app_data)?;
            let db_path: PathBuf = app_data.join("project-continuity.sqlite");
            let db = Connection::open(db_path)?;
            migrate(&db)?;
            app.manage(AppState { db: Mutex::new(db) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            create_project,
            delete_project,
            get_overview,
            add_project_update,
            accept_extraction,
            scan_local_projects,
            track_candidate,
            add_folder_snapshot,
            generate_health_report,
            export_project,
            get_context_packet,
            list_workflow_modules,
            run_workflow,
            accept_workflow,
            reject_workflow
        ])
        .run(tauri::generate_context!())
        .expect("error while running Continuity Layer");
}
