/* HireLens frontend: auth, analysis flow, history, exports */
const $ = (id) => document.getElementById(id);
const SAMPLE = "We are hiring an AI Engineer at ABC Technologies (full-time, on-site). You have 2-4 years of experience with Python, FastAPI, LangGraph and SQL. Strong communication, teamwork and problem solving are a must.";
let user = null, lastReport = null, signup = false;

/* ---------- animated background ---------- */
(function bg() {
  const c = $("bg"), x = c.getContext("2d");
  let w, h, pts;
  const init = () => {
    w = c.width = innerWidth; h = c.height = innerHeight;
    pts = Array.from({ length: Math.min(70, Math.floor(w / 22)) }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .3, vy: (Math.random() - .5) * .3 }));
  };
  const draw = () => {
    x.clearRect(0, 0, w, h);
    pts.forEach((p, i) => {
      p.x = (p.x + p.vx + w) % w; p.y = (p.y + p.vy + h) % h;
      x.fillStyle = "rgba(34,211,238,.7)"; x.fillRect(p.x, p.y, 2, 2);
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(p.x - pts[j].x, p.y - pts[j].y);
        if (d < 120) { x.strokeStyle = `rgba(139,92,246,${.22 * (1 - d / 120)})`; x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(pts[j].x, pts[j].y); x.stroke(); }
      }
    });
    requestAnimationFrame(draw);
  };
  addEventListener("resize", init); init();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) draw();
})();

/* ---------- auth ---------- */
const cfg = window.FIREBASE_CONFIG || {};
const fbReady = cfg.apiKey && !cfg.apiKey.startsWith("YOUR_");
if (fbReady) firebase.initializeApp(cfg);
const auth = fbReady ? firebase.auth() : null;

function showApp(u) {
  user = u;
  $("login").classList.add("hidden"); $("app").classList.remove("hidden");
  $("userLabel").textContent = u.email || "Guest";
}
function showLogin() { user = null; $("app").classList.add("hidden"); $("login").classList.remove("hidden"); }
const friendly = (e) => ({
  "auth/invalid-credential": "Email or password is wrong.", "auth/email-already-in-use": "This email already has an account. Sign in instead.",
  "auth/weak-password": "Use a password with at least 6 characters.", "auth/popup-closed-by-user": "Google sign-in was closed before finishing."
}[e.code] || e.message);

if (auth) auth.onAuthStateChanged((u) => (u ? showApp(u) : showLogin()));
$("toggleAuth").onclick = () => {
  signup = !signup;
  $("authTitle").textContent = $("authSubmit").textContent = signup ? "Create account" : "Sign in";
  $("toggleAuth").textContent = signup ? "Have an account? Sign in" : "No account yet? Create one";
};
$("authForm").onsubmit = async (e) => {
  e.preventDefault(); $("authError").textContent = "";
  if (!auth) { $("authError").textContent = "Firebase is not configured yet. Add your keys in firebase-config.js, or try without an account."; return; }
  try {
    const f = signup ? auth.createUserWithEmailAndPassword : auth.signInWithEmailAndPassword;
    await f.call(auth, $("email").value.trim(), $("password").value);
  } catch (err) { $("authError").textContent = friendly(err); }
};
$("googleBtn").onclick = async () => {
  $("authError").textContent = "";
  if (!auth) { $("authError").textContent = "Firebase is not configured yet. Add your keys in firebase-config.js."; return; }
  try { await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); } catch (err) { $("authError").textContent = friendly(err); }
};
$("guestBtn").onclick = () => showApp({ email: "Guest", uid: "guest" });
$("logoutBtn").onclick = () => (auth && auth.currentUser ? auth.signOut() : showLogin());

/* ---------- tabs ---------- */
$("tabs").onclick = (e) => {
  const t = e.target.closest(".tab"); if (!t) return;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === t));
  document.querySelectorAll(".pane").forEach((p) => p.classList.add("hidden"));
  $("pane-" + t.dataset.tab).classList.remove("hidden");
  if (t.dataset.tab === "history") renderHistory();
};

