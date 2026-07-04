"use strict";

/* ================= 定数 ================= */
const SCHOOLS = {
  elem: { label: "小学生", grades: [1, 2, 3, 4, 5, 6], subjects: ["国語", "算数", "理科", "社会", "英語"] },
  junior: { label: "中学生", grades: [1, 2, 3], subjects: ["国語", "数学", "英語", "理科", "社会"] },
  high: { label: "高校生", grades: [1, 2, 3], subjects: ["国語", "数学", "英語", "理科", "社会", "情報"] },
};
const CAREER_TYPES = { exam: "高校入試", univ: "大学進学", college: "専門・短大", job: "就職" };
const CAT_COLORS = ["--cat-1", "--cat-2", "--cat-3", "--cat-4", "--cat-5", "--cat-6", "--cat-7", "--cat-8"];
const RATING_EMOJI = { 1: "😰", 2: "😕", 3: "🙂", 4: "😄", 5: "🤩" };
const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

/* ================= データ層(localStorage) ================= */
const K = {
  profile: "seiseki.profile",
  grades: "seiseki.grades",
  sessions: "seiseki.sessions",
  assignments: "seiseki.assignments",
  weakpoints: "seiseki.weakpoints",
  prints: "seiseki.prints",
  friendCode: "seiseki.friendCode",
  timer: "seiseki.timer",
  notified: "seiseki.notifiedOn",
};

/* オンライン同期の状態(実装はファイル後半。save()から参照されるためここで宣言) */
let cloudUser = null;
let cloudState = "loading"; // loading | disabled | ready
let pushTimer = null;

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  localStorage.setItem("seiseki.savedAt", String(Date.now()));
  scheduleCloudPush();
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

let profile = load(K.profile, null);
if (!profile) {
  profile = {
    displayName: "",
    school: "high",
    grade: 1,
    subjects: [...SCHOOLS.high.subjects],
    career: { type: "", target: "", note: "" },
    weeklyGoalHours: 0,
  };
}
let grades = load(K.grades, []);          // {id, subject, title, date, score, max}
let sessions = load(K.sessions, []);      // {id, date, subject, seconds, content, rating, memo, createdAt}
let assignments = load(K.assignments, []); // {id, title, due, done}
let weakpoints = load(K.weakpoints, []);  // {id, subject, question, answer, mastered, createdAt}
let prints = load(K.prints, []);          // {id, subject, name, type, size, createdAt}

/* 旧バージョン(まなびログ)からの引きこし */
(function migrate() {
  if (localStorage.getItem(K.sessions) !== null) return;
  const oldRecs = load("manabi.records", null);
  if (!Array.isArray(oldRecs) || oldRecs.length === 0) return;
  const oldSubs = load("manabi.subjects", []);
  const nameOf = (id) => oldSubs.find((s) => s.id === id)?.name || "その他";
  sessions = oldRecs.map((r) => ({
    id: r.id, date: r.date, subject: nameOf(r.subjectId),
    seconds: (r.minutes || 0) * 60, content: r.content || "",
    rating: r.rating || 0, memo: r.memo || "", createdAt: r.createdAt || Date.now(),
  }));
  sessions.forEach((s) => {
    if (!profile.subjects.includes(s.subject)) profile.subjects.push(s.subject);
  });
  save(K.sessions, sessions);
  save(K.profile, profile);
})();

let friendCode = load(K.friendCode, null);
if (!friendCode) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  friendCode = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  save(K.friendCode, friendCode);
}

/* ================= 日付ユーティリティ ================= */
function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayStr() { return dateToStr(new Date()); }
function strToDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
function weekStartStr() {
  const c = new Date();
  c.setDate(c.getDate() - ((c.getDay() + 6) % 7)); // 月曜始まり
  return dateToStr(c);
}
function formatDateLabel(s) {
  const d = strToDate(s);
  const label = `${d.getMonth() + 1}月${d.getDate()}日(${DOW_LABELS[d.getDay()]})`;
  if (s === todayStr()) return `きょう ${label}`;
  if (s === dateToStr(addDays(new Date(), -1))) return `きのう ${label}`;
  return label;
}
function formatMinutes(min) {
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60), m = min % 60;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}
function formatDuration(sec) {
  if (sec < 60) return `${sec}秒`;
  if (sec < 3600) return `${Math.floor(sec / 60)}分`;
  return `${(sec / 3600).toFixed(1)}h`;
}
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function subjectColor(name) {
  const i = profile.subjects.indexOf(name);
  return cssVar(CAT_COLORS[(i >= 0 ? i : CAT_COLORS.length - 1) % CAT_COLORS.length]);
}

/* ================= 集計 ================= */
function weekSeconds() {
  const start = weekStartStr();
  return sessions.filter((s) => s.date >= start).reduce((a, s) => a + s.seconds, 0);
}
function subjectAvgRate(subject) {
  const gs = grades.filter((g) => g.subject === subject);
  if (gs.length === 0) return null;
  return gs.reduce((a, g) => a + (g.score / g.max) * 100, 0) / gs.length;
}

/* ================= 画面切りかえ ================= */
const VIEWS = ["home", "study", "prints", "weak", "friends", "settings"];
const HERO = {
  study: ["学習", "きょうもコツコツ ⏱️"],
  prints: ["授業プリント・資料", "科目ごとに保存しよう 📚"],
  weak: ["弱点ノート", "間違いを克服しよう 📕"],
  friends: ["フレンド", "いっしょにがんばろう 👥"],
  settings: ["設定", "学校・学年・科目"],
};
let currentView = "home";

function setHero(view) {
  const label = document.getElementById("hero-label");
  const title = document.getElementById("hero-title");
  if (view === "home") {
    const name = profile.displayName;
    label.textContent = name ? `こんにちは、${name} さん 👋` : "こんにちは 👋";
    title.textContent = `${SCHOOLS[profile.school].label} ${profile.grade}年`;
  } else {
    label.textContent = HERO[view][0];
    title.textContent = HERO[view][1];
  }
}

function showView(name) {
  currentView = name;
  VIEWS.forEach((v) => {
    document.getElementById(`view-${v}`).hidden = v !== name;
    const tab = document.getElementById(`tab-${v}`);
    tab.classList.toggle("active", v === name);
    tab.setAttribute("aria-selected", String(v === name));
  });
  setHero(name);
  if (name === "home") renderHome();
  if (name === "study") renderStudy();
  if (name === "prints") renderPrints();
  if (name === "weak") renderWeak();
  if (name === "friends") renderFriends();
  if (name === "settings") renderSettings();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => showView(tab.dataset.view));
});

/* ================= トースト ================= */
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

/* =================================================================
   ホーム
================================================================= */
let trendSubject = null;

