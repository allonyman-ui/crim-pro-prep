const { SIM_META } = require("./content-totals");

// Suggested per-simulation grade from the user's own MCQ answers + self-graded open questions.
// Reads the openGrades blob, keyed "<simId>:q<i>" for open questions and "<simId>:m<i>" for MCQs.
function computeSimGrades(openGrades) {
  const perSim = SIM_META.map((meta) => {
    let answered = 0;
    let scoreSum = 0;
    for (let i = 0; i < meta.openCount; i++) {
      const g = openGrades[`${meta.id}:q${i}`];
      if (g && typeof g.score === "number") {
        answered++;
        scoreSum += g.score;
      }
    }
    for (let i = 0; i < meta.mcqCount; i++) {
      const g = openGrades[`${meta.id}:m${i}`];
      if (g && typeof g.score === "number") {
        answered++;
        scoreSum += g.score;
      }
    }
    const total = meta.openCount + meta.mcqCount;
    const pct = answered ? Math.round((scoreSum / answered) * 100) : null;
    return { id: meta.id, title: meta.title, real: meta.real, answered, total, pct };
  });
  const attempted = perSim.filter((s) => s.answered > 0);
  const avgSimGrade = attempted.length
    ? Math.round(attempted.reduce((a, s) => a + s.pct, 0) / attempted.length)
    : null;
  return { perSim, simsAttempted: attempted.length, simsTotal: SIM_META.length, avgSimGrade };
}

module.exports = { computeSimGrades };
