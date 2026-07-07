const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const db = require("../db");

const router = express.Router();

router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "missing_fields" });
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email).trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "invalid_credentials" });
  }
  req.session.userId = user.id;
  res.json({ ok: true, isAdmin: !!user.is_admin });
});

router.post("/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

router.get("/invite/:token", (req, res) => {
  const invite = db.prepare("SELECT * FROM invites WHERE token = ?").get(req.params.token);
  if (!invite) return res.status(404).json({ error: "invite_not_found" });
  if (invite.used_by) return res.status(410).json({ error: "invite_used" });
  res.json({ ok: true });
});

router.post("/register", (req, res) => {
  const { token, firstName, lastName, email, password } = req.body || {};
  if (!token || !firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: "missing_fields" });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "weak_password" });
  }
  const invite = db.prepare("SELECT * FROM invites WHERE token = ?").get(token);
  if (!invite) return res.status(404).json({ error: "invite_not_found" });
  if (invite.used_by) return res.status(410).json({ error: "invite_used" });

  const normEmail = String(email).trim().toLowerCase();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normEmail);
  if (existing) return res.status(409).json({ error: "email_taken" });

  const hash = bcrypt.hashSync(password, 10);
  const result = db
    .prepare("INSERT INTO users (first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?)")
    .run(String(firstName).trim(), String(lastName).trim(), normEmail, hash);
  const userId = result.lastInsertRowid;
  db.prepare("INSERT INTO progress (user_id) VALUES (?)").run(userId);
  db.prepare("UPDATE invites SET used_by = ?, used_at = datetime('now') WHERE id = ?").run(userId, invite.id);

  req.session.userId = userId;
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  const uid = req.session && req.session.userId;
  if (!uid) return res.status(401).json({ error: "not_authenticated" });
  const user = db.prepare("SELECT id, first_name, last_name, email, is_admin FROM users WHERE id = ?").get(uid);
  if (!user) return res.status(401).json({ error: "not_authenticated" });
  res.json({ user });
});

module.exports = router;
