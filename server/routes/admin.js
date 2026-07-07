const express = require("express");
const crypto = require("node:crypto");
const db = require("../db");
const { TOTAL_FLASHCARDS, TOTAL_MCQ } = require("../content-totals");

const router = express.Router();

router.post("/invites", (req, res) => {
  const token = crypto.randomBytes(16).toString("hex");
  const note = (req.body && req.body.note) || null;
  db.prepare("INSERT INTO invites (token, note, created_by) VALUES (?, ?, ?)").run(token, note, req.user.id);
  res.json({ ok: true, token });
});

router.get("/invites", (req, res) => {
  const rows = db
    .prepare(
      `SELECT i.id, i.token, i.note, i.created_at, i.used_at,
              u.first_name AS used_first_name, u.last_name AS used_last_name
       FROM invites i LEFT JOIN users u ON u.id = i.used_by
       ORDER BY i.created_at DESC`
    )
    .all();
  res.json({ invites: rows });
});

router.delete("/invites/:id", (req, res) => {
  db.prepare("DELETE FROM invites WHERE id = ? AND used_by IS NULL").run(req.params.id);
  res.json({ ok: true });
});

router.get("/users", (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.is_admin, u.created_at, u.last_seen_at,
              p.cards_seen, p.quiz_stats, p.chapters_opened, p.updated_at AS progress_updated_at
       FROM users u LEFT JOIN progress p ON p.user_id = u.id
       ORDER BY u.created_at DESC`
    )
    .all();

  const users = rows.map((r) => {
    const cardsSeen = JSON.parse(r.cards_seen || "[]");
    const quizStats = JSON.parse(r.quiz_stats || '{"answered":0,"correct":0}');
    const chaptersOpened = JSON.parse(r.chapters_opened || "[]");
    const flashcardRatio = TOTAL_FLASHCARDS ? cardsSeen.length / TOTAL_FLASHCARDS : 0;
    const quizRatio = TOTAL_MCQ ? quizStats.answered / TOTAL_MCQ : 0;
    const progressPct = Math.round(((flashcardRatio + quizRatio) / 2) * 100);
    return {
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      isAdmin: !!r.is_admin,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      cardsSeenCount: cardsSeen.length,
      chaptersOpenedCount: chaptersOpened.length,
      quizAnswered: quizStats.answered,
      quizCorrect: quizStats.correct,
      quizAccuracy: quizStats.answered ? Math.round((quizStats.correct / quizStats.answered) * 100) : 0,
      progressPct: Math.min(100, progressPct),
    };
  });

  res.json({ users });
});

router.post("/users/:id/admin", (req, res) => {
  const makeAdmin = !!(req.body && req.body.isAdmin);
  db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(makeAdmin ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.delete("/users/:id", (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user.id) return res.status(400).json({ error: "cannot_delete_self" });
  db.prepare("DELETE FROM progress WHERE user_id = ?").run(targetId);
  db.prepare("DELETE FROM activity_days WHERE user_id = ?").run(targetId);
  db.prepare("UPDATE invites SET used_by = NULL, used_at = NULL WHERE used_by = ?").run(targetId);
  db.prepare("DELETE FROM users WHERE id = ?").run(targetId);
  res.json({ ok: true });
});

module.exports = router;
