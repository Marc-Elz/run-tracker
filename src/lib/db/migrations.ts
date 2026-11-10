/** The part of a database connection the migration runner needs (matches SQLiteDBConnection) */
export interface SqlDb {
  /** Runs several statements in one transaction */
  execute(statements: string): Promise<unknown>
  query(statement: string): Promise<{ values?: Record<string, unknown>[] }>
}

/** The part of a connection the repositories use (matches SQLiteDBConnection) */
export interface SqlConnection extends SqlDb {
  /** One statement; commits on its own */
  run(statement: string, values?: unknown[]): Promise<unknown>
  query(statement: string, values?: unknown[]): Promise<{ values?: Record<string, unknown>[] }>
  /** Several statements in one transaction: all of them apply, or none do */
  executeSet(
    set: { statement: string; values: unknown[] }[],
    transaction?: boolean,
  ): Promise<unknown>
}

/**
 * Schema changes, oldest first; never edit one that has shipped, add a new one.
 * Every statement must end with ";" plus a newline: on Android the plugin splits on exactly
 * that, and runs only the first statement of each piece. No "--" comments: it strips them.
 * All times are UTC epoch milliseconds.
 */
export const MIGRATIONS: readonly string[] = [
  `CREATE TABLE runs (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'finished')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  segment INTEGER NOT NULL DEFAULT 0,
  segment_started_at INTEGER,
  moving_ms INTEGER NOT NULL DEFAULT 0,
  distance_m REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE track_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  segment INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  accuracy REAL,
  altitude REAL,
  speed REAL
);
CREATE INDEX track_points_run ON track_points (run_id, segment, timestamp);
`,
  `CREATE TABLE route_overview (
  run_id TEXT PRIMARY KEY NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  algo INTEGER NOT NULL,
  lines TEXT NOT NULL,
  bounds TEXT
);
`,
  `CREATE TABLE training_programs (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  goal TEXT,
  weeks INTEGER NOT NULL CHECK (weeks >= 1),
  start_date TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE program_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  program_id TEXT NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
  week INTEGER NOT NULL CHECK (week >= 1),
  position INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('easy', 'long', 'intervals', 'tempo', 'free', 'rest')),
  title TEXT NOT NULL,
  notes TEXT
);
CREATE INDEX program_sessions_program ON program_sessions (program_id, week, position);
CREATE TABLE session_steps (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES program_sessions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('warmup', 'run', 'recovery', 'repeat', 'cooldown')),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('none', 'duration', 'distance')),
  target_value REAL,
  pace_min REAL,
  pace_max REAL,
  repetitions INTEGER,
  span INTEGER
);
CREATE INDEX session_steps_session ON session_steps (session_id, position);
`,
  // Session types walk and runwalk, step kind walk (#100). A CHECK can't be altered, so both
  // tables are rebuilt. Foreign keys stay on inside the plugin's transaction, and dropping
  // program_sessions would cascade into session_steps, so the rows wait in plain copies without
  // foreign keys, the child table is dropped first, and parents are copied back before children.
  `CREATE TABLE program_sessions_copy AS SELECT * FROM program_sessions;
CREATE TABLE session_steps_copy AS SELECT * FROM session_steps;
DROP TABLE session_steps;
DROP TABLE program_sessions;
CREATE TABLE program_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  program_id TEXT NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
  week INTEGER NOT NULL CHECK (week >= 1),
  position INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('easy', 'long', 'intervals', 'tempo', 'free', 'walk', 'runwalk', 'rest')),
  title TEXT NOT NULL,
  notes TEXT
);
CREATE TABLE session_steps (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES program_sessions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('warmup', 'run', 'walk', 'recovery', 'repeat', 'cooldown')),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('none', 'duration', 'distance')),
  target_value REAL,
  pace_min REAL,
  pace_max REAL,
  repetitions INTEGER,
  span INTEGER
);
INSERT INTO program_sessions (id, program_id, week, position, type, title, notes)
  SELECT id, program_id, week, position, type, title, notes FROM program_sessions_copy;
INSERT INTO session_steps (id, session_id, position, kind, target_kind, target_value, pace_min, pace_max, repetitions, span)
  SELECT id, session_id, position, kind, target_kind, target_value, pace_min, pace_max, repetitions, span FROM session_steps_copy;
DROP TABLE session_steps_copy;
DROP TABLE program_sessions_copy;
CREATE INDEX program_sessions_program ON program_sessions (program_id, week, position);
CREATE INDEX session_steps_session ON session_steps (session_id, position);
`,
  // The session a run was started from (#40); one run per session until migration 7. Deleting the session or its
  // program keeps the run and clears the link. Note for later migrations: rebuilding
  // program_sessions as migration 4 did now clears every run's link, because DROP TABLE runs the
  // ON DELETE actions, so such a rebuild must save runs.session_id first and put it back after.
  // Migration 7 later allowed several runs per session.
  `ALTER TABLE runs ADD COLUMN session_id TEXT REFERENCES program_sessions(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX runs_session ON runs (session_id);
`,
  // The steps of a session as they were run (#101): a copy of each step's plan, with where in the
  // run it started and ended. No CHECK on kind, so a new step kind needs no table rebuild (the
  // code checks it). Deleting the run deletes its steps.
  `CREATE TABLE run_steps (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_value REAL,
  pace_min REAL,
  pace_max REAL,
  repetition INTEGER,
  repetitions INTEGER,
  started_elapsed_ms INTEGER NOT NULL,
  started_distance_m REAL NOT NULL,
  ended_elapsed_ms INTEGER,
  ended_distance_m REAL,
  PRIMARY KEY (run_id, position)
);
`,
  // Several runs per session (#116): a redo links to the same session as the first run. The
  // unique index of migration 5 becomes a plain one; the column and every link stay as they are.
  `DROP INDEX runs_session;
CREATE INDEX runs_session ON runs (session_id);
`,
]

export async function schemaVersion(db: SqlDb): Promise<number> {
  const result = await db.query('PRAGMA user_version;')
  return Number(result.values?.[0]?.user_version ?? 0)
}

/**
 * Bring the schema up to date. The version lives in `PRAGMA user_version`; each migration and
 * its version bump go in one `execute`, which the plugin wraps in a transaction.
 */
export async function migrate(db: SqlDb): Promise<number> {
  const current = await schemaVersion(db)
  if (current > MIGRATIONS.length) {
    throw new Error(`Database version ${current} is newer than this app (${MIGRATIONS.length})`)
  }
  for (let version = current + 1; version <= MIGRATIONS.length; version++) {
    await db.execute(`${MIGRATIONS[version - 1]}PRAGMA user_version = ${version};\n`)
    console.info('[db] migrated to version', version)
  }
  return MIGRATIONS.length
}
