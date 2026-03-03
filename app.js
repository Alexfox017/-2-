const LS_KEY = "turnover_planner_v7_analytics_v303";
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
function daysBetweenInclusive(aISO, bISO) {
  const a = parseISO(aISO);
  const b = parseISO(bISO);
  const ms = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.round((b - a) / ms) + 1);
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
function pct(n) {
  const x = Math.max(0, Number(n) || 0);
  return `${Math.round(x)}%`;
}
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveState(state) {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function defaultState() {
  const now = new Date();
  const mk = (name, target) => ({ id: crypto.randomUUID(), name, target });

  return {
    settings: {
      startDate: startOfMonthISO(now),
      endDate: endOfMonthISO(now),
      targetDefault: 40000,
      plannedSpendOps: 10,
      maxOpAmount: 5000,
      minGapDays: 3,
      holdAfterTopUpDays: 5,
      hideRecsWhenDone: "yes",
      // ✅ ОДРАЗУ 5 банків як раніше
      banks: [
        mk("Приват", 40000),
        mk("Моно", 40000),
        mk("Ощад", 40000),
        mk("Пумб", 40000),
        mk("Абанк", 40000),
      ]
    },
    ops: [] // {id,date,bankId,type,amount}
  };
}

function normalizeState(st) {
  if (!st || typeof st !== "object") return defaultState();
  if (!st.settings) st.settings = {};
  if (!Array.isArray(st.ops)) st.ops = [];

  const s = st.settings;

  if (!s.startDate) s.startDate = startOfMonthISO(new Date());
  if (!s.endDate) s.endDate = endOfMonthISO(new Date());
  if (s.targetDefault == null) s.targetDefault = 40000;

  s.plannedSpendOps = Math.max(1, Math.floor(safeNum(s.plannedSpendOps ?? 10)));
  s.maxOpAmount = Math.max(0, safeNum(s.maxOpAmount ?? 5000));
  s.minGapDays = Math.max(0, Math.floor(safeNum(s.minGapDays ?? 3)));
  s.holdAfterTopUpDays = Math.max(0, Math.floor(safeNum(s.holdAfterTopUpDays ?? 5)));
  s.hideRecsWhenDone = (s.hideRecsWhenDone === "no") ? "no" : "yes";

  if (!Array.isArray(s.banks)) s.banks = [];
  s.banks = s.banks.map((b) => {
    if (typeof b === "string") {
      return { id: crypto.randomUUID(), name: b, target: Math.max(0, safeNum(s.targetDefault)) };
    }
    return {
      id: b?.id || crypto.randomUUID(),
      name: (b?.name || "Без назви").trim() || "Без назви",
      target: Math.max(0, safeNum(b?.target ?? s.targetDefault))
    };
  });

  const bankIds = new Set(s.banks.map(b => b.id));
  st.ops = st.ops
    .filter(op => op && typeof op === "object")
    .map(op => ({
      id: op.id || crypto.randomUUID(),
      date: op.date,
      bankId: op.bankId,
      type: op.type,
      amount: safeNum(op.amount)
    }))
    .filter(op =>
      op.date && bankIds.has(op.bankId) &&
      (op.type === "Поповнення" || op.type === "Використання") &&
      op.amount > 0
    );

  // якщо раптом банків 0 — повернемо 5 дефолтних
  if (st.settings.banks.length === 0) {
    return defaultState();
  }

  return st;
}

let state = normalizeState(loadState()) || defaultState();
saveState(state);

/* Helpers */
function isSpend(op) { return op.type === "Використання"; }
function isTopUp(op) { return op.type === "Поповнення"; }
function opInPeriod(op, s) { return op.date >= s.startDate && op.date <= s.endDate; }

function bankById(id) {
  return state.settings.banks.find(b => b.id === id) || null;
}
function bankName(id) {
  return bankById(id)?.name || "—";
}

/* Selects */
function rebuildBankSelects() {
  const banks = state.settings.banks;
  const opBank = $("opBank");
  const editBank = $("editBank");

  const opVal = opBank.value;
  const editVal = editBank.value;

  opBank.innerHTML = "";
  editBank.innerHTML = "";

  for (const b of banks) {
    const o1 = document.createElement("option");
    o1.value = b.id;
    o1.textContent = b.name;
    opBank.appendChild(o1);

    const o2 = document.createElement("option");
    o2.value = b.id;
    o2.textContent = b.name;
    editBank.appendChild(o2);
  }

  if (banks.some(b => b.id === opVal)) opBank.value = opVal;
  if (banks.some(b => b.id === editVal)) editBank.value = editVal;
  if (!opBank.value && banks[0]) opBank.value = banks[0].id;
}

/* Banks UI */
function renderBanksList() {
  const container = $("banksList");
  container.innerHTML = "";
  const banks = state.settings.banks;

  banks.forEach((b, idx) => {
    const row = document.createElement("div");
    row.className = "bank-item";
    row.innerHTML = `
      <div class="muted small" style="min-width:34px">#${idx + 1}</div>

      <input data-bankname="${b.id}" value="${escapeHtml(b.name)}" placeholder="Назва банку" />

      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <span class="muted small">Ціль</span>
        <input data-banktarget="${b.id}" type="number" min="0" step="100"
               value="${Number(Math.max(0, safeNum(b.target)))}" style="width:160px" />
      </div>

      <div class="bank-actions">
        <button class="icon-btn" type="button" data-up="${b.id}">↑</button>
        <button class="icon-btn" type="button" data-down="${b.id}">↓</button>
        <button class="icon-btn" type="button" data-delbank="${b.id}">Видалити</button>
      </div>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll("input[data-bankname]").forEach(inp => {
    inp.addEventListener("input", () => {
      const id = inp.getAttribute("data-bankname");
      const bank = bankById(id);
      if (!bank) return;
      bank.name = inp.value.trim() || "Без назви";
      saveState(state);
      rebuildBankSelects();
      renderAll();
    });
  });

  container.querySelectorAll("input[data-banktarget]").forEach(inp => {
    inp.addEventListener("input", () => {
      const id = inp.getAttribute("data-banktarget");
      const bank = bankById(id);
      if (!bank) return;
      bank.target = Math.max(0, safeNum(inp.value));
      saveState(state);
      renderAll();
    });
  });

  container.querySelectorAll("button[data-up]").forEach(btn => {
    btn.addEventListener("click", () => moveBank(btn.getAttribute("data-up"), -1));
  });
  container.querySelectorAll("button[data-down]").forEach(btn => {
    btn.addEventListener("click", () => moveBank(btn.getAttribute("data-down"), +1));
  });
  container.querySelectorAll("button[data-delbank]").forEach(btn => {
    btn.addEventListener("click", () => deleteBank(btn.getAttribute("data-delbank")));
  });
}

function addBank() {
  const name = ($("bankNameInput").value || "").trim();
  if (!name) return;

  const targetDefault = Math.max(0, safeNum($("targetDefault").value || state.settings.targetDefault));

  state.settings.banks.push({
    id: crypto.randomUUID(),
    name,
    target: targetDefault
  });

  $("bankNameInput").value = "";
  saveState(state);

  rebuildBankSelects();
  renderBanksList();
  renderAll();
}

function moveBank(id, dir) {
  const banks = state.settings.banks;
  const i = banks.findIndex(b => b.id === id);
  if (i === -1) return;
  const j = i + dir;
  if (j < 0 || j >= banks.length) return;

  [banks[i], banks[j]] = [banks[j], banks[i]];
  saveState(state);

  rebuildBankSelects();
  renderBanksList();
  renderAll();
}

function deleteBank(id) {
  const used = state.ops.some(op => op.bankId === id);
  if (used) {
    alert("Не можна видалити банк, бо він використовується в операціях. Спочатку видали/зміни ці операції.");
    return;
  }
  const bank = bankById(id);
  if (!bank) return;
  if (!confirm(`Видалити банк "${bank.name}"?`)) return;

  state.settings.banks = state.settings.banks.filter(b => b.id !== id);
  saveState(state);

  rebuildBankSelects();
  renderBanksList();
  renderAll();
}

/* Settings UI */
function applySettingsToUI() {
  const s = state.settings;
  $("startDate").value = s.startDate;
  $("endDate").value = s.endDate;
  $("targetDefault").value = s.targetDefault;
  $("plannedSpendOps").value = s.plannedSpendOps;
  $("maxOpAmount").value = s.maxOpAmount;
  $("minGapDays").value = s.minGapDays;
  $("holdAfterTopUpDays").value = s.holdAfterTopUpDays;
  $("hideRecsWhenDone").value = s.hideRecsWhenDone;

  $("opDate").value = todayISO();

  rebuildBankSelects();
  renderBanksList();
}

function saveSettings() {
  const s = state.settings;

  s.startDate = $("startDate").value || s.startDate;
  s.endDate = $("endDate").value || s.endDate;

  s.targetDefault = Math.max(0, safeNum($("targetDefault").value));
  s.plannedSpendOps = Math.max(1, Math.floor(safeNum($("plannedSpendOps").value)));
  s.maxOpAmount = Math.max(0, safeNum($("maxOpAmount").value));
  s.minGapDays = Math.max(0, Math.floor(safeNum($("minGapDays").value)));
  s.holdAfterTopUpDays = Math.max(0, Math.floor(safeNum($("holdAfterTopUpDays").value)));
  s.hideRecsWhenDone = $("hideRecsWhenDone").value === "no" ? "no" : "yes";

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

/* Analytics computations */
function computeByBank() {
  const s = state.settings;
  const banks = s.banks;
  const opsInPeriod = state.ops.filter(op => opInPeriod(op, s));

  const by = new Map();
  for (const b of banks) {
    by.set(b.id, {
      spendSum: 0,
      topUpSum: 0,
      spendCount: 0,
      topUpCount: 0,
      maxSpend: 0,
      maxTopUp: 0,
      lastDateAny: null,
      lastTypeAny: null,
      lastTopUpDate: null,
      lastSpendDate: null
    });
  }

  for (const op of opsInPeriod) {
    const row = by.get(op.bankId);
    if (!row) continue;

    if (isSpend(op)) {
      const a = Math.abs(safeNum(op.amount));
      row.spendSum += a;
      row.spendCount += 1;
      row.maxSpend = Math.max(row.maxSpend, a);
      if (!row.lastSpendDate || op.date > row.lastSpendDate) row.lastSpendDate = op.date;
    } else {
      const a = Math.abs(safeNum(op.amount));
      row.topUpSum += a;
      row.topUpCount += 1;
      row.maxTopUp = Math.max(row.maxTopUp, a);
      if (!row.lastTopUpDate || op.date > row.lastTopUpDate) row.lastTopUpDate = op.date;
    }

    if (!row.lastDateAny || op.date > row.lastDateAny) {
      row.lastDateAny = op.date;
      row.lastTypeAny = op.type;
    }
  }

  return by;
}

function computeSummary() {
  const s = state.settings;
  const banks = s.banks;
  const by = computeByBank();

  const results = [];
  for (const b of banks) {
    const r = by.get(b.id);
    const target = Math.max(0, safeNum(b.target ?? s.targetDefault));
    const spendTurnover = r.spendSum;
    const remaining = Math.max(0, target - spendTurnover);
    const pctDone = target > 0 ? (spendTurnover / target) * 100 : 0;

    const remainingSpendOps = Math.max(0, s.plannedSpendOps - r.spendCount);
    const done = remaining === 0;
    const hideRecs = s.hideRecsWhenDone === "yes" && done;

    // recommendation
    let recType = "Використання";
    if (r.lastTypeAny === "Використання") recType = "Поповнення";
    if (r.lastTypeAny === "Поповнення") recType = "Використання";

    let note = "";
    let base = r.lastDateAny || s.startDate;
    let recDate = addDaysISO(base, s.minGapDays);

    if (recType === "Використання" && r.lastTopUpDate && (!r.lastSpendDate || r.lastTopUpDate >= r.lastSpendDate)) {
      recDate = addDaysISO(r.lastTopUpDate, s.holdAfterTopUpDays);
      note = `Пауза після поповнення: ${s.holdAfterTopUpDays} дн.`;
    } else {
      note = `Мін. пауза: ${s.minGapDays} дн.`;
    }

    if (recDate < s.startDate) recDate = s.startDate;
    if (recDate > s.endDate) recDate = s.endDate;

    let recAmount = 0;
    if (!hideRecs && remaining > 0) {
      const denom = remainingSpendOps > 0 ? remainingSpendOps : 1;
      recAmount = remaining / denom;
      recAmount = Math.min(recAmount, s.maxOpAmount || recAmount);
      recAmount = Math.max(0, Math.round(recAmount / 10) * 10);
    }

    results.push({
      bankId: b.id,
      bankName: b.name,
      target,
      spendTurnover,
      pctDone,
      remaining,
      spendCount: r.spendCount,
      topUpCount: r.topUpCount,
      topUpSum: r.topUpSum,
      lastDate: r.lastDateAny || "—",
      recDate: hideRecs ? "—" : (remaining > 0 ? recDate : "—"),
      recType: hideRecs ? "—" : (remaining > 0 ? recType : "—"),
      recAmount: hideRecs ? 0 : recAmount,
      note: hideRecs ? "Ціль досягнута" : note
    });
  }

  return results;
}

function computeTopAnalytics() {
  const s = state.settings;
  const ops = state.ops.filter(op => opInPeriod(op, s));
  const spendOps = ops.filter(isSpend);
  const topUpOps = ops.filter(isTopUp);

  const totalSpend = spendOps.reduce((sum, o) => sum + Math.abs(safeNum(o.amount)), 0);
  const totalTopUp = topUpOps.reduce((sum, o) => sum + Math.abs(safeNum(o.amount)), 0);
  const days = daysBetweenInclusive(s.startDate, s.endDate);

  const avgDailySpend = totalSpend / days;
  const avgSpendOp = spendOps.length ? totalSpend / spendOps.length : 0;

  const maxSpend = spendOps.reduce((m, o) => Math.max(m, Math.abs(safeNum(o.amount))), 0);
  const maxTopUp = topUpOps.reduce((m, o) => Math.max(m, Math.abs(safeNum(o.amount))), 0);

  const banksCount = s.banks.length;

  return {
    totalSpend, totalTopUp, days,
    spendCount: spendOps.length,
    topUpCount: topUpOps.length,
    avgDailySpend,
    avgSpendOp,
    maxSpend,
    maxTopUp,
    banksCount
  };
}

/* Render analytics */
function renderAnalyticsTop() {
  const a = computeTopAnalytics();
  const el = $("analyticsTop");
  el.innerHTML = "";

  const cards = [
    { title: "Витратний оборот (сума “Використання”)", value: fmtUAH(a.totalSpend), sub: `Операцій витрат: ${a.spendCount}` },
    { title: "Поповнення (сума)", value: fmtUAH(a.totalTopUp), sub: `Операцій поповнення: ${a.topUpCount}` },
    { title: "Середні витрати", value: fmtUAH(a.avgDailySpend) + " / день", sub: `Сер. на 1 витратну операцію: ${fmtUAH(a.avgSpendOp)}` },
    { title: "Максимуми", value: `Витрата: ${fmtUAH(a.maxSpend)}`, sub: `Поповнення: ${fmtUAH(a.maxTopUp)} • Банків: ${a.banksCount}` },
  ];

  for (const c of cards) {
    const d = document.createElement("div");
    d.className = "a-card";
    d.innerHTML = `
      <div class="a-title">${escapeHtml(c.title)}</div>
      <div class="a-value">${escapeHtml(c.value)}</div>
      <div class="a-sub">${escapeHtml(c.sub)}</div>
    `;
    el.appendChild(d);
  }
}

function renderTurnoverStrip() {
  const rows = computeSummary();
  const strip = $("turnoverStrip");
  strip.innerHTML = "";

  for (const r of rows) {
    const item = document.createElement("div");
    item.className = "turnover-item";
    item.innerHTML = `
      <div class="turnover-name">${escapeHtml(r.bankName)}</div>
      <div class="turnover-value">${fmtUAH(r.spendTurnover)}</div>
      <div class="turnover-sub">
        Ціль: ${fmtUAH(r.target)} • ${pct(r.pctDone)}<br>
        Залишок: ${fmtUAH(r.remaining)}
      </div>
    `;
    strip.appendChild(item);
  }
}

function renderSummary() {
  const tbody = $("summaryTable").querySelector("tbody");
  tbody.innerHTML = "";

  const rows = computeSummary();
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.bankName)}</td>
      <td>${fmtUAH(r.target)}</td>
      <td>${fmtUAH(r.spendTurnover)}</td>
      <td>${pct(r.pctDone)}</td>
      <td>${fmtUAH(r.remaining)}</td>
      <td>${r.spendCount}</td>
      <td>${r.topUpCount}</td>
      <td>${fmtUAH(r.topUpSum)}</td>
      <td>${r.lastDate}</td>
      <td>${r.recDate}</td>
      <td>${r.recType}</td>
      <td>${r.recAmount ? fmtUAH(r.recAmount) : "—"}</td>
      <td class="muted small">${escapeHtml(r.note)}</td>
    `;
    tbody.appendChild(tr);
  }
}

/* Ops table + edit */
let editingId = null;

function matchesSearch(op, q) {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    op.date.toLowerCase().includes(s) ||
    bankName(op.bankId).toLowerCase().includes(s) ||
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
      <td>${escapeHtml(bankName(op.bankId))}</td>
      <td>${op.type}</td>
      <td>${fmtUAH(op.amount)}</td>
      <td style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button class="icon-btn" type="button" data-edit="${op.id}">Редагувати</button>
        <button class="icon-btn" type="button" data-del="${op.id}">Видалити</button>
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
  $("editBank").value = op.bankId;
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
  const bankId = $("editBank").value;
  const type = $("editType").value;
  const amount = safeNum($("editAmount").value);

  if (!date) return (err.textContent = "Вкажи дату.");
  if (!bankById(bankId)) return (err.textContent = "Обери банк.");
  if (!["Поповнення","Використання"].includes(type)) return (err.textContent = "Невірний тип.");
  if (!(amount > 0)) return (err.textContent = "Сума має бути більшою за 0.");

  const idx = state.ops.findIndex(x => x.id === editingId);
  if (idx === -1) return;

  state.ops[idx] = { ...state.ops[idx], date, bankId, type, amount };
  saveState(state);
  closeEdit();
  renderAll();
}

/* Add op */
function addOp() {
  const err = $("opError");
  err.textContent = "";

  const date = $("opDate").value;
  const bankId = $("opBank").value;
  const type = $("opType").value;
  const amount = safeNum($("opAmount").value);

  if (!date) return (err.textContent = "Вкажи дату.");
  if (!bankById(bankId)) return (err.textContent = "Обери банк.");
  if (!["Поповнення","Використання"].includes(type)) return (err.textContent = "Невірний тип.");
  if (!(amount > 0)) return (err.textContent = "Сума має бути більшою за 0.");

  state.ops.push({ id: crypto.randomUUID(), date, bankId, type, amount });
  saveState(state);
  $("opAmount").value = "";
  renderAll();
}

/* Delete selected */
function deleteSelected() {
  const checks = Array.from(document.querySelectorAll('#opsTable input[type="checkbox"][data-id]:checked'));
  if (checks.length === 0) return alert("Немає вибраних рядків.");
  if (!confirm(`Видалити ${checks.length} операцій?`)) return;

  const ids = new Set(checks.map(c => c.getAttribute("data-id")));
  state.ops = state.ops.filter(op => !ids.has(op.id));
  saveState(state);
  renderAll();
}

/* Export/Import */
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
      state = normalizeState(JSON.parse(String(reader.result || "")));
      saveState(state);
      applySettingsToUI();
      renderAll();
    } catch {
      alert("Не вдалося імпортувати файл. Перевір JSON.");
    }
  };
  reader.readAsText(file);
}

