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
`);

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

function ensureAdmin(email) {
  if (!email || findUser(email)) return false;
  createUser({ email, role: "ADMIN", campus: null }, "sistema");
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

module.exports = {
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