/* ---------- API ---------- */
async function api(path, body) {
  const r = await fetch("/api/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || "Something went wrong. Try again.");
  return data;
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- analyze ---------- */
const steps = () => [...document.querySelectorAll("#steps li")];
function animateSteps() {
  let i = 0; steps().forEach((li) => (li.className = ""));
  steps()[0].className = "run";
  return setInterval(() => { if (i < 2) { steps()[i].className = "done"; steps()[++i].className = "run"; } }, 1400);
}
$("sampleBtn").onclick = () => ($("jd").value = SAMPLE);
$("clearBtn").onclick = () => { $("jd").value = ""; $("jdError").textContent = ""; $("reportBody").classList.add("hidden"); $("reportEmpty").classList.remove("hidden"); steps().forEach((l) => (l.className = "")); };
$("runBtn").onclick = async () => {
  const jd = $("jd").value.trim(); $("jdError").textContent = "";
  if (!jd) { $("jdError").textContent = "Paste a job description first."; return; }
  $("runBtn").disabled = true; $("runBtn").textContent = "Analysing...";
  const timer = animateSteps();
  try {
    lastReport = await api("analyze", { job_description: jd });
    clearInterval(timer); steps().forEach((l) => (l.className = "done"));
    renderReport(lastReport); saveHistory(lastReport);
  } catch (e) { clearInterval(timer); steps().forEach((l) => (l.className = "")); $("jdError").textContent = e.message; }
  $("runBtn").disabled = false; $("runBtn").textContent = "Run analysis";
};

function renderReport(r) {
  $("reportEmpty").classList.add("hidden"); const b = $("reportBody"); b.classList.remove("hidden");
  const tags = (a, cls) => (a || []).map((s) => `<span class="tag ${cls}">${esc(s)}</span>`).join("");
  b.innerHTML = `
    <div class="rhead"><div><small class="muted">Hiring report</small><h2>${esc(r.job_title)}</h2><span class="muted">${esc(r.company)}</span></div></div>
    <div class="meta"><div><small>Experience</small>${esc(r.experience)}</div><div><small>Category</small>${esc(r.category)}</div><div><small>Employment</small>${esc(r.employment_type)}</div></div>
    <p>${esc(r.summary)}</p>
    <h3>Technical skills</h3><div class="tags">${tags(r.technical, "t")}</div>
    <h3>Soft skills</h3><div class="tags">${tags(r.soft, "")}</div>
    <h3>Top 3 skills</h3>${(r.top3 || []).map((s, i) => `<div class="bar"><span>${i + 1}. ${esc(s.skill)}</span><div><b data-w="${+s.score || 0}"></b></div><span>${+s.score || 0}</span></div>`).join("")}
    <h3>Interview questions</h3><ul class="qs">${(r.interview_questions || []).map((q) => `<li>${esc(q)}</li>`).join("")}</ul>
    <div class="row"><button class="btn primary" id="expJson">Export JSON</button><button class="btn" id="expPdf">Export PDF</button></div>`;
  requestAnimationFrame(() => b.querySelectorAll("[data-w]").forEach((el) => (el.style.width = el.dataset.w + "%")));
  $("expJson").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }));
    a.download = `hiring-report-${(r.job_title || "job").replace(/\W+/g, "-").toLowerCase()}.json`; a.click();
  };
  $("expPdf").onclick = () => print();
}

