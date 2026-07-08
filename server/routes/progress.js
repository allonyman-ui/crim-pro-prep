const express = require("express");
const db = require("../db");
const { TOTAL_FLASHCARDS, TOTAL_MCQ, TOTAL_CHAPTERS } = require("../content-totals");
const { computeSimGrades } = require("../sim-grades");

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

function achievementsFor({ cardsSeen, quizStats, chaptersOpened, streak, timeSpentSec = 0 }) {
  const list = [];
  if (quizStats.answered >= 1) list.push({ icon: "🎯", label: "צעד ראשון" });
  if (cardsSeen.length >= TOTAL_FLASHCARDS && TOTAL_FLASHCARDS > 0) list.push({ icon: "🃏", label: "כל הכרטיסיות" });
  if (quizStats.answered >= TOTAL_MCQ && TOTAL_MCQ > 0) list.push({ icon: "✅", label: "כל השאלות נענו" });
  if (quizStats.answered >= 15 && quizStats.correct / quizStats.answered >= 0.9)
    list.push({ icon: "🏆", label: "דיוק של 90%+" });
  if (chaptersOpened.length >= TOTAL_CHAPTERS && TOTAL_CHAPTERS > 0) list.push({ icon: "📚", label: "כל הפרקים נפתחו" });
  if (streak >= 3) list.push({ icon: "🔥", label: "רצף 3 ימים" });
  if (streak >= 7) list.push({ icon: "🔥", label: "רצף 7 ימים" });
  if (timeSpentSec >= 3600) list.push({ icon: "⏱️", label: "שעה של תרגול" });
  if (timeSpentSec >= 36000) list.push({ icon: "⏳", label: "10 שעות תרגול" });
  return list;
}

router.get("/me", (req, res) => {
  const row = db.prepare("SELECT * FROM progress WHERE user_id = ?").get(req.user.id);
  const cardsSeen = JSON.parse((row && row.cards_seen) || "[]");
  const quizStats = JSON.parse((row && row.quiz_stats) || '{"answered":0,"correct":0}');
  const chaptersOpened = JSON.parse((row && row.chapters_opened) || "[]");
  const topicStats = JSON.parse((row && row.topic_stats) || "{}");
  const openGrades = JSON.parse((row && row.open_grades) || "{}");
  const lastTab = row ? row.last_tab : null;
  const timeSpentSec = row ? row.time_spent_sec || 0 : 0;
  const streak = computeStreak(req.user.id);
  const simGrades = computeSimGrades(openGrades);
  res.json({
    cardsSeen,
    quizStats,
    chaptersOpened,
    topicStats,
    openGrades,
    lastTab,
    streak,
    timeSpentSec,
    progressPct: progressPct(cardsSeen, quizStats),
    achievements: achievementsFor({ cardsSeen, quizStats, chaptersOpened, streak, timeSpentSec }),
    simGrades: simGrades.perSim,
    simsAttempted: simGrades.simsAttempted,
    simsTotal: simGrades.simsTotal,
    avgSimGrade: simGrades.avgSimGrade,
  });
});

router.post("/heartbeat", (req, res) => {
  const existing = db.prepare("SELECT user_id FROM progress WHERE user_id = ?").get(req.user.id);
  if (existing) {
    db.prepare(
      "UPDATE progress SET time_spent_sec = time_spent_sec + 30, updated_at = datetime('now') WHERE user_id = ?"
    ).run(req.user.id);
  } else {
    db.prepare("INSERT INTO progress (user_id, time_spent_sec) VALUES (?, 30)").run(req.user.id);
  }
  const row = db.prepare("SELECT time_spent_sec FROM progress WHERE user_id = ?").get(req.user.id);
  res.json({ ok: true, timeSpentSec: row.time_spent_sec });
});

router.post("/me", (req, res) => {
  const { cardsSeen, quizStats, chaptersOpened, topicStats, openGrades, lastTab } = req.body || {};
  const existing = db.prepare("SELECT user_id FROM progress WHERE user_id = ?").get(req.user.id);
  const payload = {
    cards_seen: JSON.stringify(Array.isArray(cardsSeen) ? cardsSeen : []),
    quiz_stats: JSON.stringify(
      quizStats && typeof quizStats.answered === "number" ? quizStats : { answered: 0, correct: 0 }
    ),
    chapters_opened: JSON.stringify(Array.isArray(chaptersOpened) ? chaptersOpened : []),
    topic_stats: JSON.stringify(topicStats && typeof topicStats === "object" ? topicStats : {}),
    open_grades: JSON.stringify(openGrades && typeof openGrades === "object" ? openGrades : {}),
    last_tab: typeof lastTab === "string" ? lastTab : null,
  };
  if (existing) {
    db.prepare(
      "UPDATE progress SET cards_seen=?, quiz_stats=?, chapters_opened=?, topic_stats=?, open_grades=?, last_tab=?, updated_at=datetime('now') WHERE user_id=?"
    ).run(
      payload.cards_seen,
      payload.quiz_stats,
      payload.chapters_opened,
      payload.topic_stats,
      payload.open_grades,
      payload.last_tab,
      req.user.id
    );
  } else {
    db.prepare(
      "INSERT INTO progress (user_id, cards_seen, quiz_stats, chapters_opened, topic_stats, open_grades, last_tab) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      req.user.id,
      payload.cards_seen,
      payload.quiz_stats,
      payload.chapters_opened,
      payload.topic_stats,
      payload.open_grades,
      payload.last_tab
    );
  }
  res.json({ ok: true });
});

router.get("/leaderboard", (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.first_name, p.cards_seen, p.quiz_stats, p.chapters_opened, p.time_spent_sec, p.open_grades
       FROM users u LEFT JOIN progress p ON p.user_id = u.id`
    )
    .all();

  const board = rows.map((r) => {
    const cardsSeen = JSON.parse(r.cards_seen || "[]");
    const quizStats = JSON.parse(r.quiz_stats || '{"answered":0,"correct":0}');
    const chaptersOpened = JSON.parse(r.chapters_opened || "[]");
    const openGrades = JSON.parse(r.open_grades || "{}");
    const streak = computeStreak(r.id);
    const simGrades = computeSimGrades(openGrades);
    return {
      firstName: r.first_name,
      progressPct: progressPct(cardsSeen, quizStats),
      quizAnswered: quizStats.answered,
      quizCorrect: quizStats.correct,
      quizAccuracy: quizStats.answered ? Math.round((quizStats.correct / quizStats.answered) * 100) : 0,
      cardsSeenCount: cardsSeen.length,
      chaptersOpenedCount: chaptersOpened.length,
      timeSpentSec: r.time_spent_sec || 0,
      streak,
      simsAttempted: simGrades.simsAttempted,
      simsTotal: simGrades.simsTotal,
      avgSimGrade: simGrades.avgSimGrade,
      achievements: achievementsFor({ cardsSeen, quizStats, chaptersOpened, streak, timeSpentSec: r.time_spent_sec || 0 }),
      isMe: r.id === req.user.id,
    };
  });

  board.sort((a, b) => b.progressPct - a.progressPct || b.quizAccuracy - a.quizAccuracy);
  res.json({ leaderboard: board.slice(0, 50) });
});

module.exports = router;