function renderHome() {
  // 統計タイル
  const wsec = weekSeconds();
  document.getElementById("stat-week-hours").innerHTML =
    `${(wsec / 3600).toFixed(1)}<span class="stat-unit">h</span>`;

  const nextEl = document.getElementById("stat-next-due");
  const pending = assignments.filter((a) => !a.done).sort((a, b) => a.due.localeCompare(b.due));
  nextEl.classList.remove("stat-danger", "stat-good");
  if (pending.length === 0) {
    nextEl.textContent = "なし";
  } else if (pending[0].due < todayStr()) {
    nextEl.textContent = "超過";
    nextEl.classList.add("stat-danger");
  } else {
    const days = Math.round((strToDate(pending[0].due) - strToDate(todayStr())) / 86400000);
    nextEl.textContent = days === 0 ? "きょう" : `あと${days}日`;
    if (days <= 1) nextEl.classList.add("stat-danger");
  }

  const goalEl = document.getElementById("stat-goal");
  goalEl.classList.remove("stat-good");
  if (profile.weeklyGoalHours > 0) {
    const pct = Math.round((wsec / (profile.weeklyGoalHours * 3600)) * 100);
    goalEl.textContent = `${pct}%`;
    if (pct >= 100) goalEl.classList.add("stat-good");
  } else {
    goalEl.textContent = "—";
  }

  renderAdvice();
  renderRadar();
  renderHomeChips();
  renderTrend();
  renderGradeList();
}

/* 進路アドバイス(端末内の記録から生成する簡易アドバイス) */
function renderAdvice() {
  const el = document.getElementById("career-advice");
  const c = profile.career;
  if (!c.type) {
    el.className = "advice-body empty";
    el.innerHTML = `設定タブで<a href="#" id="goto-career">進路目標</a>を登録すると、<br>目標に向けた「今やるべきこと」を提案します。`;
    document.getElementById("goto-career").addEventListener("click", (e) => {
      e.preventDefault();
      showView("settings");
    });
    return;
  }
  el.className = "advice-body";
  const items = [];
  const goalLabel = CAREER_TYPES[c.type] + (c.target ? `(${escapeHtml(c.target)})` : "");
  items.push(`目標:<strong>${goalLabel}</strong>${c.note ? ` — ${escapeHtml(c.note)}` : ""}`);

  const rated = profile.subjects
    .map((s) => ({ s, r: subjectAvgRate(s) }))
    .filter((x) => x.r !== null)
    .sort((a, b) => a.r - b.r);
  if (rated.length > 0) {
    items.push(`📉 得点率がいちばん低いのは「${escapeHtml(rated[0].s)}」(平均${Math.round(rated[0].r)}%)。ここを重点的に復習しよう。`);
    const best = rated[rated.length - 1];
    if (best.s !== rated[0].s) items.push(`💪 「${escapeHtml(best.s)}」(平均${Math.round(best.r)}%)は得意分野。この調子!`);
  } else {
    items.push(`まずは「+ 成績を追加」からテストの結果を登録しよう。得意・不得意が見えてきます。`);
  }

  const overdue = assignments.filter((a) => !a.done && a.due < todayStr()).length;
  if (overdue > 0) items.push(`⚠️ 期限を過ぎた提出物が${overdue}件あります。まず片づけよう。`);

  if (profile.weeklyGoalHours > 0) {
    const pct = Math.round((weekSeconds() / (profile.weeklyGoalHours * 3600)) * 100);
    items.push(pct >= 100 ? `🎉 今週の目標勉強時間を達成!すばらしい!` : `⏱️ 今週の勉強は目標の${pct}%。コツコツ積み上げよう。`);
  }
  el.innerHTML = `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
}

/* 得意・不得意レーダー */
function renderRadar() {
  const wrap = document.getElementById("radar-chart");
  const data = profile.subjects
    .map((s) => ({ s, r: subjectAvgRate(s) }))
    .filter((x) => x.r !== null);
  if (data.length < 3) {
    wrap.innerHTML = `<div class="chart-empty"><span class="ce-icon">🕸️</span>3科目以上の成績を登録すると<br>得意・不得意のレーダーが表示されます。</div>`;
    return;
  }
  const W = 520, H = 300, cx = W / 2, cy = H / 2 + 4, R = 104;
  const n = data.length;
  const angle = (i) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const pt = (i, v) => [cx + Math.cos(angle(i)) * R * v, cy + Math.sin(angle(i)) * R * v];

  const gridline = cssVar("--gridline"), baseline = cssVar("--baseline");
  const muted = cssVar("--text-muted"), secondary = cssVar("--text-secondary");
  const accent = cssVar("--accent");

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="教科ごとの平均得点率のレーダーチャート">`;
  // グリッド(25/50/75/100%)
  [0.25, 0.5, 0.75, 1].forEach((v) => {
    const pts = data.map((_, i) => pt(i, v).join(",")).join(" ");
    svg += `<polygon points="${pts}" fill="none" stroke="${v === 1 ? baseline : gridline}" stroke-width="1"/>`;
  });
  // 軸
  data.forEach((_, i) => {
    const [x, y] = pt(i, 1);
    svg += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${gridline}" stroke-width="1"/>`;
  });
  // データポリゴン
  const dpts = data.map((d, i) => pt(i, Math.max(0.02, d.r / 100)).join(",")).join(" ");
  svg += `<polygon points="${dpts}" fill="${accent}" fill-opacity="0.12" stroke="${accent}" stroke-width="2" stroke-linejoin="round"/>`;
  data.forEach((d, i) => {
    const [x, y] = pt(i, Math.max(0.02, d.r / 100));
    svg += `<circle cx="${x}" cy="${y}" r="4.5" fill="${accent}" stroke="#ffffff" stroke-width="2"/>`;
  });
  // ラベル(教科名+平均%)
  data.forEach((d, i) => {
    const [x, y] = pt(i, 1.22);
    const anchor = Math.abs(x - cx) < 10 ? "middle" : x > cx ? "start" : "end";
    svg += `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="13" font-weight="700" fill="${secondary}">${escapeHtml(d.s)}</text>`;
    svg += `<text x="${x}" y="${y + 15}" text-anchor="${anchor}" font-size="11" fill="${muted}">${Math.round(d.r)}%</text>`;
  });
  svg += "</svg>";
  wrap.innerHTML = svg;
}

/* 科目チップ(ホーム) */
function renderHomeChips() {
  const el = document.getElementById("home-subject-chips");
  if (!profile.subjects.includes(trendSubject)) trendSubject = profile.subjects[0] || null;
  el.innerHTML = profile.subjects
    .map((s) => `<button type="button" class="chip ${s === trendSubject ? "active" : ""}" data-subject="${escapeHtml(s)}">${escapeHtml(s)}</button>`)
    .join("");
  el.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      trendSubject = chip.dataset.subject;
      renderHomeChips();
      renderTrend();
    });
  });
}