/* ---------- history (per user, browser storage) ---------- */
const hkey = () => "hirelens_" + (user?.uid || "guest");
const loadHistory = () => { try { return JSON.parse(localStorage.getItem(hkey())) || []; } catch { return []; } };
function saveHistory(r) {
  const h = loadHistory(); h.unshift({ at: new Date().toLocaleString(), r });
  try { localStorage.setItem(hkey(), JSON.stringify(h.slice(0, 20))); } catch {}
}
function renderHistory() {
  const h = loadHistory(), box = $("historyList");
  if (!h.length) { box.innerHTML = '<div class="empty">No reports yet. Run an analysis and it shows up here.</div>'; return; }
  box.innerHTML = h.map((x, i) => `<div class="hitem"><div><b>${esc(x.r.job_title)}</b> <span class="muted">${esc(x.r.company)}</span><br><span class="muted small">${esc(x.at)}</span></div><button class="btn small" data-i="${i}">Open</button></div>`).join("");
  box.onclick = (e) => {
    const b = e.target.closest("[data-i]"); if (!b) return;
    lastReport = h[b.dataset.i].r; renderReport(lastReport); document.querySelector('[data-tab="analyze"]').click();
  };
}

/* ---------- resume match ---------- */
$("matchBtn").onclick = async () => {
  $("cvError").textContent = "";
  const jd = $("jd").value.trim(), cv = $("cv").value.trim();
  if (!jd) { $("cvError").textContent = "Add a job description in the Analyze tab first."; return; }
  if (!cv) { $("cvError").textContent = "Paste your resume text."; return; }
  $("matchBtn").disabled = true; $("matchBtn").textContent = "Checking...";
  try {
    const m = await api("match", { job_description: jd, resume_text: cv });
    const tg = (a, c) => (a || []).map((s) => `<span class="tag ${c}">${esc(s)}</span>`).join("");
    $("matchOut").innerHTML = `<div class="rhead"><h2>Resume match</h2><div class="ring" style="--p:${+m.score || 0}"><span>${+m.score || 0}%</span></div></div>
      <h3>Matched</h3><div class="tags">${tg(m.matched, "t")}</div><h3>Missing</h3><div class="tags">${tg(m.missing, "")}</div><p>${esc(m.advice)}</p>`;
  } catch (e) { $("cvError").textContent = e.message; }
  $("matchBtn").disabled = false; $("matchBtn").textContent = "Check match";
};

/* ---------- compare ---------- */
$("cmpBtn").onclick = async () => {
  $("cmpError").textContent = "";
  const a = $("jdA").value.trim(), b = $("jdB").value.trim();
  if (!a || !b) { $("cmpError").textContent = "Paste both job descriptions to compare."; return; }
  $("cmpBtn").disabled = true; $("cmpBtn").textContent = "Comparing...";
  try {
    const [ra, rb] = await Promise.all([api("analyze", { job_description: a }), api("analyze", { job_description: b })]);
    const sa = new Set((ra.technical || []).map((s) => s.toLowerCase())), sb = new Set((rb.technical || []).map((s) => s.toLowerCase()));
    const shared = (ra.technical || []).filter((s) => sb.has(s.toLowerCase()));
    const only = (r, other) => (r.technical || []).filter((s) => !other.has(s.toLowerCase()));
    const tg = (arr, c) => arr.map((s) => `<span class="tag ${c}">${esc(s)}</span>`).join("") || '<span class="muted">None</span>';
    const row = (k, f) => `<tr><td class="muted">${k}</td><td>${esc(f(ra))}</td><td>${esc(f(rb))}</td></tr>`;
    $("cmpOut").innerHTML = `<table class="cmp"><tr><th></th><th>Job A</th><th>Job B</th></tr>
      ${row("Title", (r) => r.job_title)}${row("Company", (r) => r.company)}${row("Experience", (r) => r.experience)}${row("Category", (r) => r.category)}${row("Employment", (r) => r.employment_type)}${row("Level", (r) => r.difficulty)}</table>
      <h3>Shared technical skills</h3><div class="tags">${tg(shared, "t")}</div>
      <h3>Only in Job A</h3><div class="tags">${tg(only(ra, sb), "")}</div>
      <h3>Only in Job B</h3><div class="tags">${tg(only(rb, sa), "")}</div>`;
  } catch (e) { $("cmpError").textContent = e.message; }
  $("cmpBtn").disabled = false; $("cmpBtn").textContent = "Compare jobs";
};
