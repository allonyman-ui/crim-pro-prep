const express = require("express");
const db = require("../db");
const { TOTAL_FLASHCARDS, TOTAL_MCQ, TOTAL_CHAPTERS } = require("../content-totals");

const router = express.Router();

function computeStreak(userId) {
  const rows = db.prepare("SELECT day FROM activity_days WHERE user_id = ? ORDER BY day DESC").all(userId);
  if (!rows.length) return 0;
  const days = new Set(rows.map((r) => r.day));
  let streak = 0;
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  // allow today or yesterday as the most recent anchor
  const todayStr = cursor.toISOString().slice(0, 10);
  if (!days.has(todayStr)) cursor.setDate(cursor.getDate() - 1);
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function progressPct(cardsSeen, quizStats) {
  const flashcardRatio = TOTAL_FLASHCARDS ? cardsSeen.length / TOTAL_FLASHCARDS : 0;
  const quizRatio = TOTAL_MCQ ? quizStats.answered / TOTAL_MCQ : 0;
  return Math.min(100, Math.round(((flashcardRatio + quizRatio) / 2) * 100));
}

function achievementsFor({ cardsSeen, quizStats, chaptersOpened, streak }) {
  const list = [];
  if (quizStats.answered >= 1) list.push({ icon: "🎯", label: "צעד ראשון" });
  if (cardsSeen.length >= TOTAL_FLASHCARDS && TOTAL_FLASHCARDS > 0) list.push({ icon: "🃏", label: "כל הכרטיסיות" });
  if (quizStats.answered >= TOTAL_MCQ && TOTAL_MCQ > 0) list.push({ icon: "✅", label: "כל השאלות נענו" });
  if (quizStats.answered >= 15 && quizStats.correct / quizStats.answered >= 0.9)
    list.push({ icon: "🏆", label: "דיוק של 90%+" });
  if (chaptersOpened.length >= TOTAL_CHAPTERS && TOTAL_CHAPTERS > 0) list.push({ icon: "📚", label: "כל הפרקים נפתחו" });
  if (streak >= 3) list.push({ icon: "🔥", label: "רצף 3 ימים" });
  if (streak >= 7) list.push({ icon: "🔥", label: "רצף 7 ימים" });
  return list;
}

router.get("/me", (req, res) => {
  const row = db.prepare("SELECT * FROM progress WHERE user_id = ?").get(req.user.id);
  const cardsSeen = JSON.parse((row && row.cards_seen) || "[]");
  const quizStats = JSON.parse((row && row.quiz_stats) || '{"answered":0,"correct":0}');
  const chaptersOpened = JSON.parse((row && row.chapters_opened) || "[]");
  const lastTab = row ? row.last_tab : null;
  const streak = computeStreak(req.user.id);
  res.json({
    cardsSeen,
    quizStats,
    chaptersOpened,
    lastTab,
    streak,
    progressPct: progressPct(cardsSeen, quizStats),
    achievements: achievementsFor({ cardsSeen, quizStats, chaptersOpened, streak }),
  });
});

router.post("/me", (req, res) => {
  const { cardsSeen, quizStats, chaptersOpened, lastTab } = req.body || {};
  const existing = db.prepare("SELECT user_id FROM progress WHERE user_id = ?").get(req.user.id);
  const payload = {
    cards_seen: JSON.stringify(Array.isArray(cardsSeen) ? cardsSeen : []),
    quiz_stats: JSON.stringify(
      quizStats && typeof quizStats.answered === "number" ? quizStats : { answered: 0, correct: 0 }
    ),
    chapters_opened: JSON.stringify(Array.isArray(chaptersOpened) ? chaptersOpened : []),
    last_tab: typeof lastTab === "string" ? lastTab : null,
  };
  if (existing) {
    db.prepare(
      "UPDATE progress SET cards_seen=?, quiz_stats=?, chapters_opened=?, last_tab=?, updated_at=datetime('now') WHERE user_id=?"
    ).run(payload.cards_seen, payload.quiz_stats, payload.chapters_opened, payload.last_tab, req.user.id);
  } else {
    db.prepare(
      "INSERT INTO progress (user_id, cards_seen, quiz_stats, chapters_opened, last_tab) VALUES (?, ?, ?, ?, ?)"
    ).run(req.user.id, payload.cards_seen, payload.quiz_stats, payload.chapters_opened, payload.last_tab);
  }
  res.json({ ok: true });
});

router.get("/leaderboard", (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.first_name, p.cards_seen, p.quiz_stats, p.chapters_opened
       FROM users u LEFT JOIN progress p ON p.user_id = u.id`
    )
    .all();

  const board = rows.map((r) => {
    const cardsSeen = JSON.parse(r.cards_seen || "[]");
    const quizStats = JSON.parse(r.quiz_stats || '{"answered":0,"correct":0}');
    const chaptersOpened = JSON.parse(r.chapters_opened || "[]");
    const streak = computeStreak(r.id);
    return {
      firstName: r.first_name,
      progressPct: progressPct(cardsSeen, quizStats),
      quizAccuracy: quizStats.answered ? Math.round((quizStats.correct / quizStats.answered) * 100) : 0,
      streak,
      achievements: achievementsFor({ cardsSeen, quizStats, chaptersOpened, streak }),
      isMe: r.id === req.user.id,
    };
  });

  board.sort((a, b) => b.progressPct - a.progressPct || b.quizAccuracy - a.quizAccuracy);
  res.json({ leaderboard: board.slice(0, 50) });
});

module.exports = router;
