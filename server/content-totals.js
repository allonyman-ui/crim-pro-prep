const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "..", "public", "data.js"), "utf8");
const sandbox = { DATA: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

module.exports = {
  TOTAL_FLASHCARDS: (sandbox.DATA.flashcards || []).length,
  TOTAL_MCQ: (sandbox.DATA.mcq || []).length,
  TOTAL_CHAPTERS: (sandbox.DATA.chapters || []).length,
};