/* 成績推移(得点率)折れ線グラフ */
function renderTrend() {
  const wrap = document.getElementById("trend-chart");
  document.getElementById("trend-title").textContent = `${trendSubject || ""}の成績推移(得点率)`;
  const gs = grades
    .filter((g) => g.subject === trendSubject)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (gs.length === 0) {
    wrap.innerHTML = `<div class="chart-empty"><span class="ce-icon">📈</span>まだ${escapeHtml(trendSubject || "")}の記録がありません。<br>「成績を追加」から登録しよう!</div>`;
    return;
  }

  const W = 520, H = 220;
  const pad = { top: 16, right: 24, bottom: 30, left: 38 };
  const plotW = W - pad.left - pad.right, plotH = H - pad.top - pad.bottom;
  const x = (i) => (gs.length === 1 ? pad.left + plotW / 2 : pad.left + (plotW * i) / (gs.length - 1));
  const y = (rate) => pad.top + plotH - (rate / 100) * plotH;

  const gridline = cssVar("--gridline"), baseline = cssVar("--baseline");
  const muted = cssVar("--text-muted"), accent = cssVar("--accent");
  const secondary = cssVar("--text-secondary");

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(trendSubject)}の得点率の推移">`;
  [0, 25, 50, 75, 100].forEach((v) => {
    const yy = y(v);
    svg += `<line x1="${pad.left}" y1="${yy}" x2="${W - pad.right}" y2="${yy}" stroke="${v === 0 ? baseline : gridline}" stroke-width="1"/>`;
    svg += `<text x="${pad.left - 6}" y="${yy + 4}" text-anchor="end" font-size="11" fill="${muted}" style="font-variant-numeric:tabular-nums">${v}</text>`;
  });

  const rates = gs.map((g) => (g.score / g.max) * 100);
  if (gs.length > 1) {
    const d = rates.map((r, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(r)}`).join(" ");
    svg += `<path d="${d}" fill="none" stroke="${accent}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  rates.forEach((r, i) => {
    svg += `<circle cx="${x(i)}" cy="${y(r)}" r="4.5" fill="${accent}" stroke="#ffffff" stroke-width="2"/>`;
  });
  // 最新の値だけ直接ラベル
  const li = rates.length - 1;
  svg += `<text x="${x(li)}" y="${y(rates[li]) - 10}" text-anchor="middle" font-size="12" font-weight="700" fill="${secondary}">${Math.round(rates[li])}%</text>`;

  // 日付ラベル(多いときは間引く)
  const skip = Math.ceil(gs.length / 6);
  gs.forEach((g, i) => {
    if (i % skip !== 0 && i !== gs.length - 1) return;
    const d = strToDate(g.date);
    svg += `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="${muted}">${d.getMonth() + 1}/${d.getDate()}</text>`;
  });

  // 当たり判定
  gs.forEach((g, i) => {
    const bw = Math.max(24, plotW / gs.length);
    svg += `<rect class="hit" data-i="${i}" x="${x(i) - bw / 2}" y="${pad.top}" width="${bw}" height="${plotH}" fill="transparent"/>`;
  });
  svg += "</svg>";
  wrap.innerHTML = svg;

  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.hidden = true;
  wrap.appendChild(tooltip);
  const svgEl = wrap.querySelector("svg");
  wrap.querySelectorAll(".hit").forEach((hit) => {
    const show = () => {
      const i = Number(hit.dataset.i);
      const g = gs[i];
      tooltip.innerHTML = `${escapeHtml(g.title)}(${g.date.slice(5).replace("-", "/")})<br><span class="tt-value">${g.score}/${g.max}点(${Math.round(rates[i])}%)</span>`;
      tooltip.hidden = false;
      const scale = wrap.getBoundingClientRect().width / W;
      tooltip.style.left = `${x(i) * scale}px`;
      tooltip.style.top = `${(y(rates[i]) - 8) * scale}px`;
    };
    hit.addEventListener("mouseenter", show);
    hit.addEventListener("touchstart", show, { passive: true });
  });
  svgEl.addEventListener("mouseleave", () => (tooltip.hidden = true));
}

function renderGradeList() {
  const el = document.getElementById("grade-list");
  const gs = grades
    .filter((g) => g.subject === trendSubject)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (gs.length === 0) {
    el.innerHTML = `<p class="empty-note">この科目の成績はまだありません</p>`;
    return;
  }
  el.innerHTML = gs
    .map(
      (g) => `
      <div class="grade-row">
        <span class="grade-subject">${escapeHtml(g.subject)}</span>
        <span class="grade-title">${escapeHtml(g.title)} <span class="grade-rate">${g.date.slice(5).replace("-", "/")}</span></span>
        <span class="grade-score">${g.score}/${g.max}</span>
        <span class="grade-rate">${Math.round((g.score / g.max) * 100)}%</span>
        <button class="icon-btn" data-del-grade="${g.id}" aria-label="削除">🗑️</button>
      </div>`
    )
    .join("");
}
document.getElementById("grade-list").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-del-grade]");
  if (!btn) return;
  if (!confirm("この成績を削除しますか?")) return;
  grades = grades.filter((g) => g.id !== btn.dataset.delGrade);
  save(K.grades, grades);
  renderHome();
});

/* 成績追加モーダル */
const gradeModal = document.getElementById("grade-modal");
document.getElementById("add-grade-btn").addEventListener("click", () => {
  const sel = document.getElementById("g-subject");
  sel.innerHTML = profile.subjects.map((s) => `<option>${escapeHtml(s)}</option>`).join("");
  if (trendSubject) sel.value = trendSubject;
  document.getElementById("g-date").value = todayStr();
  gradeModal.hidden = false;
  document.getElementById("g-title").focus();
});
document.getElementById("grade-cancel-btn").addEventListener("click", () => (gradeModal.hidden = true));
gradeModal.addEventListener("click", (e) => {
  if (e.target === gradeModal) gradeModal.hidden = true;
});
document.getElementById("grade-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const score = Number(document.getElementById("g-score").value);
  const max = Number(document.getElementById("g-max").value);
  if (!(max > 0) || score < 0 || score > max) {
    toast("点数は0〜満点の範囲で入力してください");
    return;
  }
  grades.push({
    id: uid(),
    subject: document.getElementById("g-subject").value,
    title: document.getElementById("g-title").value.trim(),
    date: document.getElementById("g-date").value,
    score, max,
  });
  save(K.grades, grades);
  trendSubject = document.getElementById("g-subject").value;
  gradeModal.hidden = true;
  e.target.reset();
  document.getElementById("g-max").value = 100;
  toast("成績を登録しました 📈");
  renderHome();
});

/* =================================================================
   学習(タイマー・記録・提出物)
================================================================= */
let timer = load(K.timer, { running: false, startedAt: 0, accumSec: 0, subject: "" });
let timerInterval = null;
let editingId = null;
let selectedRating = 0;

function timerSeconds() {
  return timer.accumSec + (timer.running ? Math.floor((Date.now() - timer.startedAt) / 1000) : 0);
}
function renderTimerDisplay() {
  const sec = timerSeconds();
  const h = Math.floor(sec / 3600);
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  document.getElementById("timer-display").textContent = h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}
function renderTimerButtons() {
  document.getElementById("timer-start").hidden = timer.running;
  document.getElementById("timer-start").textContent = timer.accumSec > 0 && !timer.running ? "再開" : "スタート";
  document.getElementById("timer-pause").hidden = !timer.running;
  document.getElementById("timer-stop").hidden = !timer.running && timer.accumSec === 0;
}
function renderTimerChips() {
  const el = document.getElementById("timer-subject-chips");
  if (!profile.subjects.includes(timer.subject)) timer.subject = profile.subjects[0] || "";
  el.innerHTML = profile.subjects
    .map((s) => `<button type="button" class="chip ${s === timer.subject ? "active" : ""}" data-subject="${escapeHtml(s)}">${escapeHtml(s)}</button>`)
    .join("");
  el.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      timer.subject = chip.dataset.subject;
      save(K.timer, timer);
      renderTimerChips();
    });
  });
}
function startTicking() {
  clearInterval(timerInterval);
  timerInterval = setInterval(renderTimerDisplay, 500);
}

