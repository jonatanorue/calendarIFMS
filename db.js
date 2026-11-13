const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const databasePath = process.env.DATABASE_PATH || path.join(__dirname, "data", "calendar.db");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('REITORIA', 'CAMPUS', 'ADMIN')),
    campus TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT NOT NULL,
    CHECK ((role = 'CAMPUS') = (campus IS NOT NULL))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE ON UPDATE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS academic_years (
    id TEXT PRIMARY KEY,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    base_published INTEGER NOT NULL DEFAULT 0,
    final_published INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT NOT NULL,
    CHECK (end_date > start_date)
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('REITORIA', 'CAMPUS')),
    course TEXT NOT NULL DEFAULT '',
    semester INTEGER CHECK (semester IN (1, 2)),
    affects_school_day INTEGER NOT NULL DEFAULT 0,
    campus TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (end_date >= start_date)
  );
  CREATE INDEX IF NOT EXISTS events_year ON events(year_id, start_date);

  CREATE TABLE IF NOT EXISTS campus_status (
    year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    campus TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('Em edição', 'Pendente', 'Aprovado', 'Rejeitado')),
    submitted_at TEXT,
    reason TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (year_id, campus)
  );

  CREATE TABLE IF NOT EXISTS status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    campus TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    changed_by TEXT NOT NULL,
    changed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Auditoria gravada só pelo servidor, com o usuário da sessão. Sem chave estrangeira,
  -- para o registro continuar existindo mesmo se o ano ou o usuário forem removidos.
  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    user_email TEXT NOT NULL,
    year_id TEXT,
    action TEXT NOT NULL,
    old_value TEXT NOT NULL DEFAULT '-',
    new_value TEXT NOT NULL DEFAULT '-'
  );
`);

// Data de criação do banco: se mudar a cada deploy, o banco está sendo recriado (sem volume).
db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('created_at', datetime('now'))").run();

// Ajustes em bancos criados por versões anteriores.
if (!db.prepare("PRAGMA table_info(events)").all().some((column) => column.name === "swap_date")) {
  db.exec("ALTER TABLE events ADD COLUMN swap_date TEXT");
}
db.prepare("UPDATE events SET type = 'Feriado Estadual' WHERE type = 'Feriado Estadual/Local'").run();

const userColumns = "email, role, campus, created_at AS createdAt, created_by AS createdBy";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function listUsers() {
  return db.prepare(`SELECT ${userColumns} FROM users ORDER BY email`).all();
}

function findUser(email) {
  return db.prepare(`SELECT ${userColumns} FROM users WHERE email = ?`).get(email);
}

function createUser({ email, role, campus }, createdBy) {
  db.prepare("INSERT INTO users (email, role, campus, created_by) VALUES (?, ?, ?, ?)").run(email, role, campus, createdBy);
  return findUser(email);
}

function updateUser(originalEmail, { email, role, campus }) {
  db.prepare("UPDATE users SET email = ?, role = ?, campus = ? WHERE email = ?").run(email, role, campus, originalEmail);
  return findUser(email);
}

function deleteUser(email) {
  db.prepare("DELETE FROM users WHERE email = ?").run(email);
}

function countAdmins() {
  return db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'ADMIN'").get().total;
}

// Só cadastra o administrador inicial enquanto o banco não tiver nenhum administrador,
// para que um administrador removido não volte ao reiniciar o servidor.
function ensureAdmin(email) {
  if (!email || countAdmins() > 0) return false;
  if (findUser(email)) {
    db.prepare("UPDATE users SET role = 'ADMIN', campus = NULL WHERE email = ?").run(email);
  } else {
    createUser({ email, role: "ADMIN", campus: null }, "sistema");
  }
  return true;
}

function createSession(email, maxAgeSeconds) {
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  db.prepare("INSERT INTO sessions (token_hash, email, expires_at) VALUES (?, ?, ?)").run(
    hashToken(token),
    email,
    Date.now() + maxAgeSeconds * 1000,
  );
  return token;
}

function findSessionUser(token) {
  return db
    .prepare(
      `SELECT u.email, u.role, u.campus FROM sessions s
       JOIN users u ON u.email = s.email
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hashToken(token), Date.now());
}

