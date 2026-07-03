"use strict";

/* ================= データ層 =================
 * localStorage に保存する。キーはすべて manabi.* に統一。
 * record: { id, date:"YYYY-MM-DD", subjectId, content, minutes, rating(1-5|0), memo, createdAt }
 * subject: { id, name }  色は配列の並び順で決まる(固定順)
 */
const STORE = {
  records: "manabi.records",
  subjects: "manabi.subjects",
  goal: "manabi.goal",
};

const DEFAULT_SUBJECTS = ["国語", "数学", "英語", "理科", "社会"];
const CAT_COLORS = ["--cat-1", "--cat-2", "--cat-3", "--cat-4", "--cat-5", "--cat-6", "--cat-7", "--cat-8"];

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
}

let records = load(STORE.records, []);
let subjects = load(STORE.subjects, null);
if (!Array.isArray(subjects) || subjects.length === 0) {
  subjects = DEFAULT_SUBJECTS.map((name) => ({ id: uid(), name }));
  save(STORE.subjects, subjects);
}
let goalMinutes = load(STORE.goal, 0);

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function subjectById(id) {
  return subjects.find((s) => s.id === id);
}
function subjectColor(id) {
  const i = subjects.findIndex((s) => s.id === id);
  const slot = CAT_COLORS[(i >= 0 ? i : CAT_COLORS.length - 1) % CAT_COLORS.length];
  return getComputedStyle(document.documentElement).getPropertyValue(slot).trim();
}

/* ================= 日付ユーティリティ ================= */
function todayStr() {
  return dateToStr(new Date());
}
function dateToStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function strToDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
/* 週の始まり(月曜) */
function weekStart(d) {
  const c = new Date(d);
  const dow = (c.getDay() + 6) % 7; // 月=0
  c.setDate(c.getDate() - dow);
  c.setHours(0, 0, 0, 0);
  return c;
}
const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function formatMinutes(min) {
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}
function formatDateLabel(s) {
  const d = strToDate(s);
  const label = `${d.getMonth() + 1}月${d.getDate()}日(${DOW_LABELS[d.getDay()]})`;
  if (s === todayStr()) return `きょう ${label}`;
  if (s === dateToStr(addDays(new Date(), -1))) return `きのう ${label}`;
  return label;
}

const RATING_EMOJI = { 1: "😰", 2: "😕", 3: "🙂", 4: "😄", 5: "🤩" };

