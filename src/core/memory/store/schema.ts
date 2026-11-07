import type { Database } from "bun:sqlite"

/**
 * Schema of memory.db. MIGRATIONS[i] takes the store from version i to i + 1; the opener runs
 * each step in its own transaction and bumps `user_version` with it, so a failed step leaves
 * the previous version intact. Append new steps; never edit a released one.
 */
export type Migration = (db: Database) => void

/** Marks the file as an OpenTrading memory store ("OTM1"), so another program's SQLite file is refused. */
export const APPLICATION_ID = 0x4f544d31

const V1 = `
CREATE TABLE counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL CHECK (value >= 0)
);
INSERT INTO counters (name, value) VALUES ('constraint_set', 0);

CREATE TABLE constraints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('constraint', 'style')),
  scope TEXT NOT NULL DEFAULT 'all_accounts',
  current_version INTEGER NOT NULL,
  deleted_at TEXT
);
CREATE TABLE constraint_versions (
  constraint_id INTEGER NOT NULL REFERENCES constraints (id),
  version INTEGER NOT NULL,
  text TEXT,
  source TEXT NOT NULL CHECK (source IN ('manual', 'card', 'investor_import')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (constraint_id, version)
);

CREATE TABLE subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('ticker', 'sector', 'market')),
  sector_id INTEGER REFERENCES subjects (id),
  uppercase_only INTEGER NOT NULL DEFAULT 0 CHECK (uppercase_only IN (0, 1)),
  last_version INTEGER NOT NULL DEFAULT 0,
  current_version INTEGER,
  thesis_state TEXT NOT NULL DEFAULT 'none' CHECK (thesis_state IN ('none', 'watching', 'refuted', 'closed')),
  thesis_state_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE subject_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL REFERENCES subjects (id),
  alias TEXT NOT NULL,
  alias_key TEXT NOT NULL,
  added_at TEXT NOT NULL,
  retired_at TEXT
);
CREATE UNIQUE INDEX subject_aliases_in_use ON subject_aliases (alias_key) WHERE retired_at IS NULL;

CREATE TABLE thesis_versions (
  subject_id INTEGER NOT NULL REFERENCES subjects (id),
  version INTEGER NOT NULL,
  text TEXT,
  detail TEXT,
  conditions TEXT,
  review_by TEXT,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  source TEXT NOT NULL CHECK (source IN ('manual', 'card', 'investor_import')),
  deleted_at TEXT,
  PRIMARY KEY (subject_id, version)
);

CREATE TABLE lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  current_version INTEGER NOT NULL,
  deleted_at TEXT
);
CREATE TABLE lesson_versions (
  lesson_id INTEGER NOT NULL REFERENCES lessons (id),
  version INTEGER NOT NULL,
  title TEXT,
  summary TEXT,
  exceptions TEXT,
  detail TEXT,
  tags TEXT,
  source TEXT NOT NULL CHECK (source IN ('manual', 'card', 'investor_import')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (lesson_id, version)
);
CREATE TABLE lesson_applies (
  lesson_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  position INTEGER NOT NULL,
  subject_id INTEGER NOT NULL REFERENCES subjects (id),
  PRIMARY KEY (lesson_id, version, position),
  FOREIGN KEY (lesson_id, version) REFERENCES lesson_versions (lesson_id, version)
);

CREATE TABLE decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL REFERENCES subjects (id),
  thesis_version INTEGER,
  constraint_set INTEGER NOT NULL,
  action TEXT,
  reason TEXT,
  expectation TEXT,
  confidence TEXT CHECK (confidence IN ('low', 'medium', 'high')),
  review_on TEXT,
  change_mind TEXT,
  source TEXT NOT NULL CHECK (source IN ('manual', 'card', 'investor_import')),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
`

export const MIGRATIONS: readonly Migration[] = [(db) => db.run(V1)]

export const SCHEMA_VERSION = MIGRATIONS.length
