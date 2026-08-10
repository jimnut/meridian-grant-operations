/**
 * Schema definition.
 *
 * Every tenant-owned table carries `org_id` and is indexed on it. Application
 * queries always filter by the org resolved from the session — the column is
 * never taken from client input.
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  title         TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  slug                    TEXT NOT NULL UNIQUE,
  timezone                TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  currency                TEXT NOT NULL DEFAULT 'USD',
  fiscal_year_start_month INTEGER NOT NULL DEFAULT 1,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('OWNER','MANAGER','MEMBER','VIEWER')),
  created_at TEXT NOT NULL,
  UNIQUE (user_id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(org_id);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS funders (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  focus_areas TEXT NOT NULL DEFAULT '',
  website     TEXT,
  notes       TEXT,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_funders_org ON funders(org_id);

CREATE TABLE IF NOT EXISTS funder_contacts (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  funder_id  TEXT NOT NULL REFERENCES funders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  title      TEXT,
  email      TEXT,
  phone      TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_funder ON funder_contacts(funder_id);
CREATE INDEX IF NOT EXISTS idx_contacts_org ON funder_contacts(org_id);

CREATE TABLE IF NOT EXISTS grants (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  funder_id        TEXT NOT NULL REFERENCES funders(id) ON DELETE RESTRICT,
  owner_user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  program          TEXT,
  status           TEXT NOT NULL,
  requested_cents  INTEGER NOT NULL DEFAULT 0,
  awarded_cents    INTEGER NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'USD',
  probability      INTEGER,
  purpose          TEXT,
  requirements     TEXT,
  next_action      TEXT,
  notes            TEXT,
  application_date TEXT,
  decision_date    TEXT,
  start_date       TEXT,
  end_date         TEXT,
  renewal_date     TEXT,
  closeout_date    TEXT,
  archived         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grants_org ON grants(org_id);
CREATE INDEX IF NOT EXISTS idx_grants_org_status ON grants(org_id, status);
CREATE INDEX IF NOT EXISTS idx_grants_funder ON grants(funder_id);
CREATE INDEX IF NOT EXISTS idx_grants_owner ON grants(owner_user_id);

CREATE TABLE IF NOT EXISTS tasks (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grant_id         TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  assignee_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'TODO',
  priority         TEXT NOT NULL DEFAULT 'MEDIUM',
  due_date         TEXT,
  completed_at     TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_grant ON tasks(grant_id);
CREATE INDEX IF NOT EXISTS idx_tasks_org_status ON tasks(org_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_user_id);

CREATE TABLE IF NOT EXISTS milestones (
  id                      TEXT PRIMARY KEY,
  org_id                  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grant_id                TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  type                    TEXT NOT NULL,
  title                   TEXT NOT NULL,
  due_date                TEXT,
  status                  TEXT NOT NULL DEFAULT 'NOT_STARTED',
  submitted_at            TEXT,
  completed_at            TEXT,
  required_evidence_count INTEGER NOT NULL DEFAULT 0,
  notes                   TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_milestones_grant ON milestones(grant_id);
CREATE INDEX IF NOT EXISTS idx_milestones_org_due ON milestones(org_id, due_date);

CREATE TABLE IF NOT EXISTS budget_lines (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grant_id      TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  description   TEXT,
  planned_cents INTEGER NOT NULL DEFAULT 0,
  spent_cents   INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_budget_grant ON budget_lines(grant_id);
CREATE INDEX IF NOT EXISTS idx_budget_org ON budget_lines(org_id);

CREATE TABLE IF NOT EXISTS documents (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grant_id           TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  milestone_id       TEXT REFERENCES milestones(id) ON DELETE SET NULL,
  uploaded_by        TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  original_name      TEXT NOT NULL,
  storage_key        TEXT NOT NULL UNIQUE,
  doc_type           TEXT NOT NULL DEFAULT 'OTHER',
  mime_type          TEXT NOT NULL,
  size_bytes         INTEGER NOT NULL,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_grant ON documents(grant_id);
CREATE INDEX IF NOT EXISTS idx_documents_milestone ON documents(milestone_id);
CREATE INDEX IF NOT EXISTS idx_documents_org ON documents(org_id);

CREATE TABLE IF NOT EXISTS comments (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grant_id       TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_grant ON comments(grant_id);

CREATE TABLE IF NOT EXISTS activities (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT,
  grant_id       TEXT REFERENCES grants(id) ON DELETE CASCADE,
  action         TEXT NOT NULL,
  summary        TEXT NOT NULL,
  metadata       TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_org_created ON activities(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_grant ON activities(grant_id, created_at DESC);
`;
