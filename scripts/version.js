// ============================================================
//  توليد رقم الإصدار تلقائياً — بيشتغل قبل كل رفع (predeploy)
//  الرقم الأساسي (major.minor) من config.js، والباقي بيتولّد لوحده
// ============================================================
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");

// 1) الرقم الأساسي من config.js (major.minor بس)
let base = "2.0";
try {
  const cfg = fs.readFileSync(path.join(root, "js/config.js"), "utf8");
  const m = cfg.match(/APP_VERSION\s*=\s*["']([\d.]+)["']/);
  if (m) base = m[1].split(".").slice(0, 2).join("."); // ناخد أول رقمين بس
} catch { /* افتراضي */ }

// 2) رقم البناء = عدد الـ commits (بيزيد لوحده مع كل رفع)
let build = 0;
try { build = parseInt(execSync("git rev-list --count HEAD", { cwd: root }).toString().trim(), 10) || 0; }
catch { /* مفيش git */ }

// 3) هاش قصير للتتبّع
let commit = "";
try { commit = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim(); }
catch { /* تجاهل */ }

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const builtAt = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;

const version = `${base}.${build}`;      // مثال: 2.9
const full = `v${version}`;              // مثال: v2.9

const data = { version, full, build, commit, builtAt, base };

fs.writeFileSync(path.join(root, "version.json"), JSON.stringify(data, null, 2) + "\n");
console.log(`✅ الإصدار: ${full} · build ${build} · ${builtAt}${commit ? " · " + commit : ""}`);