document.getElementById("timer-start").addEventListener("click", () => {
  timer.running = true;
  timer.startedAt = Date.now();
  save(K.timer, timer);
  renderTimerButtons();
  startTicking();
});
document.getElementById("timer-pause").addEventListener("click", () => {
  timer.accumSec = timerSeconds();
  timer.running = false;
  save(K.timer, timer);
  clearInterval(timerInterval);
  renderTimerButtons();
  renderTimerDisplay();
});
document.getElementById("timer-stop").addEventListener("click", () => {
  const sec = timerSeconds();
  timer = { running: false, startedAt: 0, accumSec: 0, subject: timer.subject };
  save(K.timer, timer);
  clearInterval(timerInterval);
  if (sec >= 10) {
    sessions.push({
      id: uid(), date: todayStr(), subject: timer.subject || profile.subjects[0] || "その他",
      seconds: sec, content: "タイマーで学習", rating: 0, memo: "", createdAt: Date.now(),
    });
    save(K.sessions, sessions);
    toast(`${formatDuration(sec)}の勉強を記録しました!おつかれさま 🎉`);
  } else {
    toast("10秒未満だったので記録しませんでした");
  }
  renderTimerButtons();
  renderTimerDisplay();
  renderRecordList();
});

/* 手動の学習記録フォーム */
const form = document.getElementById("record-form");
const ratingRow = document.getElementById("f-rating");

function populateSubjectSelects() {
  const opts = profile.subjects.map((s) => `<option>${escapeHtml(s)}</option>`).join("");
  document.getElementById("f-subject").innerHTML = opts;
  document.getElementById("w-subject").innerHTML = opts;
  document.getElementById("filter-subject").innerHTML = `<option value="">すべての教科</option>` + opts;
}
function resetForm() {
  editingId = null;
  form.reset();
  document.getElementById("f-date").value = todayStr();
  setRating(0);
  document.getElementById("form-title").textContent = "✏️ 学習を記録する";
  document.getElementById("save-btn").textContent = "記録する";
  document.getElementById("cancel-edit-btn").hidden = true;
}
function setRating(val) {
  selectedRating = val;
  ratingRow.querySelectorAll(".rating-btn").forEach((b) => {
    b.classList.toggle("selected", Number(b.dataset.val) === val);
  });
}
ratingRow.addEventListener("click", (e) => {
  const btn = e.target.closest(".rating-btn");
  if (!btn) return;
  const val = Number(btn.dataset.val);
  setRating(val === selectedRating ? 0 : val);
});
document.querySelectorAll(".preset-btn").forEach((b) => {
  b.addEventListener("click", () => (document.getElementById("f-minutes").value = b.dataset.min));
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const minutes = Number(document.getElementById("f-minutes").value);
  if (!(minutes > 0)) return;
  const base = editingId ? sessions.find((s) => s.id === editingId) : null;
  const rec = {
    id: editingId || uid(),
    date: document.getElementById("f-date").value,
    subject: document.getElementById("f-subject").value,
    content: document.getElementById("f-content").value.trim(),
    seconds: minutes * 60,
    rating: selectedRating,
    memo: document.getElementById("f-memo").value.trim(),
    createdAt: base ? base.createdAt : Date.now(),
  };
  if (editingId) {
    sessions = sessions.map((s) => (s.id === editingId ? rec : s));
    toast("記録を更新しました ✏️");
  } else {
    sessions.push(rec);
    toast("記録しました!えらい! 🎉");
  }
  save(K.sessions, sessions);
  resetForm();
  renderRecordList();
});
document.getElementById("cancel-edit-btn").addEventListener("click", resetForm);

function startEdit(id) {
  const r = sessions.find((x) => x.id === id);
  if (!r) return;
  editingId = id;
  document.getElementById("f-date").value = r.date;
  document.getElementById("f-subject").value = r.subject;
  document.getElementById("f-content").value = r.content;
  document.getElementById("f-minutes").value = Math.max(1, Math.round(r.seconds / 60));
  document.getElementById("f-memo").value = r.memo || "";
  setRating(r.rating || 0);
  document.getElementById("form-title").textContent = "✏️ 記録を編集する";
  document.getElementById("save-btn").textContent = "更新する";
  document.getElementById("cancel-edit-btn").hidden = false;
  document.getElementById("record-form").scrollIntoView({ behavior: "smooth" });
}

/* 提出物 */
document.getElementById("assignment-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const title = document.getElementById("a-title").value.trim();
  const due = document.getElementById("a-due").value;
  if (!title || !due) return;
  assignments.push({ id: uid(), title, due, done: false });
  save(K.assignments, assignments);
  e.target.reset();
  renderAssignments();
  toast("提出物を追加しました 📌");
});

function renderAssignments() {
  const el = document.getElementById("assignment-list");
  const list = [...assignments].sort((a, b) => a.done - b.done || a.due.localeCompare(b.due));
  if (list.length === 0) {
    el.innerHTML = `<p class="empty-note">提出物はありません</p>`;
    return;
  }
  const today = todayStr();
  el.innerHTML = list
    .map((a) => {
      const days = Math.round((strToDate(a.due) - strToDate(today)) / 86400000);
      const dueLabel = a.done ? "完了" : days < 0 ? `超過(${a.due.slice(5).replace("-", "/")})` : days === 0 ? "きょうまで" : `あと${days}日`;
      return `
      <div class="assignment-item ${a.done ? "done" : ""}">
        <input type="checkbox" ${a.done ? "checked" : ""} data-toggle-assignment="${a.id}" aria-label="完了にする" />
        <span class="a-name">${escapeHtml(a.title)}</span>
        <span class="a-due ${!a.done && days < 0 ? "overdue" : ""}">${dueLabel}</span>
        <button class="icon-btn" data-del-assignment="${a.id}" aria-label="削除">🗑️</button>
      </div>`;
    })
    .join("");
}
document.getElementById("assignment-list").addEventListener("click", (e) => {
  const toggle = e.target.closest("[data-toggle-assignment]");
  if (toggle) {
    assignments = assignments.map((a) => (a.id === toggle.dataset.toggleAssignment ? { ...a, done: toggle.checked } : a));
    save(K.assignments, assignments);
    renderAssignments();
    return;
  }
  const del = e.target.closest("[data-del-assignment]");
  if (del) {
    assignments = assignments.filter((a) => a.id !== del.dataset.delAssignment);
    save(K.assignments, assignments);
    renderAssignments();
  }
});

/* 学習記録の一覧 */
document.getElementById("filter-subject").addEventListener("change", renderRecordList);

