const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const cookieSession = require("cookie-session");

const { requireAuth, requireAdmin } = require("./auth");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const progressRoutes = require("./routes/progress");

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (IS_PROD && !process.env.SESSION_SECRET) {
  console.warn("WARNING: SESSION_SECRET not set — sessions will reset on every restart/deploy.");
}

app.set("trust proxy", 1);
app.use(express.json());
app.use(
  cookieSession({
    name: "sdp_session",
    secret: SESSION_SECRET,
    maxAge: 90 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PROD,
  })
);

const PUBLIC_DIR = path.join(__dirname, "..", "public");

// Public assets that don't require auth (login/register pages only)
app.get(["/login.html", "/register.html"], (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, req.path));
});

// Auth API (login/register themselves are public)
app.use("/api/auth", authRoutes);

// Everything below requires a logged-in user
app.use(requireAuth);

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});
app.get("/admin.html", requireAdmin, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

// Everything else in public/ (app.js, data.js, index.html, media/*) requires the session above
app.use(express.static(PUBLIC_DIR, { index: false }));

app.use("/api/progress", progressRoutes);
app.use("/api/admin", requireAdmin, adminRoutes);

app.listen(PORT, () => {
  console.log(`סדר דין פלילי — האפליקציה רצה על http://localhost:${PORT}`);
});
