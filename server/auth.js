const db = require("./db");

function requireAuth(req, res, next) {
  const uid = req.session && req.session.userId;
  if (!uid) {
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "not_authenticated" });
    return res.redirect("/login.html");
  }
  const user = db.prepare("SELECT id, first_name, last_name, email, is_admin FROM users WHERE id = ?").get(uid);
  if (!user) {
    req.session = null;
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "not_authenticated" });
    return res.redirect("/login.html");
  }
  req.user = user;
  db.prepare("UPDATE users SET last_seen_at = datetime('now') WHERE id = ?").run(uid);
  const today = new Date().toISOString().slice(0, 10);
  db.prepare("INSERT OR IGNORE INTO activity_days (user_id, day) VALUES (?, ?)").run(uid, today);
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    if (req.path.startsWith("/api/")) return res.status(403).json({ error: "forbidden" });
    return res.status(403).send("אין הרשאת מנהל");
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