function renderRecordList() {
  const el = document.getElementById("record-list");
  const subj = document.getElementById("filter-subject").value;
  let list = [...sessions];
  if (subj) list = list.filter((r) => r.subject === subj);
  list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  list = list.slice(0, 50);

  if (list.length === 0) {
    el.innerHTML = `<p class="empty-note">まだ記録がありません。タイマーかフォームから記録しよう!</p>`;
    return;
  }
  const groups = new Map();
  list.forEach((r) => {
    if (!groups.has(r.date)) groups.set(r.date, []);
    groups.get(r.date).push(r);
  });
  el.innerHTML = [...groups.entries()]
    .map(([date, recs]) => {
      const total = recs.reduce((a, r) => a + r.seconds, 0);
      return `
      <div class="day-group">
        <div class="day-heading"><span>${formatDateLabel(date)}</span><span>${formatDuration(total)}</span></div>
        ${recs
          .map(
            (r) => `
          <div class="record-item">
            <div class="rec-stripe" style="background:${subjectColor(r.subject)}"></div>
            <div class="rec-body">
              <div class="rec-top">
                <span class="rec-subject">${escapeHtml(r.subject)}</span>
                <span class="rec-minutes">${formatDuration(r.seconds)}</span>
                ${r.rating ? `<span class="rec-rating">${RATING_EMOJI[r.rating]}</span>` : ""}
              </div>
              <div class="rec-content">${escapeHtml(r.content)}</div>
              ${r.memo ? `<div class="rec-memo">${escapeHtml(r.memo)}</div>` : ""}
            </div>
            <div class="rec-actions">
              <button class="icon-btn" data-edit="${r.id}" aria-label="編集">✏️</button>
              <button class="icon-btn" data-delete="${r.id}" aria-label="削除">🗑️</button>
            </div>
          </div>`
          )
          .join("")}
      </div>`;
    })
    .join("");
}
document.getElementById("record-list").addEventListener("click", (e) => {
  const edit = e.target.closest("[data-edit]");
  if (edit) return startEdit(edit.dataset.edit);
  const del = e.target.closest("[data-delete]");
  if (del) {
    if (!confirm("この記録を削除しますか?")) return;
    sessions = sessions.filter((r) => r.id !== del.dataset.delete);
    save(K.sessions, sessions);
    toast("削除しました");
    renderRecordList();
  }
});

function renderStudy() {
  renderTimerChips();
  renderTimerDisplay();
  renderTimerButtons();
  if (timer.running) startTicking();
  renderAssignments();
  renderRecordList();
}

/* =================================================================
   プリント(IndexedDBにファイル本体を保存)
================================================================= */
let printSubject = null;

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("seiseki-files", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(id, blob) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(blob, id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(id) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const req = db.transaction("files").objectStore("files").get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbDelete(id) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function renderPrints() {
  if (!profile.subjects.includes(printSubject)) printSubject = profile.subjects[0] || null;
  const chips = document.getElementById("print-subject-chips");
  chips.innerHTML = profile.subjects
    .map((s) => `<button type="button" class="chip ${s === printSubject ? "active" : ""}" data-subject="${escapeHtml(s)}">${escapeHtml(s)}</button>`)
    .join("");
  chips.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      printSubject = chip.dataset.subject;
      renderPrints();
    });
  });
  document.getElementById("dropzone-title").textContent = `${printSubject || ""}のプリントを追加`;
  document.getElementById("print-list-title").textContent = `${printSubject || ""}の資料`;

  const list = prints
    .filter((p) => p.subject === printSubject)
    .sort((a, b) => b.createdAt - a.createdAt);
  const el = document.getElementById("print-list");
  if (list.length === 0) {
    el.innerHTML = `<div class="chart-empty"><span class="ce-icon">📂</span>まだ${escapeHtml(printSubject || "")}の資料がありません。<br>上のボタンから追加しよう!</div>`;
    return;
  }
  el.innerHTML = list
    .map(
      (p) => `
      <div class="print-item">
        <span class="print-icon">${p.type === "application/pdf" ? "📄" : "🖼️"}</span>
        <div class="print-info">
          <div class="print-name">${escapeHtml(p.name)}</div>
          <div class="print-meta">${p.size >= 1024 * 1024 ? (p.size / 1024 / 1024).toFixed(1) + "MB" : Math.max(1, Math.round(p.size / 1024)) + "KB"}・${new Date(p.createdAt).toLocaleDateString("ja-JP")}</div>
        </div>
        <div class="print-actions">
          <button class="chip-btn" data-open-print="${p.id}">開く</button>
          <button class="chip-btn" data-ai-print="${p.id}">AIで問題をつくる</button>
          <button class="icon-btn" data-del-print="${p.id}" aria-label="削除">🗑️</button>
        </div>
      </div>`
    )
    .join("");
}

document.getElementById("print-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !printSubject) return;
  if (file.size > 20 * 1024 * 1024) {
    toast("20MBをこえるファイルは保存できません");
    return;
  }
  if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
    toast("画像またはPDFを選んでください");
    return;
  }
  const id = uid();
  try {
    await idbPut(id, file);
  } catch {
    toast("保存に失敗しました(容量不足の可能性があります)");
    return;
  }
  const meta = { id, subject: printSubject, name: file.name, type: file.type, size: file.size, createdAt: Date.now() };
  prints.push(meta);
  save(K.prints, prints);
  renderPrints();
  toast(`「${file.name}」を保存しました 📚`);

  // ログイン中ならクラウドにもアップロード(AI問題生成と他端末閲覧に使う)
  if (cloudUser) {
    try {
      await window.Cloud.uploadPrint(id, file, meta);
    } catch (e) {
      console.error(e);
      toast("クラウドへのアップロードに失敗しました(この端末では使えます)");
    }
  }
});

document.getElementById("print-list").addEventListener("click", async (e) => {
  const open = e.target.closest("[data-open-print]");
  if (open) {
    const blob = await idbGet(open.dataset.openPrint);
    if (blob) {
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return;
    }
    // この端末に実ファイルが無い場合はクラウドから開く(別端末でアップしたもの)
    if (cloudUser) {
      try {
        window.open(await window.Cloud.printUrl(open.dataset.openPrint), "_blank");
      } catch {
        toast("ファイルが見つかりませんでした");
      }
      return;
    }
    toast("ファイルが見つかりませんでした");
    return;
  }
  const ai = e.target.closest("[data-ai-print]");
  if (ai) {
    aiGenerate(ai.dataset.aiPrint);
    return;
  }
  const del = e.target.closest("[data-del-print]");
  if (del) {
    if (!confirm("この資料を削除しますか?")) return;
    await idbDelete(del.dataset.delPrint);
    prints = prints.filter((p) => p.id !== del.dataset.delPrint);
    save(K.prints, prints);
    renderPrints();
    if (cloudUser) window.Cloud.deletePrint(del.dataset.delPrint).catch(console.error);
  }
});