/* Live period analytics (без натискання “Зберегти”) */
function liveUpdatePeriod() {
  state.settings.startDate = $("startDate").value || state.settings.startDate;
  state.settings.endDate = $("endDate").value || state.settings.endDate;
  renderAll();
}

/* Render all */
function renderAll() {
  const s = state.settings;
  $("periodLabel").textContent = `Період: ${s.startDate} → ${s.endDate} (${daysBetweenInclusive(s.startDate, s.endDate)} дн.)`;
  rebuildBankSelects();
  renderAnalyticsTop();
  renderTurnoverStrip();
  renderSummary();
  renderOps();
}

/* Bind */
function bind() {
  $("btnAddOp").addEventListener("click", addOp);
  $("btnSaveSettings").addEventListener("click", saveSettings);
  $("btnClear").addEventListener("click", clearAll);
  $("btnDeleteSelected").addEventListener("click", deleteSelected);
  $("btnExport").addEventListener("click", exportJSON);
  $("search").addEventListener("input", renderOps);

  $("btnAddBank").addEventListener("click", addBank);
  $("bankNameInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addBank(); });

  $("fileImport").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) importJSON(file);
    e.target.value = "";
  });

  $("btnCloseModal").addEventListener("click", closeEdit);
  $("btnCancelEdit").addEventListener("click", closeEdit);
  $("btnSaveEdit").addEventListener("click", saveEdit);

  $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeEdit(); });

  // ✅ LIVE аналітика за період
  $("startDate").addEventListener("input", liveUpdatePeriod);
  $("endDate").addEventListener("input", liveUpdatePeriod);
}

/* Start */
applySettingsToUI();
bind();
renderAll();

/* PWA SW registration */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js?v=303").catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
}