function deleteSession(token) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

// Executa várias escritas como uma só: ou todas são gravadas, ou nenhuma.
// Pode ser chamada dentro de outra transação; aí só a mais externa confirma.
let transactionDepth = 0;
function transaction(work) {
  if (transactionDepth > 0) return work();
  db.exec("BEGIN");
  transactionDepth += 1;
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    transactionDepth -= 1;
  }
}

const yearColumns = `id, start_date AS start, end_date AS end, base_published AS basePublished,
  final_published AS finalPublished, created_at AS createdAt, created_by AS createdBy`;
const eventColumns = `id, type, title, start_date AS start, end_date AS end, scope, course, semester,
  affects_school_day AS affectsSchoolDay, campus, swap_date AS swapDate, updated_by AS updatedBy, updated_at AS updatedAt`;

function toYear(row) {
  return row && { ...row, basePublished: Boolean(row.basePublished), finalPublished: Boolean(row.finalPublished) };
}

function toEvent(row) {
  return row && { ...row, affectsSchoolDay: Boolean(row.affectsSchoolDay), swapDate: row.swapDate || null };
}

function listYears() {
  return db.prepare(`SELECT ${yearColumns} FROM academic_years ORDER BY start_date DESC`).all().map(toYear);
}

function getYear(id) {
  return toYear(db.prepare(`SELECT ${yearColumns} FROM academic_years WHERE id = ?`).get(id));
}