/* =================================================================
   弱点ノート
================================================================= */
function renderWeak() {
  const el = document.getElementById("weak-list");
  const list = [...weakpoints].sort((a, b) => a.mastered - b.mastered || b.createdAt - a.createdAt);
  if (list.length === 0) {
    el.innerHTML = `<div class="chart-empty"><span class="ce-icon">📕</span>まだ弱点はありません。<br>間違えた問題やニガテなことを下のフォームから保存しよう!</div>`;
    return;
  }
  el.innerHTML = list
    .map(
      (w) => `
      <div class="weak-item ${w.mastered ? "mastered" : ""}">
        <div class="weak-top">
          <span class="weak-subject">${escapeHtml(w.subject)}</span>
          <span class="weak-date">${new Date(w.createdAt).toLocaleDateString("ja-JP")}</span>
          ${w.mastered ? `<span class="weak-badge">克服ずみ 🎉</span>` : ""}
        </div>
        <div class="weak-q">${escapeHtml(w.question)}</div>
        ${w.answer ? `<div class="weak-a">${escapeHtml(w.answer)}</div>` : ""}
        <div class="weak-actions">
          <button class="chip-btn" data-toggle-weak="${w.id}">${w.mastered ? "まだニガテ…" : "克服した!"}</button>
          <button class="icon-btn" data-del-weak="${w.id}" aria-label="削除">🗑️</button>
        </div>
      </div>`
    )
    .join("");
}
document.getElementById("weak-form").addEventListener("submit", (e) => {
  e.preventDefault();
  weakpoints.push({
    id: uid(),
    subject: document.getElementById("w-subject").value,
    question: document.getElementById("w-question").value.trim(),
    answer: document.getElementById("w-answer").value.trim(),
    mastered: false,
    createdAt: Date.now(),
  });
  save(K.weakpoints, weakpoints);
  e.target.reset();
  renderWeak();
  toast("弱点を保存しました。克服したらチェックしよう 📕");
});
document.getElementById("weak-list").addEventListener("click", (e) => {
  const toggle = e.target.closest("[data-toggle-weak]");
  if (toggle) {
    weakpoints = weakpoints.map((w) => (w.id === toggle.dataset.toggleWeak ? { ...w, mastered: !w.mastered } : w));
    save(K.weakpoints, weakpoints);
    renderWeak();
    return;
  }
  const del = e.target.closest("[data-del-weak]");
  if (del) {
    if (!confirm("この弱点を削除しますか?")) return;
    weakpoints = weakpoints.filter((w) => w.id !== del.dataset.delWeak);
    save(K.weakpoints, weakpoints);
    renderWeak();
  }
});

/* =================================================================
   フレンド
================================================================= */
function renderFriends() {
  document.getElementById("friend-code").textContent = friendCode;
  const medals = ["🥇", "🥈", "🥉"];
  const me = { name: profile.displayName || "あなた", sec: weekSeconds() };
  document.getElementById("ranking").innerHTML = [me]
    .map(
      (r, i) => `
      <div class="rank-row">
        <span class="rank-medal">${medals[i] || `${i + 1}位`}</span>
        <span class="rank-name">${escapeHtml(r.name)} <span class="rank-you">(あなた)</span></span>
        <span class="rank-time">${formatDuration(r.sec)}</span>
      </div>`
    )
    .join("");
}
document.getElementById("copy-code-btn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(friendCode);
    toast("フレンドコードをコピーしました");
  } catch {
    toast(`フレンドコード: ${friendCode}`);
  }
});
document.getElementById("friend-form").addEventListener("submit", (e) => {
  e.preventDefault();
  toast("フレンド機能はサーバー(Firebase)接続後に使えます。今は自分の記録だけ表示しています。");
});

/* =================================================================
   設定
================================================================= */
function renderSettings() {
  document.getElementById("s-name").value = profile.displayName;

  const schoolSeg = document.getElementById("school-seg");
  schoolSeg.innerHTML = Object.entries(SCHOOLS)
    .map(([key, s]) => `<button type="button" class="seg-btn ${key === profile.school ? "active" : ""}" data-school="${key}">${s.label}</button>`)
    .join("");
  schoolSeg.querySelectorAll(".seg-btn").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.dataset.school === profile.school) return;
      profile.school = b.dataset.school;
      profile.grade = 1;
      profile.subjects = [...SCHOOLS[profile.school].subjects];
      save(K.profile, profile);
      populateSubjectSelects();
      renderSettings();
      toast(`${SCHOOLS[profile.school].label}の初期設定に切り替えました`);
    });
  });

  const gradeSeg = document.getElementById("grade-seg");
  gradeSeg.innerHTML = SCHOOLS[profile.school].grades
    .map((g) => `<button type="button" class="seg-btn ${g === profile.grade ? "active" : ""}" data-grade="${g}">${g}年</button>`)
    .join("");
  gradeSeg.querySelectorAll(".seg-btn").forEach((b) => {
    b.addEventListener("click", () => {
      profile.grade = Number(b.dataset.grade);
      save(K.profile, profile);
      renderSettings();
    });
  });

  const chipWrap = document.getElementById("subject-chips");
  chipWrap.innerHTML = profile.subjects
    .map((s) => `<span class="subject-chip">${escapeHtml(s)}<button type="button" class="x-btn" data-del-subject="${escapeHtml(s)}" aria-label="${escapeHtml(s)}を削除">✕</button></span>`)
    .join("");

  const c = profile.career;
  const typeChips = document.getElementById("career-type-chips");
  typeChips.innerHTML = Object.entries(CAREER_TYPES)
    .map(([key, label]) => `<button type="button" class="chip ${key === c.type ? "active" : ""}" data-career="${key}">${label}</button>`)
    .join("");
  typeChips.querySelectorAll(".chip").forEach((b) => {
    b.addEventListener("click", () => {
      profile.career.type = profile.career.type === b.dataset.career ? "" : b.dataset.career;
      renderSettings();
    });
  });
  document.getElementById("career-target").value = c.target;
  document.getElementById("career-note").value = c.note;

  document.getElementById("s-weekly-goal").value = profile.weeklyGoalHours || "";

  renderAccount();

  const nb = document.getElementById("notify-btn");
  if (!("Notification" in window)) {
    nb.disabled = true;
    nb.textContent = "この環境では通知を使えません";
  } else if (Notification.permission === "granted") {
    nb.disabled = true;
    nb.textContent = "🔔 通知はオンです";
  } else {
    nb.disabled = false;
    nb.textContent = "🔔 通知をオンにする";
  }
}

document.getElementById("save-name-btn").addEventListener("click", () => {
  profile.displayName = document.getElementById("s-name").value.trim();
  save(K.profile, profile);
  setHero(currentView);
  toast("表示名を保存しました");
});

document.getElementById("subject-chips").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-del-subject]");
  if (!btn) return;
  const name = btn.dataset.delSubject;
  if (profile.subjects.length <= 1) {
    toast("科目は1つ以上必要です");
    return;
  }
  if (!confirm(`「${name}」を科目から外しますか?(記録は残ります)`)) return;
  profile.subjects = profile.subjects.filter((s) => s !== name);
  save(K.profile, profile);
  populateSubjectSelects();
  renderSettings();
});
document.getElementById("subject-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("new-subject");
  const name = input.value.trim();
  if (!name) return;
  if (profile.subjects.includes(name)) {
    toast("同じ名前の科目があります");
    return;
  }
  profile.subjects.push(name);
  save(K.profile, profile);
  input.value = "";
  populateSubjectSelects();
  renderSettings();
  toast(`「${name}」を追加しました`);
});
document.getElementById("reset-subjects-btn").addEventListener("click", () => {
  if (!confirm(`科目を${SCHOOLS[profile.school].label}の初期設定に戻しますか?`)) return;
  profile.subjects = [...SCHOOLS[profile.school].subjects];
  save(K.profile, profile);
  populateSubjectSelects();
  renderSettings();
});

document.getElementById("save-career-btn").addEventListener("click", () => {
  profile.career.target = document.getElementById("career-target").value.trim();
  profile.career.note = document.getElementById("career-note").value.trim();
  save(K.profile, profile);
  toast(profile.career.type ? "進路目標を保存しました 🎯" : "進路の種類も選ぶとアドバイスが出ます");
});