/* ================= 集計 ================= */
function minutesOn(dateStr) {
  return records.filter((r) => r.date === dateStr).reduce((a, r) => a + r.minutes, 0);
}
function weekRecords(base = new Date()) {
  const start = dateToStr(weekStart(base));
  const end = dateToStr(addDays(weekStart(base), 6));
  return records.filter((r) => r.date >= start && r.date <= end);
}
function streakDays() {
  const days = new Set(records.map((r) => r.date));
  let streak = 0;
  let cursor = new Date();
  // 今日まだ記録がなくても連続は切らない(昨日から数える)
  if (!days.has(dateToStr(cursor))) cursor = addDays(cursor, -1);
  while (days.has(dateToStr(cursor))) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/* ================= 画面切りかえ ================= */
const views = ["home", "add", "list", "settings"];
function showView(name) {
  views.forEach((v) => {
    document.getElementById(`view-${v}`).hidden = v !== name;
    const tab = document.getElementById(`tab-${v}`);
    tab.classList.toggle("active", v === name);
    tab.setAttribute("aria-selected", String(v === name));
  });
  if (name === "home") renderHome();
  if (name === "list") renderList();
  if (name === "settings") renderSettings();
  if (name === "add" && !editingId) resetForm();
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
  toastTimer = setTimeout(() => (el.hidden = true), 2200);
}

/* ================= ホーム ================= */
function renderHome() {
  const today = minutesOn(todayStr());
  const week = weekRecords().reduce((a, r) => a + r.minutes, 0);
  document.getElementById("stat-today").innerHTML =
    `${today}<span class="stat-unit">分</span>`;
  document.getElementById("stat-week").innerHTML =
    week >= 60
      ? `${(week / 60).toFixed(1).replace(/\.0$/, "")}<span class="stat-unit">時間</span>`
      : `${week}<span class="stat-unit">分</span>`;
  document.getElementById("stat-streak").innerHTML =
    `${streakDays()}<span class="stat-unit">日</span>`;

  renderWeekChart();
  renderSubjectBreakdown();
  renderRecent();
}

/* 直近7日間の棒グラフ(SVG) */
function renderWeekChart() {
  const wrap = document.getElementById("week-chart");
  const tooltip = document.getElementById("chart-tooltip");
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(new Date(), -i);
    const ds = dateToStr(d);
    days.push({ date: ds, label: DOW_LABELS[d.getDay()], min: minutesOn(ds), isToday: i === 0 });
  }

  const W = 560, H = 220;
  const pad = { top: 16, right: 12, bottom: 28, left: 40 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const maxVal = Math.max(60, goalMinutes, ...days.map((d) => d.min));
  // きりのいい目盛り(30分きざみベース)
  const step = maxVal <= 120 ? 30 : maxVal <= 300 ? 60 : 120;
  const yMax = Math.ceil(maxVal / step) * step;
  const y = (v) => pad.top + plotH - (v / yMax) * plotH;

  const band = plotW / 7;
  const barW = Math.min(24, band * 0.5);
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue("--accent").trim();
  const gridline = css.getPropertyValue("--gridline").trim();
  const baseline = css.getPropertyValue("--baseline").trim();
  const muted = css.getPropertyValue("--text-muted").trim();
  const secondary = css.getPropertyValue("--text-secondary").trim();

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

  // 横グリッド線と目盛り
  for (let v = 0; v <= yMax; v += step) {
    const yy = y(v);
    svg += `<line x1="${pad.left}" y1="${yy}" x2="${W - pad.right}" y2="${yy}" stroke="${v === 0 ? baseline : gridline}" stroke-width="1"/>`;
    svg += `<text x="${pad.left - 6}" y="${yy + 4}" text-anchor="end" font-size="11" fill="${muted}" style="font-variant-numeric:tabular-nums">${v}</text>`;
  }

  // 目標ライン
  if (goalMinutes > 0 && goalMinutes <= yMax) {
    const gy = y(goalMinutes);
    svg += `<line x1="${pad.left}" y1="${gy}" x2="${W - pad.right}" y2="${gy}" stroke="${secondary}" stroke-width="1"/>`;
    svg += `<text x="${W - pad.right}" y="${gy - 4}" text-anchor="end" font-size="10" fill="${secondary}">目標</text>`;
  }

  // 棒(上端だけ4px丸め・ベースラインは直角)
  days.forEach((d, i) => {
    const cx = pad.left + band * i + band / 2;
    const x = cx - barW / 2;
    const barH = d.min > 0 ? Math.max(4, (d.min / yMax) * plotH) : 0;
    const top = pad.top + plotH - barH;
    if (barH > 0) {
      const r = Math.min(4, barH);
      const path = `M${x},${top + r} a${r},${r} 0 0 1 ${r},-${r} h${barW - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${barH - r} h${-barW} Z`;
      svg += `<path d="${path}" fill="${accent}" opacity="${d.isToday ? 1 : 0.75}"/>`;
    }
    // 当たり判定はバンド全体
    svg += `<rect class="hit" data-i="${i}" x="${pad.left + band * i}" y="${pad.top}" width="${band}" height="${plotH}" fill="transparent"/>`;
    svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="12" fill="${d.isToday ? secondary : muted}" font-weight="${d.isToday ? 700 : 400}">${d.isToday ? "きょう" : d.label}</text>`;
  });

  svg += "</svg>";
  wrap.innerHTML = svg;
  wrap.appendChild(tooltip);

  // ツールチップ
  const svgEl = wrap.querySelector("svg");
  wrap.querySelectorAll(".hit").forEach((hit) => {
    const show = () => {
      const d = days[Number(hit.dataset.i)];
      tooltip.innerHTML = `${formatDateLabel(d.date)}<br><span class="tt-value">${formatMinutes(d.min)}</span>`;
      tooltip.hidden = false;
      const rect = hit.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const scale = wrapRect.width / W;
      const barTop = d.min > 0 ? y(Math.min(d.min, yMax)) : y(0);
      tooltip.style.left = `${rect.left - wrapRect.left + rect.width / 2}px`;
      tooltip.style.top = `${barTop * scale - 6}px`;
    };
    hit.addEventListener("mouseenter", show);
    hit.addEventListener("touchstart", show, { passive: true });
  });
  svgEl.addEventListener("mouseleave", () => (tooltip.hidden = true));
}

/* 今週の教科別内訳 */
function renderSubjectBreakdown() {
  const el = document.getElementById("subject-breakdown");
  const wr = weekRecords();
  if (wr.length === 0) {
    el.innerHTML = `<p class="empty-note">今週の記録はまだありません</p>`;
    return;
  }
  const totals = new Map();
  wr.forEach((r) => totals.set(r.subjectId, (totals.get(r.subjectId) || 0) + r.minutes));
  const rows = [...totals.entries()]
    .map(([id, min]) => ({ id, min, name: subjectById(id)?.name || "(削除された教科)" }))
    .sort((a, b) => b.min - a.min);
  const max = rows[0].min;
  el.innerHTML = rows
    .map(
      (r) => `
      <div class="sb-row">
        <span class="sb-name"><span class="sb-swatch" style="background:${subjectColor(r.id)}"></span>${escapeHtml(r.name)}</span>
        <div class="sb-track"><div class="sb-fill" style="width:${(r.min / max) * 100}%;background:${subjectColor(r.id)}"></div></div>
        <span class="sb-min">${formatMinutes(r.min)}</span>
      </div>`
    )
    .join("");
}

function renderRecent() {
  const el = document.getElementById("recent-records");
  const recent = [...records]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    .slice(0, 5);
  if (recent.length === 0) {
    el.innerHTML = `<p class="empty-note">まだ記録がありません。「記録する」から始めよう!</p>`;
    return;
  }
  el.innerHTML = recent.map((r) => recordItemHtml(r, false)).join("");
}

/* ================= 記録フォーム ================= */
let editingId = null;
let selectedRating = 0;

const form = document.getElementById("record-form");
const ratingRow = document.getElementById("f-rating");

function populateSubjectSelects() {
  const opts = subjects
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
    .join("");
  document.getElementById("f-subject").innerHTML = opts;
  document.getElementById("filter-subject").innerHTML =
    `<option value="">すべての教科</option>` + opts;
}

function resetForm() {
  editingId = null;
  form.reset();
  document.getElementById("f-date").value = todayStr();
  setRating(0);
  document.getElementById("form-title").textContent = "学習を記録する";
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
  b.addEventListener("click", () => {
    document.getElementById("f-minutes").value = b.dataset.min;
  });
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const rec = {
    id: editingId || uid(),
    date: document.getElementById("f-date").value,
    subjectId: document.getElementById("f-subject").value,
    content: document.getElementById("f-content").value.trim(),
    minutes: Number(document.getElementById("f-minutes").value),
    rating: selectedRating,
    memo: document.getElementById("f-memo").value.trim(),
    createdAt: editingId
      ? records.find((r) => r.id === editingId)?.createdAt || Date.now()
      : Date.now(),
  };
  if (!rec.date || !rec.subjectId || !rec.content || !(rec.minutes > 0)) return;

  if (editingId) {
    records = records.map((r) => (r.id === editingId ? rec : r));
    toast("記録を更新しました ✏️");
  } else {
    records.push(rec);
    toast("記録しました!えらい! 🎉");
  }
  save(STORE.records, records);
  resetForm();
  showView("home");
});

document.getElementById("cancel-edit-btn").addEventListener("click", () => {
  resetForm();
  showView("list");
});

function startEdit(id) {
  const r = records.find((x) => x.id === id);
  if (!r) return;
  editingId = id;
  document.getElementById("f-id").value = id;
  document.getElementById("f-date").value = r.date;
  document.getElementById("f-subject").value = r.subjectId;
  document.getElementById("f-content").value = r.content;
  document.getElementById("f-minutes").value = r.minutes;
  document.getElementById("f-memo").value = r.memo || "";
  setRating(r.rating || 0);
  document.getElementById("form-title").textContent = "記録を編集する";
  document.getElementById("save-btn").textContent = "更新する";
  document.getElementById("cancel-edit-btn").hidden = false;
  showView("add");
}

function deleteRecord(id) {
  if (!confirm("この記録を削除しますか?")) return;
  records = records.filter((r) => r.id !== id);
  save(STORE.records, records);
  toast("削除しました");
  renderList();
  renderHome();
}

/* ================= 一覧 ================= */
document.getElementById("filter-subject").addEventListener("change", renderList);
document.getElementById("filter-period").addEventListener("change", renderList);

function renderList() {
  const el = document.getElementById("record-list");
  const subj = document.getElementById("filter-subject").value;
  const period = document.getElementById("filter-period").value;

  let list = [...records];
  if (subj) list = list.filter((r) => r.subjectId === subj);
  if (period === "week") {
    const start = dateToStr(weekStart(new Date()));
    list = list.filter((r) => r.date >= start);
  } else if (period === "month") {
    const now = new Date();
    const start = dateToStr(new Date(now.getFullYear(), now.getMonth(), 1));
    list = list.filter((r) => r.date >= start);
  }
  list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  if (list.length === 0) {
    el.innerHTML = `<p class="empty-note">記録が見つかりません</p>`;
    return;
  }

  // 日付ごとにグループ化
  const groups = new Map();
  list.forEach((r) => {
    if (!groups.has(r.date)) groups.set(r.date, []);
    groups.get(r.date).push(r);
  });

  el.innerHTML = [...groups.entries()]
    .map(([date, recs]) => {
      const total = recs.reduce((a, r) => a + r.minutes, 0);
      return `
      <div class="day-group">
        <div class="day-heading"><span>${formatDateLabel(date)}</span><span>${formatMinutes(total)}</span></div>
        ${recs.map((r) => recordItemHtml(r, true)).join("")}
      </div>`;
    })
    .join("");
}

function recordItemHtml(r, withActions) {
  const s = subjectById(r.subjectId);
  const color = subjectColor(r.subjectId);
  return `
    <div class="record-item">
      <div class="rec-stripe" style="background:${color}"></div>
      <div class="rec-body">
        <div class="rec-top">
          <span class="rec-subject">${escapeHtml(s?.name || "(削除された教科)")}</span>
          <span class="rec-minutes">${formatMinutes(r.minutes)}</span>
          ${r.rating ? `<span class="rec-rating">${RATING_EMOJI[r.rating]}</span>` : ""}
        </div>
        <div class="rec-content">${escapeHtml(r.content)}</div>
        ${r.memo ? `<div class="rec-memo">${escapeHtml(r.memo)}</div>` : ""}
      </div>
      ${
        withActions
          ? `<div class="rec-actions">
              <button class="icon-btn" data-edit="${r.id}" aria-label="編集">✏️</button>
              <button class="icon-btn" data-delete="${r.id}" aria-label="削除">🗑️</button>
            </div>`
          : ""
      }
    </div>`;
}

document.getElementById("record-list").addEventListener("click", (e) => {
  const edit = e.target.closest("[data-edit]");
  if (edit) return startEdit(edit.dataset.edit);
  const del = e.target.closest("[data-delete]");
  if (del) return deleteRecord(del.dataset.delete);
});

/* ================= 設定 ================= */
function renderSettings() {
  const ul = document.getElementById("subject-list");
  ul.innerHTML = subjects
    .map(
      (s) => `
      <li>
        <span class="sb-swatch" style="background:${subjectColor(s.id)}"></span>
        <span class="subject-name">${escapeHtml(s.name)}</span>
        <button class="icon-btn" data-del-subject="${s.id}" aria-label="${escapeHtml(s.name)}を削除">🗑️</button>
      </li>`
    )
    .join("");
  document.getElementById("goal-minutes").value = goalMinutes || "";
}

document.getElementById("subject-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("new-subject");
  const name = input.value.trim();
  if (!name) return;
  if (subjects.some((s) => s.name === name)) {
    toast("同じ名前の教科があります");
    return;
  }
  subjects.push({ id: uid(), name });
  save(STORE.subjects, subjects);
  input.value = "";
  populateSubjectSelects();
  renderSettings();
  toast(`「${name}」を追加しました`);
});

document.getElementById("subject-list").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-del-subject]");
  if (!btn) return;
  const id = btn.dataset.delSubject;
  const s = subjectById(id);
  const used = records.filter((r) => r.subjectId === id).length;
  const msg = used > 0
    ? `「${s.name}」には${used}件の記録があります。教科を削除しても記録は残ります。削除しますか?`
    : `「${s.name}」を削除しますか?`;
  if (!confirm(msg)) return;
  subjects = subjects.filter((x) => x.id !== id);
  save(STORE.subjects, subjects);
  populateSubjectSelects();
  renderSettings();
});

document.getElementById("goal-minutes").addEventListener("change", (e) => {
  goalMinutes = Math.max(0, Number(e.target.value) || 0);
  save(STORE.goal, goalMinutes);
  toast(goalMinutes > 0 ? `目標を1日${goalMinutes}分にしました` : "目標をなしにしました");
});

/* ================= 書き出し・読み込み ================= */
document.getElementById("export-btn").addEventListener("click", () => {
  const data = { version: 1, exportedAt: new Date().toISOString(), records, subjects, goalMinutes };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `manabi-log-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.records) || !Array.isArray(data.subjects)) throw new Error("bad format");
    if (!confirm(`${data.records.length}件の記録を読み込みます。今のデータは置きかえられます。よろしいですか?`)) return;
    records = data.records;
    subjects = data.subjects;
    goalMinutes = Number(data.goalMinutes) || 0;
    save(STORE.records, records);
    save(STORE.subjects, subjects);
    save(STORE.goal, goalMinutes);
    populateSubjectSelects();
    renderSettings();
    toast("データを読み込みました");
  } catch {
    toast("読み込めませんでした。ファイルを確認してください");
  } finally {
    e.target.value = "";
  }
});

/* ================= ユーティリティ ================= */
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/* ================= 初期化 ================= */
populateSubjectSelects();
resetForm();
renderHome();

// OSのテーマが切りかわったらグラフの色を描き直す
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (!document.getElementById("view-home").hidden) renderHome();
});
