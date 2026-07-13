PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  name TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'researcher',
  password_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  question TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT DEFAULT '',
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS literature (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  doi TEXT DEFAULT '',
  pmid TEXT DEFAULT '',
  pmcid TEXT DEFAULT '',
  source TEXT DEFAULT '',
  year INTEGER DEFAULT NULL,
  journal TEXT DEFAULT '',
  abstract TEXT DEFAULT '',
  screening_status TEXT NOT NULL DEFAULT 'pending',
  pdf_status TEXT NOT NULL DEFAULT 'not_requested',
  parse_status TEXT NOT NULL DEFAULT 'not_requested',
  extraction_status TEXT NOT NULL DEFAULT 'not_requested',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT DEFAULT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  literature_id TEXT DEFAULT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  purpose TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  content_type TEXT DEFAULT '',
  sha256 TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  last_accessed_at TEXT DEFAULT NULL,
  expires_at TEXT DEFAULT NULL,
  deleted_at TEXT DEFAULT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (literature_id) REFERENCES literature(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS extractions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  literature_id TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  status TEXT NOT NULL DEFAULT 'draft',
  confidence REAL NOT NULL DEFAULT 0,
  compact_json TEXT NOT NULL DEFAULT '{}',
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (literature_id) REFERENCES literature(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT DEFAULT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  batch_limit INTEGER NOT NULL DEFAULT 15,
  processed_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  cost_units INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  error TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paused_at TEXT DEFAULT NULL,
  completed_at TEXT DEFAULT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  project_id TEXT DEFAULT NULL,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 1,
  units INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_literature_project ON literature(project_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_literature_identity ON literature(project_id, doi, pmid, pmcid);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id, purpose, deleted_at);
CREATE INDEX IF NOT EXISTS idx_documents_expires ON documents(expires_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_jobs_project_status ON jobs(project_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_events(created_at, kind);