document.getElementById("s-weekly-goal").addEventListener("change", (e) => {
  profile.weeklyGoalHours = Math.max(0, Number(e.target.value) || 0);
  save(K.profile, profile);
  toast(profile.weeklyGoalHours > 0 ? `週の目標を${profile.weeklyGoalHours}時間にしました` : "週の目標をなしにしました");
});

document.getElementById("notify-btn").addEventListener("click", async () => {
  const result = await Notification.requestPermission();
  renderSettings();
  if (result === "granted") {
    toast("通知をオンにしました 🔔");
    checkDueNotifications();
  } else {
    toast("ブラウザの設定で通知が許可されませんでした");
  }
});

/* 期限が近い提出物の通知(アプリを開いたとき・1日1回) */
function checkDueNotifications() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (load(K.notified, "") === todayStr()) return;
  const soon = assignments.filter((a) => {
    if (a.done) return false;
    const days = Math.round((strToDate(a.due) - strToDate(todayStr())) / 86400000);
    return days <= 1;
  });
  if (soon.length === 0) return;
  save(K.notified, todayStr());
  new Notification("Seiseki|提出物のリマインド", {
    body: soon.map((a) => `・${a.title}(${a.due.slice(5).replace("-", "/")}まで)`).join("\n"),
  });
}

