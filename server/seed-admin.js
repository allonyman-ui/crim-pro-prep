const bcrypt = require("bcryptjs");
const db = require("./db");

const [, , email, password, firstName, lastName] = process.argv;

if (!email || !password) {
  console.error("Usage: node server/seed-admin.js <email> <password> [firstName] [lastName]");
  process.exit(1);
}

const normEmail = email.trim().toLowerCase();
const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normEmail);
const hash = bcrypt.hashSync(password, 10);

if (existing) {
  db.prepare("UPDATE users SET password_hash = ?, is_admin = 1 WHERE id = ?").run(hash, existing.id);
  console.log(`Updated existing user ${normEmail} -> admin, password reset.`);
} else {
  const result = db
    .prepare("INSERT INTO users (first_name, last_name, email, password_hash, is_admin) VALUES (?, ?, ?, ?, 1)")
    .run(firstName || "מנהל", lastName || "", normEmail, hash);
  db.prepare("INSERT INTO progress (user_id) VALUES (?)").run(result.lastInsertRowid);
  console.log(`Created admin user ${normEmail} (id ${result.lastInsertRowid}).`);
}
