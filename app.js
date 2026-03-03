/* Планер витратного обороту (PWA) */
/* Оборот = сума "Використання" у вибраному періоді */

const LS_KEY = "turnover_planner_v3_spend_only";
const $ = (id) => document.getElementById(id);

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfMonthISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}
function endOfMonthISO(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}
function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDaysISO(iso, days) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function fmtUAH(n) {
  const x = Math.round((Number(n) || 0) * 100) / 100;
  return x.toLocaleString("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 });
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function saveState(state) {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}
function defaultState() {
  const now = new Date();
  return {
    settings: {
      startDate: startOfMonthISO(now),
      endDate: endOfMonthISO(now),
      targetPerCard: 40000,
      plannedSpendOps: 10,
      maxOpAmount: 5000,
      minGapDays: 3,
      holdAfterTopUpDays: 5,
      hideRecsWhenDone: "yes"
    },
    ops: []
  };
}

let state = loadState() || defaultState();

/* helpers */
function opInPeriod(op, settings) {
  return op.date >= settings.startDate && op.date <= settings.endDate;
}
function isSpend(op) { return op.type === "Використання"; }
function isTopUp(op) { return op.type === "Поповнення"; }

/* SETTINGS */
function applySettingsToUI() {
  const s = state.settings;
  $("startDate").value = s.startDate;
  $("endDate").value = s.endDate;
  $("targetPerCard").value = s.targetPerCard;
  $("plannedSpendOps").value = s.plannedSpendOps;
  $("maxOpAmount").value = s.maxOpAmount;
  $("minGapDays").value = s.minGapDays;
  $("holdAfterTopUpDays").value = s.holdAfterTopUpDays;
  $("hideRecsWhenDone").value = s.hideRecsWhenDone;

  $("opDate").value = todayISO();
  $("periodLabel").textContent = `Період: ${s.startDate} → ${s.endDate}`;

  if (!$("chartCard").value) $("chartCard").value = "all";
}

function readSettingsFromUI() {
  return {
    startDate: $("startDate").value || state.settings.startDate,
    endDate: $("endDate").value || state.settings.endDate,
    targetPerCard: Math.max(0, safeNum($("targetPerCard").value)),
    plannedSpendOps: Math.max(1, Math.floor(safeNum($("plannedSpendOps").value))),
    maxOpAmount: Math.max(0, safeNum($("maxOpAmount").value)),
    minGapDays: Math.max(0, Math.floor(safeNum($("minGapDays").value))),
    holdAfterTopUpDays: Math.max(0, Math.floor(safeNum($("holdAfterTopUpDays").value))),
    hideRecsWhenDone: $("hideRecsWhenDone").value === "no" ? "no" : "yes"
  };
}

function saveSettings() {
  state.settings = readSettingsFromUI();
  saveState(state);
  $("settingsSaved").textContent = "Збережено ✓";
  setTimeout(() => $("settingsSaved").textContent = "", 1200);
  renderAll();
}

function clearAll() {
  if (!confirm("Очистити всі дані?")) return;
  state = defaultState();
  saveState(state);
  applySettingsToUI();
  renderAll();
}

/* SUMMARY + RECS */
function computeSummary() {
  const s = state.settings;
  const opsInPeriod = state.ops.filter(op => opInPeriod(op, s));

  const byCard = new Map();
  for (let c = 1; c <= 5; c++) {
    byCard.set(String(c), {
      card: c,
      spendTurnover: 0,
      spendCount: 0,
      lastDateAny: null,
      lastTypeAny: null,
      lastTopUpDate: null,
      lastSpendDate: null
    });
  }

  for (const op of opsInPeriod) {
    const row = byCard.get(String(op.card));

    if (isSpend(op)) {
      row.spendTurnover += Math.abs(safeNum(op.amount));
      row.spendCount += 1;
      if (!row.lastSpendDate || op.date > row.lastSpendDate) row.lastSpendDate = op.date;
    }
    if (isTopUp(op)) {
      if (!row.lastTopUpDate || op.date > row.lastTopUpDate) row.lastTopUpDate = op.date;
    }
    if (!row.lastDateAny || op.date > row.lastDateAny) {
      row.lastDateAny = op.date;
      row.lastTypeAny = op.type;
    }
  }

  const results = [];
  for (let c = 1; c <= 5; c++) {
    const r = byCard.get(String(c));
    const remaining = Math.max(0, s.targetPerCard - r.spendTurnover);
    const remainingSpendOps = Math.max(0, s.plannedSpendOps - r.spendCount);

    const done = remaining === 0;
    const hideRecs = s.hideRecsWhenDone === "yes" && done;

    // recommend type: alternate, but if last was TopUp => suggest Spend
    let recType = "Використання";
    if (r.lastTypeAny === "Використання") recType = "Поповнення";
    if (r.lastTypeAny === "Поповнення") recType = "Використання";

    // recommend date
    let note = "";
    let base = r.lastDateAny || s.startDate;
    let recDate = addDaysISO(base, s.minGapDays);

    if (recType === "Використання" && r.lastTopUpDate && (!r.lastSpendDate || r.lastTopUpDate >= r.lastSpendDate)) {
      const holdDate = addDaysISO(r.lastTopUpDate, s.holdAfterTopUpDays);
      recDate = holdDate;
      note = `Пауза після поповнення: ${s.holdAfterTopUpDays} дн.`;
    } else {
      note = `Мін. пауза: ${s.minGapDays} дн.`;
    }

    if (recDate < s.startDate) recDate = s.startDate;
    if (recDate > s.endDate) recDate = s.endDate;

    // recommend amount
    let recAmount = 0;
    if (!hideRecs && remaining > 0) {
      const denom = remainingSpendOps > 0 ? remainingSpendOps : 1;
      recAmount = remaining / denom;
      recAmount = Math.min(recAmount, s.maxOpAmount || recAmount);
      recAmount = Math.max(0, Math.round(recAmount / 10) * 10);
    }

    results.push({
      card: c,
      spendTurnover: r.spendTurnover,
      remaining,
      spendCount: r.spendCount,
      remainingSpendOps,
      lastDate: r.lastDateAny || "—",
      recDate: hideRecs ? "—" : (remaining > 0 ? recDate : "—"),
      recType: hideRecs ? "—" : (remaining > 0 ? recType : "—"),
      recAmount: hideRecs ? 0 : recAmount,
      note: hideRecs ? "Ціль досягнута" : note
    });
  }

  return results;
}

function renderSummary() {
  const tbody = $("summaryTable").querySelector("tbody");
  tbody.innerHTML = "";

  const rows = computeSummary();
  const target = state.settings.targetPerCard;

  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>Карта ${r.card}</td>
      <td>${fmtUAH(r.spendTurnover)}</td>
      <td>${fmtUAH(r.remaining)} <div class="muted small">ціль: ${fmtUAH(target)}</div></td>
      <td>${r.spendCount}</td>
      <td>${r.remainingSpendOps}</td>
      <td>${r.lastDate}</td>
      <td>${r.recDate}</td>
      <td>${r.recType}</td>
      <td>${r.recAmount ? fmtUAH(r.recAmount) : "—"}</td>
      <td class="muted small">${r.note}</td>
    `;
    tbody.appendChild(tr);
  }
}

/* OPS TABLE + EDIT */
let editingId = null;

function matchesSearch(op, q) {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    op.date.toLowerCase().includes(s) ||
    String(op.card).includes(s) ||
    op.type.toLowerCase().includes(s) ||
    String(op.amount).includes(s)
  );
}

function renderOps() {
  const tbody = $("opsTable").querySelector("tbody");
  const q = ($("search").value || "").trim();
  tbody.innerHTML = "";

  const ops = [...state.ops]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .filter(op => matchesSearch(op, q));

  for (const op of ops) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" data-id="${op.id}"/></td>
      <td>${op.date}</td>
      <td>Карта ${op.card}</td>
      <td>${op.type}</td>
      <td>${fmtUAH(op.amount)}</td>
      <td style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button class="icon-btn" data-edit="${op.id}">Редагувати</button>
        <button class="icon-btn" data-del="${op.id}">Видалити</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-del");
      state.ops = state.ops.filter(x => x.id !== id);
      saveState(state);
      renderAll();
    });
  });

  tbody.querySelectorAll("button[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => openEdit(btn.getAttribute("data-edit")));
  });
}

function openEdit(id) {
  const op = state.ops.find(x => x.id === id);
  if (!op) return;

  editingId = id;
  $("editDate").value = op.date;
  $("editCard").value = String(op.card);
  $("editType").value = op.type;
  $("editAmount").value = op.amount;
  $("editError").textContent = "";

  $("modal").classList.remove("hidden");
  $("modal").setAttribute("aria-hidden", "false");
}

function closeEdit() {
  editingId = null;
  $("modal").classList.add("hidden");
  $("modal").setAttribute("aria-hidden", "true");
}

function saveEdit() {
  const err = $("editError");
  err.textContent = "";
  if (!editingId) return;

  const date = $("editDate").value;
  const card = Number($("editCard").value);
  const type = $("editType").value;
  const amount = safeNum($("editAmount").value);

  if (!date) return (err.textContent = "Вкажи дату.");
  if (![1,2,3,4,5].includes(card)) return (err.textContent = "Обери карту 1–5.");
  if (!["Поповнення","Використання"].includes(type)) return (err.textContent = "Невірний тип.");
  if (!(amount > 0)) return (err.textContent = "Сума має бути більшою за 0.");

  const idx = state.ops.findIndex(x => x.id === editingId);
  if (idx === -1) return;

  state.ops[idx] = { ...state.ops[idx], date, card, type, amount };
  saveState(state);
  closeEdit();
  renderAll();
}

/* ADD OP */
function addOp() {
  const err = $("opError");
  err.textContent = "";

  const date = $("opDate").value;
  const card = Number($("opCard").value);
  const type = $("opType").value;
  const amount = safeNum($("opAmount").value);

  if (!date) return (err.textContent = "Вкажи дату.");
  if (![1,2,3,4,5].includes(card)) return (err.textContent = "Обери карту 1–5.");
  if (!["Поповнення","Використання"].includes(type)) return (err.textContent = "Невірний тип.");
  if (!(amount > 0)) return (err.textContent = "Сума має бути більшою за 0.");

  // warnings (not blocking)
  const s = state.settings;
  const opsCard = state.ops
    .filter(o => o.card === card)
    .sort((a,b) => (a.date > b.date ? -1 : 1));

  const lastAny = opsCard[0];
  const lastTopUp = opsCard.find(o => isTopUp(o));
  const lastSpend = opsCard.find(o => isSpend(o));

  if (lastAny) {
    const rec = addDaysISO(lastAny.date, s.minGapDays);
    if (date < rec) err.textContent = `Увага: рекомендована мін. пауза ${s.minGapDays} дн. Дата не раніше ${rec}.`;
  }
  if (type === "Використання" && lastTopUp) {
    const lastTopUpDate = lastTopUp.date;
    const lastSpendDate = lastSpend ? lastSpend.date : null;
    if (!lastSpendDate || lastTopUpDate >= lastSpendDate) {
      const hold = addDaysISO(lastTopUpDate, s.holdAfterTopUpDays);
      if (date < hold) err.textContent = `Увага: після поповнення рекомендована пауза ${s.holdAfterTopUpDays} дн. Витрата не раніше ${hold}.`;
    }
  }

  state.ops.push({
    id: crypto.randomUUID(),
    date,
    card,
    type,
    amount
  });

  saveState(state);
  $("opAmount").value = "";
  renderAll();
}

/* DELETE SELECTED */
function deleteSelected() {
  const checks = Array.from(document.querySelectorAll('#opsTable input[type="checkbox"][data-id]:checked'));
  if (checks.length === 0) return alert("Немає вибраних рядків.");
  if (!confirm(`Видалити ${checks.length} операцій?`)) return;

  const ids = new Set(checks.map(c => c.getAttribute("data-id")));
  state.ops = state.ops.filter(op => !ids.has(op.id));
  saveState(state);
  renderAll();
}

/* EXPORT / IMPORT */
function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "turnover-planner-data.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(String(reader.result || ""));
      if (!obj || typeof obj !== "object") throw new Error("bad json");
      if (!obj.settings || !Array.isArray(obj.ops)) throw new Error("bad shape");
      state = obj;
      saveState(state);
      applySettingsToUI();
      renderAll();
    } catch {
      alert("Не вдалося імпортувати файл. Перевір JSON.");
    }
  };
  reader.readAsText(file);
}

/* CHART */
function buildDailySpendSeries(cardFilter) {
  const s = state.settings;
  const start = parseISO(s.startDate);
  const end = parseISO(s.endDate);

  const map = new Map(); // date -> spend
  for (const op of state.ops) {
    if (!opInPeriod(op, s)) continue;
    if (!isSpend(op)) continue;
    if (cardFilter !== "all" && String(op.card) !== String(cardFilter)) continue;

    map.set(op.date, (map.get(op.date) || 0) + Math.abs(safeNum(op.amount)));
  }

  const days = [];
  const vals = [];
  let cum = 0;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const iso = `${y}-${m}-${day}`;

    cum += (map.get(iso) || 0);
    days.push(iso);
    vals.push(cum);
  }

  return { days, vals };
}

function drawChart() {
  const canvas = $("progressChart");
  const ctx = canvas.getContext("2d");
  const card = $("chartCard").value;

  // size to CSS box
  const cssW = canvas.clientWidth || 300;
  const cssH = canvas.clientHeight || 260;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const { days, vals } = buildDailySpendSeries(card);

  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 54, padR = 14, padT = 14, padB = 28;
  const w = cssW - padL - padR;
  const h = cssH - padT - padB;

  // grid
  ctx.strokeStyle = "rgba(255,255,255,.08)";
  ctx.lineWidth = 1;
  const gridY = 4;
  for (let i = 0; i <= gridY; i++) {
    const y = padT + (h * i) / gridY;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + w, y);
    ctx.stroke();
  }

  const maxV = Math.max(1, ...vals);
  const minV = 0;

  function xAt(i) {
    if (days.length <= 1) return padL;
    return padL + (w * i) / (days.length - 1);
  }
  function yAt(v) {
    const t = (v - minV) / (maxV - minV);
    return padT + h - t * h;
  }

  // line
  ctx.strokeStyle = "rgba(43,99,255,.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  vals.forEach((v, i) => {
    const x = xAt(i);
    const y = yAt(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // labels
  ctx.fillStyle = "rgba(233,236,255,.85)";
  ctx.font = "12px system-ui";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= gridY; i++) {
    const v = (maxV * (gridY - i)) / gridY;
    const y = padT + (h * i) / gridY;
    ctx.fillText(fmtUAH(v), padL - 8, y);
  }

  // x ticks
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const ticks = Math.min(5, days.length);
  for (let i = 0; i < ticks; i++) {
    const idx = Math.round((days.length - 1) * (i / (ticks - 1 || 1)));
    const x = xAt(idx);
    const label = days[idx].slice(5); // MM-DD
    ctx.fillText(label, x, padT + h + 8);
  }

  // title
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const title = card === "all" ? "Усі карти (витрати)" : `Карта ${card} (витрати)`;
  ctx.fillText(title, padL, 4);
}

/* RENDER */
function renderAll() {
  const s = state.settings;
  $("periodLabel").textContent = `Період: ${s.startDate} → ${s.endDate}`;
  renderSummary();
  renderOps();
  drawChart();
}

/* BIND */
function bind() {
  $("btnAddOp").addEventListener("click", addOp);
  $("btnSaveSettings").addEventListener("click", saveSettings);
  $("btnClear").addEventListener("click", clearAll);
  $("btnDeleteSelected").addEventListener("click", deleteSelected);
  $("btnExport").addEventListener("click", exportJSON);
  $("search").addEventListener("input", renderOps);
  $("chartCard").addEventListener("change", drawChart);

  $("fileImport").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) importJSON(file);
    e.target.value = "";
  });

  // modal
  $("btnCloseModal").addEventListener("click", closeEdit);
  $("btnCancelEdit").addEventListener("click", closeEdit);
  $("btnSaveEdit").addEventListener("click", saveEdit);

  $("modal").addEventListener("click", (e) => {
    if (e.target === $("modal")) closeEdit();
  });

  window.addEventListener("resize", drawChart);

  // ESC close
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("modal").classList.contains("hidden")) closeEdit();
  });
}

/* START */
applySettingsToUI();
bind();
renderAll();

/* PWA: service worker */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
  });

  navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg) return;
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener("statechange", () => {
        if (nw.state === "installed" && navigator.serviceWorker.controller) {
          reg.waiting?.postMessage("SKIP_WAITING");
        }
      });
    });
  });
}