/* ================= 書き出し・読み込み ================= */
document.getElementById("export-btn").addEventListener("click", () => {
  const data = {
    version: 2, exportedAt: new Date().toISOString(),
    profile, grades, sessions, assignments, weakpoints, friendCode,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `seiseki-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("書き出しました(プリントのファイル本体は含まれません)");
});
document.getElementById("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.profile || !Array.isArray(data.sessions)) throw new Error("bad format");
    if (!confirm("今のデータを読み込んだ内容で置きかえます。よろしいですか?")) return;
    profile = data.profile;
    grades = data.grades || [];
    sessions = data.sessions;
    assignments = data.assignments || [];
    weakpoints = data.weakpoints || [];
    save(K.profile, profile);
    save(K.grades, grades);
    save(K.sessions, sessions);
    save(K.assignments, assignments);
    save(K.weakpoints, weakpoints);
    populateSubjectSelects();
    showView("home");
    toast("データを読み込みました");
  } catch {
    toast("読み込めませんでした。ファイルを確認してください");
  } finally {
    e.target.value = "";
  }
});

/* =================================================================
   オンライン同期(Firebase・任意)
   firebase-config.js が無い場合はこのセクションは何もしない。
================================================================= */
function collectState() {
  return {
    profile, grades, sessions, assignments, weakpoints, prints, friendCode,
    savedAt: Number(localStorage.getItem("seiseki.savedAt")) || 0,
  };
}

function mergeById(a, b) {
  const map = new Map();
  [...(a || []), ...(b || [])].forEach((x) => {
    if (x && x.id && !map.has(x.id)) map.set(x.id, x);
  });
  return [...map.values()];
}

/* 端末のデータとクラウドのデータを合流させる(記録はID単位で和集合、設定は新しい方) */
function mergeStates(local, remote) {
  const remoteNewer = (remote.savedAt || 0) > (local.savedAt || 0);
  return {
    profile: remoteNewer && remote.profile ? remote.profile : local.profile,
    grades: mergeById(local.grades, remote.grades),
    sessions: mergeById(local.sessions, remote.sessions),
    assignments: mergeById(local.assignments, remote.assignments),
    weakpoints: mergeById(local.weakpoints, remote.weakpoints),
    prints: mergeById(local.prints, remote.prints),
    friendCode: remote.friendCode || local.friendCode,
    savedAt: Date.now(),
  };
}

function applyState(s) {
  profile = s.profile || profile;
  grades = s.grades || [];
  sessions = s.sessions || [];
  assignments = s.assignments || [];
  weakpoints = s.weakpoints || [];
  prints = s.prints || [];
  save(K.profile, profile);
  save(K.grades, grades);
  save(K.sessions, sessions);
  save(K.assignments, assignments);
  save(K.weakpoints, weakpoints);
  save(K.prints, prints);
}

/* save()のたびに呼ばれる。ログイン中なら少し待ってからまとめてクラウドへ */
function scheduleCloudPush() {
  if (!cloudUser) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    window.Cloud.push(collectState()).catch((e) => console.error("sync push failed", e));
  }, 1500);
}

async function cloudSync() {
  try {
    const remote = await window.Cloud.pull();
    if (remote) {
      applyState(mergeStates(collectState(), remote));
      populateSubjectSelects();
      showView(currentView);
    }
    await window.Cloud.push(collectState());
    toast("クラウドと同期しました ☁️");
  } catch (e) {
    console.error(e);
    toast("同期に失敗しました。通信環境を確認してください");
  }
}

function authErrorMessage(e) {
  const code = e?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found"))
    return "メールアドレスかパスワードがちがいます";
  if (code.includes("email-already-in-use")) return "このメールアドレスは登録済みです。ログインしてください";
  if (code.includes("weak-password")) return "パスワードは6文字以上にしてください";
  if (code.includes("invalid-email")) return "メールアドレスの形式がちがいます";
  if (code.includes("too-many-requests")) return "しばらく待ってからためしてください";
  return "ログインに失敗しました";
}

function renderAccount() {
  const el = document.getElementById("account-body");
  if (!el) return;
  if (cloudState === "loading") {
    el.innerHTML = `<p class="hint">読みこみ中…</p>`;
    return;
  }
  if (cloudState === "disabled") {
    el.innerHTML = `<p class="hint">オンライン同期は未設定です。Firebaseプロジェクトを作って firebase-config.js を置くと、ログイン・複数端末の同期・AI問題生成が使えるようになります(READMEを参照)。今はこの端末の中だけにデータが保存されています。</p>`;
    return;
  }
  if (cloudUser) {
    el.innerHTML = `
      <p class="hint">ログイン中:<strong>${escapeHtml(cloudUser.email || "")}</strong><br>記録は自動でクラウドに同期されます。</p>
      <div class="data-actions">
        <button type="button" class="btn btn-ghost" id="sync-now-btn">いますぐ同期</button>
        <button type="button" class="btn btn-ghost" id="logout-btn">ログアウト</button>
      </div>`;
    document.getElementById("sync-now-btn").addEventListener("click", cloudSync);
    document.getElementById("logout-btn").addEventListener("click", () => window.Cloud.logout());
  } else {
    el.innerHTML = `
      <div class="form-group"><input type="email" id="acc-email" placeholder="メールアドレス" autocomplete="username" /></div>
      <div class="form-group"><input type="password" id="acc-pass" placeholder="パスワード(6文字以上)" autocomplete="current-password" /></div>
      <div class="data-actions">
        <button type="button" class="btn btn-primary" id="login-btn">ログイン</button>
        <button type="button" class="btn btn-ghost" id="signup-btn">新規登録</button>
        <button type="button" class="btn btn-ghost" id="google-btn">Googleでログイン</button>
      </div>`;
    const email = () => document.getElementById("acc-email").value.trim();
    const pass = () => document.getElementById("acc-pass").value;
    const wrap = (fn) => async () => {
      try {
        await fn();
      } catch (e) {
        console.error(e);
        toast(authErrorMessage(e));
      }
    };
    document.getElementById("login-btn").addEventListener("click", wrap(() => window.Cloud.login(email(), pass())));
    document.getElementById("signup-btn").addEventListener("click", wrap(() => window.Cloud.signup(email(), pass())));
    document.getElementById("google-btn").addEventListener("click", wrap(() => window.Cloud.loginGoogle()));
  }
}

document.addEventListener("cloud-ready", () => {
  cloudState = "ready";
  renderAccount();
  window.Cloud.onAuth((user) => {
    const loggedIn = !cloudUser && user;
    cloudUser = user;
    renderAccount();
    if (loggedIn) cloudSync();
  });
});
document.addEventListener("cloud-disabled", () => {
  cloudState = "disabled";
  renderAccount();
});
// モジュールが読みこめない環境(file://直開きなど)へのフォールバック
setTimeout(() => {
  if (cloudState === "loading") {
    cloudState = "disabled";
    renderAccount();
  }
}, 8000);

/* =================================================================
   AIで問題をつくる(クイズ)
================================================================= */
const quizModal = document.getElementById("quiz-modal");
const quizBody = document.getElementById("quiz-body");
let quiz = null; // { questions, index, wrong, correct, subject }

document.getElementById("quiz-close-btn").addEventListener("click", closeQuiz);
function closeQuiz() {
  quizModal.hidden = true;
  quizBody.innerHTML = "";
  quiz = null;
}

async function aiGenerate(printId) {
  const meta = prints.find((p) => p.id === printId);
  if (!meta) return;
  if (cloudState !== "ready") {
    toast("AI問題生成にはオンライン設定(firebase-config.js)が必要です");
    return;
  }
  if (!cloudUser) {
    toast("AI問題生成にはログインが必要です(設定 → アカウント)");
    showView("settings");
    return;
  }
  quizModal.hidden = false;
  quizBody.innerHTML = `<p class="empty-note">🤖 プリントを読んで問題をつくっています…<br>(30秒〜1分ほどかかります)</p>`;
  try {
    const { questions, remaining } = await window.Cloud.generateQuestions(printId);
    quiz = { questions, index: 0, wrong: [], correct: 0, subject: meta.subject };
    renderQuizStep();
    if (typeof remaining === "number") toast(`きょうはあと${remaining}回つくれます`);
  } catch (e) {
    console.error(e);
    quizBody.innerHTML = `<p class="empty-note">${escapeHtml(e?.message || "生成に失敗しました。少し待ってもう一度ためしてください")}</p>`;
  }
}

function renderQuizStep() {
  if (!quiz) return;
  const q = quiz.questions[quiz.index];
  if (!q) return renderQuizResult();
  const head = `
    <p class="hint">問題 ${quiz.index + 1} / ${quiz.questions.length} ・ AIが作った問題はまちがっていることがあります</p>
    <div class="quiz-question">${escapeHtml(q.question)}</div>`;
  if (q.type === "choice") {
    quizBody.innerHTML =
      head +
      `<div class="quiz-choices">${q.choices
        .map((c, i) => `<button type="button" class="quiz-choice" data-choice="${i}">${escapeHtml(c)}</button>`)
        .join("")}</div>`;
    quizBody.querySelectorAll(".quiz-choice").forEach((b) =>
      b.addEventListener("click", () => answerChoice(Number(b.dataset.choice)))
    );
  } else {
    quizBody.innerHTML =
      head +
      `<textarea id="quiz-written" rows="3" placeholder="答えを書いてみよう(自己採点です)"></textarea>
       <div class="form-actions"><button type="button" class="btn btn-primary" id="quiz-show-answer">答えを見る</button></div>`;
    document.getElementById("quiz-show-answer").addEventListener("click", showWrittenAnswer);
  }
}

function answerChoice(i) {
  const q = quiz.questions[quiz.index];
  const ok = i === q.answer_index;
  quizBody.querySelectorAll(".quiz-choice").forEach((b, bi) => {
    b.disabled = true;
    if (bi === q.answer_index) b.classList.add("correct");
    else if (bi === i) b.classList.add("wrong");
  });
  if (ok) quiz.correct++;
  else recordWrong(q);
  quizBody.insertAdjacentHTML(
    "beforeend",
    `<div class="quiz-feedback ${ok ? "ok" : "ng"}">
       <strong>${ok ? "⭕ 正解!" : "❌ ざんねん…"}</strong>
       <div class="quiz-explanation">${escapeHtml(q.explanation || "")}</div>
     </div>
     <div class="form-actions"><button type="button" class="btn btn-primary" id="quiz-next">${
       quiz.index + 1 < quiz.questions.length ? "次の問題へ" : "結果を見る"
     }</button></div>`
  );
  document.getElementById("quiz-next").addEventListener("click", () => {
    quiz.index++;
    renderQuizStep();
  });
}

function showWrittenAnswer() {
  const q = quiz.questions[quiz.index];
  document.getElementById("quiz-show-answer").closest(".form-actions").remove();
  quizBody.insertAdjacentHTML(
    "beforeend",
    `<div class="quiz-feedback ok">
       <strong>模範解答:</strong>${escapeHtml(q.model_answer || "")}
       <div class="quiz-explanation">${escapeHtml(q.explanation || "")}</div>
     </div>
     <p class="hint">自分の答えと見くらべて、自己採点しよう</p>
     <div class="form-actions">
       <button type="button" class="btn btn-primary" id="quiz-self-ok">できた ⭕</button>
       <button type="button" class="btn btn-ghost" id="quiz-self-ng">できなかった ❌</button>
     </div>`
  );
  document.getElementById("quiz-self-ok").addEventListener("click", () => {
    quiz.correct++;
    quiz.index++;
    renderQuizStep();
  });
  document.getElementById("quiz-self-ng").addEventListener("click", () => {
    recordWrong(quiz.questions[quiz.index]);
    quiz.index++;
    renderQuizStep();
  });
}

/* まちがえた問題を弱点ノートに自動保存する */
function recordWrong(q) {
  quiz.wrong.push(q);
  weakpoints.push({
    id: uid(),
    subject: quiz.subject || profile.subjects[0] || "その他",
    question: q.question,
    answer:
      (q.type === "choice" ? `正解: ${q.choices[q.answer_index]}\n` : `模範解答: ${q.model_answer}\n`) +
      (q.explanation || ""),
    mastered: false,
    createdAt: Date.now(),
  });
  save(K.weakpoints, weakpoints);
}

function renderQuizResult() {
  const total = quiz.questions.length;
  quizBody.innerHTML = `
    <div class="quiz-result">
      <div class="quiz-score">${quiz.correct} / ${total} 問正解!</div>
      ${
        quiz.wrong.length > 0
          ? `<p class="hint">まちがえた${quiz.wrong.length}問を弱点ノートに保存しました 📕 あとで復習しよう!</p>`
          : `<p class="hint">全問正解!すばらしい! 🎉</p>`
      }
      <div class="form-actions"><button type="button" class="btn btn-primary" id="quiz-done">とじる</button></div>
    </div>`;
  document.getElementById("quiz-done").addEventListener("click", closeQuiz);
}

/* ================= 初期化 ================= */
populateSubjectSelects();
resetForm();
showView("home");
checkDueNotifications();