function insertEventRow(yearId, event, by) {
  db.prepare(
    `INSERT INTO events (id, year_id, type, title, start_date, end_date, scope, course, semester, affects_school_day, campus, swap_date, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.id || crypto.randomUUID(),
    yearId,
    event.type,
    event.title,
    event.start,
    event.end,
    event.scope,
    event.course || "",
    event.semester ?? null,
    event.affectsSchoolDay ? 1 : 0,
    event.campus || "",
    event.swapDate || null,
    by,
    by,
  );
}

function createYear({ start, end }, events, campuses, by) {
  return transaction(() => {
    db.prepare("INSERT INTO academic_years (id, start_date, end_date, created_by) VALUES (?, ?, ?, ?)").run(start, start, end, by);
    const statement = db.prepare("INSERT INTO campus_status (year_id, campus, status) VALUES (?, ?, 'Em edição')");
    campuses.forEach((campus) => statement.run(start, campus));
    events.forEach((event) => insertEventRow(start, { ...event, id: crypto.randomUUID() }, by));
    return getYear(start);
  });
}

function updateYearPeriod(id, { start, end }) {
  db.prepare("UPDATE academic_years SET start_date = ?, end_date = ? WHERE id = ?").run(start, end, id);
  return getYear(id);
}

// Remove o ano com eventos, status e histórico (ON DELETE CASCADE). A auditoria é mantida.
function deleteYear(id) {
  db.prepare("DELETE FROM academic_years WHERE id = ?").run(id);
}

function setYearFlags(id, { basePublished, finalPublished }) {
  if (basePublished !== undefined) db.prepare("UPDATE academic_years SET base_published = ? WHERE id = ?").run(basePublished ? 1 : 0, id);
  if (finalPublished !== undefined) db.prepare("UPDATE academic_years SET final_published = ? WHERE id = ?").run(finalPublished ? 1 : 0, id);
  return getYear(id);
}

function listEvents(yearId) {
  return db.prepare(`SELECT ${eventColumns} FROM events WHERE year_id = ? ORDER BY start_date, title`).all(yearId).map(toEvent);
}

function getEvent(yearId, id) {
  return toEvent(db.prepare(`SELECT ${eventColumns} FROM events WHERE year_id = ? AND id = ?`).get(yearId, id));
}

function createEvent(yearId, event, by) {
  const id = crypto.randomUUID();
  insertEventRow(yearId, { ...event, id }, by);
  return getEvent(yearId, id);
}

function updateEvent(yearId, id, event, by) {
  db.prepare(
    `UPDATE events SET type = ?, title = ?, start_date = ?, end_date = ?, scope = ?, course = ?, semester = ?,
       affects_school_day = ?, campus = ?, swap_date = ?, updated_by = ?, updated_at = datetime('now')
     WHERE year_id = ? AND id = ?`,
  ).run(event.type, event.title, event.start, event.end, event.scope, event.course || "", event.semester ?? null, event.affectsSchoolDay ? 1 : 0, event.campus || "", event.swapDate || null, by, yearId, id);
  return getEvent(yearId, id);
}

function deleteEvent(yearId, id) {
  db.prepare("DELETE FROM events WHERE year_id = ? AND id = ?").run(yearId, id);
}

function getCampusStatuses(yearId) {
  const statuses = {};
  db.prepare("SELECT campus, status, submitted_at AS submittedAt, reason FROM campus_status WHERE year_id = ?")
    .all(yearId)
    .forEach((row) => (statuses[row.campus] = { status: row.status, submittedAt: row.submittedAt || "", reason: row.reason, history: [] }));
  db.prepare("SELECT campus, status, reason, changed_by AS by, changed_at AS at FROM status_history WHERE year_id = ? ORDER BY id")
    .all(yearId)
    .forEach((row) => statuses[row.campus]?.history.push({ status: row.status, reason: row.reason, by: row.by, at: row.at }));
  return statuses;
}

function setCampusStatus(yearId, campus, { status, reason = "" }, by) {
  transaction(() => {
    const submittedAt = status === "Pendente" ? "datetime('now')" : "submitted_at";
    db.prepare(`UPDATE campus_status SET status = ?, reason = ?, submitted_at = ${submittedAt} WHERE year_id = ? AND campus = ?`).run(status, reason, yearId, campus);
    db.prepare("INSERT INTO status_history (year_id, campus, status, reason, changed_by) VALUES (?, ?, ?, ?, ?)").run(yearId, campus, status, reason, by);
  });
}

function addAudit({ user, yearId = null, action, oldValue = "-", newValue = "-" }) {
  db.prepare("INSERT INTO audit (user_email, year_id, action, old_value, new_value) VALUES (?, ?, ?, ?, ?)").run(user, yearId, action, String(oldValue), String(newValue));
}

function listAudit(limit = 500) {
  return db
    .prepare(
      `SELECT a.at, a.user_email AS user, a.action, a.old_value AS oldValue, a.new_value AS newValue,
         y.start_date AS yearStart, y.end_date AS yearEnd
       FROM audit a LEFT JOIN academic_years y ON y.id = a.year_id
       ORDER BY a.id DESC LIMIT ?`,
    )
    .all(limit);
}

function databaseInfo() {
  const count = (table) => db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total;
  let sizeBytes = 0;
  try {
    sizeBytes = fs.statSync(databasePath).size;
  } catch {
    // arquivo ainda não gravado
  }
  return {
    path: path.resolve(databasePath),
    sizeBytes,
    createdAt: db.prepare("SELECT value FROM meta WHERE key = 'created_at'").get()?.value || null,
    counts: { users: count("users"), years: count("academic_years"), events: count("events"), audit: count("audit") },
  };
}

// Apaga registros de auditoria mais antigos que o prazo definido (em dias). 0 mantém tudo.
function purgeAudit(days) {
  if (!days || days <= 0) return 0;
  return Number(db.prepare("DELETE FROM audit WHERE at < datetime('now', ?)").run(`-${Math.floor(days)} days`).changes);
}

// Cópia consistente do banco num arquivo novo, mesmo com o sistema em uso.
function backupTo(file) {
  db.prepare("VACUUM INTO ?").run(file);
}

module.exports = {
  databasePath,
  databaseInfo,
  backupTo,
  purgeAudit,
  transaction,
  listYears,
  getYear,
  createYear,
  updateYearPeriod,
  deleteYear,
  setYearFlags,
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  getCampusStatuses,
  setCampusStatus,
  addAudit,
  listAudit,
  listUsers,
  findUser,
  createUser,
  updateUser,
  deleteUser,
  countAdmins,
  ensureAdmin,
  createSession,
  findSessionUser,
  deleteSession,
};
