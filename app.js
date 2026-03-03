/* Планер обороту по картках (LocalStorage) */

const LS_KEY = "turnover_planner_v1";

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
  const last = new Date(y, m, 0).getDate(); // last day
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

function fmtUAH(n) {
  const x = Math.round((Number(n) || 0) * 100) / 100;
  return x.toLocaleString("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 });
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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
      plannedOps: 10,
      maxOpAmount: 5000,
      minGapDays: 5
    },
    ops: []
  };
}

let state = loadState() || defaultState();

/* UI init */
function applySettingsToUI() {
  const s = state.settings;
  $("startDate").value = s.startDate;
  $("endDate").value = s.endDate;
  $("targetPerCard").value = s.targetPerCard;
  $("plannedOps").value = s.plannedOps;
  $("maxOpAmount").value = s.maxOpAmount;
  $("minGapDays").value = s.minGapDays;

  $("opDate").value = todayISO();

  $("periodLabel").textContent = `Період: ${s.startDate} → ${s.endDate}`;
}

function readSettingsFromUI() {
  return {
    startDate: $("startDate").value || state.settings.startDate,
    endDate: $("endDate").value || state.settings.endDate,
    targetPerCard: safeNum($("targetPerCard").value),
    plannedOps: Math.max(1, Math.floor(safeNum($("plannedOps").value))),
    maxOpAmount: Math.max(0, safeNum($("maxOpAmount").value)),
    minGapDays: Math.max(0, Math.floor(safeNum($("minGapDays").value)))
  };
}

function opInPeriod(op, settings) {
  return op.date >= settings.startDate && op.date <= settings.endDate;
}

function computeSummary() {
  const s = state.settings;

  // Filter ops within period
  const ops = state.ops.filter(op => opInPeriod(op, s));

  const byCard = new Map();
  for (let c = 1; c <= 5; c++) {
    byCard.set(String(c), {
      card: c,
      turnover: 0,
      count: 0,
      lastDate: null,
      lastType: null
    });
  }

  for (const op of ops) {
    const k = String(op.card);
    const row = byCard.get(k);
    row.turnover += Math.abs(safeNum(op.amount)); // оборот як ABS
    row.count += 1;
    if (!row.lastDate || op.date > row.lastDate) {
      row.lastDate = op.date;
      row.lastType = op.type;
    }
  }

  const results = [];
  for (let c = 1; c <= 5; c++) {
    const r = byCard.get(String(c));
    const remaining = Math.max(0, s.targetPerCard - r.turnover);
    const remainingOps = Math.max(0, s.plannedOps - r.count);

    // Рекомендований тип: чергування
    let recType = "Поповнення";
    if (r.lastType === "Поповнення") recType = "Використання";
    if (r.lastType === "Використання") recType = "Поповнення";

    // Рекомендована дата: остання + minGapDays, але не раніше startDate і не пізніше endDate
    let baseDate = r.lastDate || s.startDate;
    let recDate = addDaysISO(baseDate, s.minGapDays);
    if (recDate < s.startDate) recDate = s.startDate;
    if (recDate > s.endDate) recDate = s.endDate;

    // Рекомендована сума
    let recAmount = 0;
    if (remaining > 0) {
      const denom = remainingOps > 0 ? remainingOps : 1;
      recAmount = remaining / denom;
      recAmount = Math.min(recAmount, s.maxOpAmount || recAmount);
      // округлення до 10 грн, щоб було "живіше"
      recAmount = Math.max(0, Math.round(recAmount / 10) * 10);
    }

    results.push({
      card: c,
      turnover: r.turnover,
      remaining,
      count: r.count,
      remainingOps,
      lastDate: r.lastDate || "—",
      recDate: remaining > 0 ? recDate : "—",
      recType: remaining > 0 ? recType : "—",
      recAmount
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

    const statusPill = r.remaining === 0
      ? `<span class="pill ok">Ціль досягнута</span>`
      : `<span class="pill warn">В процесі</span>`;

    tr.innerHTML = `
      <td>Карта ${r.card} <div>${statusPill}</div></td>
      <td>${fmtUAH(r.turnover)}</td>
      <td>${fmtUAH(r.remaining)} <div class="muted" style="font-size:12px">ціль: ${fmtUAH(target)}</div></td>
      <td>${r.count}</td>
      <td>${r.remainingOps}</td>
      <td>${r.lastDate}</td>
      <td>${r.recDate}</td>
      <td>${r.recType}</td>
      <td>${r.recAmount ? fmtUAH(r.recAmount) : "—"}</td>
    `;
    tbody.appendChild(tr);
  }
}

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

  // newest first
  const ops = [...state.ops].sort((a, b) => (a.date < b.date ? 1 : -1)).filter(op => matchesSearch(op, q));

  for (const op of ops) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" data-id="${op.id}" /></td>
      <td>${op.date}</td>
      <td>Карта ${op.card}</td>
      <td>${op.type}</td>
      <td>${fmtUAH(op.amount)}</td>
      <td><button class="icon-btn" data-del="${op.id}">Видалити</button></td>
    `;
    tbody.appendChild(tr);
  }

  // bind delete buttons
  tbody.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-del");
      state.ops = state.ops.filter(x => x.id !== id);
      saveState(state);
      renderAll();
    });
  });
}

function renderAll() {
  $("periodLabel").textContent = `Період: ${state.settings.startDate} → ${state.settings.endDate}`;
  renderSummary();
  renderOps();
}

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

  // Проста “логіка лагу” (попередження, а не блокування):
  const minGap = state.settings.minGapDays;
  const last = state.ops
    .filter(o => o.card === card)
    .sort((a,b) => (a.date > b.date ? -1 : 1))[0];

  if (last) {
    const recommended = addDaysISO(last.date, minGap);
    if (date < recommended) {
      // попередження
      err.textContent = `Увага: для карти ${card} рекомендована пауза ${minGap} днів. Рекомендована дата не раніше ${recommended}.`;
      // але все одно додаємо (користувач може мати реальні витрати)
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

function deleteSelected() {
  const checks = Array.from($("opsTable").querySelectorAll('input[type="checkbox"][data-id]:checked'));
  if (checks.length === 0) return alert("Немає вибраних рядків.");
  if (!confirm(`Видалити ${checks.length} операцій?`)) return;

  const ids = new Set(checks.map(c => c.getAttribute("data-id")));
  state.ops = state.ops.filter(op => !ids.has(op.id));
  saveState(state);
  renderAll();
}

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

/* Bind events */
function bind() {
  $("btnAddOp").addEventListener("click", addOp);
  $("btnSaveSettings").addEventListener("click", saveSettings);
  $("btnClear").addEventListener("click", clearAll);
  $("btnDeleteSelected").addEventListener("click", deleteSelected);
  $("btnExport").addEventListener("click", exportJSON);
  $("search").addEventListener("input", renderOps);

  $("fileImport").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) importJSON(file);
    e.target.value = "";
  });
}

/* Start */
applySettingsToUI();
bind();
renderAll();

// PWA: реєстрація Service Worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}