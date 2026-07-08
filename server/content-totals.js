const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "..", "public", "data.js"), "utf8");
const sandbox = { DATA: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const SIM_META = (sandbox.DATA.sims || []).map((s) => ({
  id: s.id,
  title: s.title,
  real: !!s.real,
  openCount: (s.questions || []).length,
  mcqCount: (s.mcq || []).length,
}));

module.exports = {
  TOTAL_FLASHCARDS: (sandbox.DATA.flashcards || []).length,
  TOTAL_MCQ: (sandbox.DATA.mcq || []).length,
  TOTAL_CHAPTERS: (sandbox.DATA.chapters || []).length,
  SIM_META,
};
