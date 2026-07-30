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

// 2) رقم البناء بيزيد مع **كل رفعة**، مش مع كل commit.
//    السبب: لو رفعنا مرتين من غير commit كان الرقم بيفضل زي ما هو،
//    وساعتها المستخدم مايعرفش النظام اتحدّث ولا لأ.
const versionPath = path.join(root, "version.json");
let prev = null;
try { prev = JSON.parse(fs.readFileSync(versionPath, "utf8")); } catch { /* أول مرة */ }

// لو الرقم الأساسي اتغير (2.5 → 2.6) نبدأ العدّ من الأول
const build = prev && prev.base === base ? (Number(prev.build) || 0) + 1 : 1;

// 3) هاش قصير للتتبّع
let commit = "";
try { commit = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim(); }
catch { /* تجاهل */ }

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const builtAt = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
const builtTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

const version = `${base}.${build}`;      // مثال: 2.6.3
const full = `v${version}`;              // مثال: v2.6.3

const data = { version, full, build, commit, builtAt, builtTime, base };

fs.writeFileSync(versionPath, JSON.stringify(data, null, 2) + "\n");
console.log(`✅ الإصدار: ${full} · build ${build} · ${builtAt} ${builtTime}${commit ? " · " + commit : ""}`);
