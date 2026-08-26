import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Camera, Plus, TrendingUp, TrendingDown, X, Check, Loader2, PieChart,
  Wallet as WalletIcon, ChevronLeft, ChevronRight, Sparkles, Trash2,
  Search, Users, Copy, LogOut, Repeat, AlertTriangle, SlidersHorizontal,
  Pencil, ListPlus, Download, FileText,
} from "lucide-react";
import { LineChart, Line, XAxis, Tooltip, ResponsiveContainer } from "recharts";

// ---------- палитра и токены ----------
const C = {
  // Apple-like dark system palette: SF Pro, system materials, iOS semantic colors.
  bg: "#000000",
  surface: "#1C1C1E",
  surface2: "#2C2C2E",
  border: "#38383A",
  borderSoft: "#2C2C2E",
  text: "#F2F2F7",
  textDim: "#98989D",
  textFaint: "#636366",
  income: "#30D158",
  incomeDim: "rgba(48,209,88,0.16)",
  expense: "#FF453A",
  expenseDim: "rgba(255,69,58,0.16)",
  gold: "#0A84FF",
  goldDim: "rgba(10,132,255,0.16)",
  blue: "#0A84FF",
  blueDim: "rgba(10,132,255,0.16)",
  purple: "#BF5AF2",
  yellow: "#FFD60A",
  cyan: "#64D2FF",
};
const FONT_BODY = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";
const FONT_MONO = "ui-monospace, 'SF Mono', 'SF Mono Regular', Menlo, monospace";
const MONTHS_RU = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

// ---------- утилиты ----------
function uid() { return Date.now() + "-" + Math.random().toString(36).slice(2, 9); }
function fmt(n) { return (Number(n) || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 }); }
function catColor(name) {
  if (!name) return "#8D8F97";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const palette = ["#0A84FF", "#64D2FF", "#30D158", "#FFD60A", "#FF9F0A", "#FF375F", "#BF5AF2"];
  return palette[Math.abs(hash) % palette.length];
}
function haptic() { try { navigator.vibrate && navigator.vibrate(10); } catch (e) {} }
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}
function toDateInput(d) {
  const dt = new Date(d);
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
function fromDateInput(s) { return new Date(s + "T12:00:00").toISOString(); }
function catBreakdown(list) {
  const map = {};
  list.forEach((t) => (map[t.category] = (map[t.category] || 0) + t.amount));
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}
function sameMonth(d, ref) { return d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear(); }

// ---------- API ----------
async function callApi(path, body, options = {}) {
  const apiUrl = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
  if (!apiUrl) throw new Error("VITE_API_URL is not configured");
  const method = options.method || "POST";
  const requestOptions = {
    method,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  };
  if (method !== "GET" && method !== "HEAD") requestOptions.body = options.body === undefined ? JSON.stringify(body || {}) : options.body;
  const response = await fetch(`${apiUrl}${path}`, requestOptions);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.error || `API error ${response.status}`);
    err.status = response.status; err.code = data?.code;
    throw err;
  }
  return data;
}

async function prepareImage(file) {
  if (!file.type.startsWith("image/")) throw new Error("Поддерживаются только изображения");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url;
    });
    const maxSide = 2200;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    return { base64: dataUrl.split(",")[1], mediaType: "image/jpeg" };
  } finally { URL.revokeObjectURL(url); }
}

// ---------- вызов ИИ для распознавания чека ----------
function extractJsonObject(text) {
  const raw = String(text || "").replace(/```json|```/gi, "").trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  const candidate = first >= 0 && last > first ? raw.slice(first, last + 1) : raw;
  return JSON.parse(candidate);
}

async function analyzeReceipt(base64, mediaType, existingCategories, txnType, merchantMap) {
  const catList = existingCategories.length ? existingCategories.join(", ") : "категорий пока нет";
  const kindWord = txnType === "income" ? "дохода" : "расхода";
  const mapEntries = Object.entries(merchantMap || {}).slice(0, 25);
  const mapHint = mapEntries.length ? mapEntries.map(([m, c]) => `${m} → ${c}`).join("; ") : "нет данных";
  const prompt = `Ты — точный финансовый OCR и vision-анализатор. На изображении может быть бумажный чек, банковский скриншот, экран оплаты, электронный чек или заказ маркетплейса. Это ${kindWord}.

Сначала внимательно прочитай ВСЕ видимые суммы и даты. Ничего не выдумывай.

Верни ТОЛЬКО один JSON-объект без markdown и без пояснений:
{"date":"YYYY-MM-DD или null","merchant":"строка","items":[{"amount":число,"category":"строка","description":"строка"}]}

КРИТИЧЕСКИ ВАЖНО:
- amount — итоговая сумма фактической оплаты/списания/зачисления в рублях.
- НЕ бери баланс карты, доступный остаток, номер заказа, бонусы, кешбэк, размер скидки или стоимость до скидки.
- На банковском скриншоте ищи подписи «Сумма», «Списано», «Оплачено», «Перевод», «Зачисление» и используй соответствующее число.
- На маркетплейсе ищи «Итого», «Оплата», «К оплате», «Сумма заказа».
- На чеке ищи «ИТОГО», «К ОПЛАТЕ» или эквивалент.
- date — дата САМОЙ ОПЕРАЦИИ с изображения, не сегодняшняя дата.
- Если на чеке несколько товаров из разных смысловых категорий, раздели их на items. Если это один перевод/платёж/услуга — один item.
- category — короткое русское название 1–2 слова. Известные категории: [${catList}]. Известные соответствия магазин→категория: ${mapHint}.
- merchant — магазин, сервис, банк, отправитель или получатель, если виден.
- description — 2–5 слов.
- Если данных недостаточно, верни items: [] вместо выдуманных значений.`;

  async function runVision(extra = "") {
    const data = await callApi("/ai", { base64, mediaType, prompt: `${prompt}\n${extra}` });
    const rawText = data?.text ?? data?.response ?? data?.result?.response ?? data?.result ?? "";
    return extractJsonObject(rawText);
  }

  let parsed;
  try {
    parsed = await runVision("Особенно проверь, что amount — это реальная сумма операции, а не баланс или сумма до скидки.");
  } catch (firstError) {
    try {
      parsed = await runVision("Повтори анализ изображения медленно и буквально по тексту. Если видна одна явная сумма покупки/списания — используй её.");
    } catch (secondError) {
      throw new Error(firstError?.message || "ИИ не смог разобрать изображение");
    }
  }

  parsed.items = Array.isArray(parsed.items)
    ? parsed.items.filter((it) => Number.isFinite(Number(it.amount)) && Number(it.amount) > 0).map((it) => ({
      amount: Number(it.amount),
      category: String(it.category || "Без категории"),
      description: String(it.description || "")
    }))
    : [];
  parsed.merchant = String(parsed.merchant || "");
  parsed.date = parsed.date || null;

  if (!parsed.items.length) throw new Error("Не удалось уверенно определить сумму. Проверьте изображение или введите сумму вручную.");
  return parsed;
}

// ---------- мелкие переиспользуемые атомы ----------
function Segmented({ value, onChange, options }) {
  return (
    <div style={{ display: "flex", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 14, padding: 4, gap: 4 }}>
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <button key={opt.key} onClick={() => onChange(opt.key)}
            style={{
              flex: 1, padding: "10px 0", borderRadius: 10, border: "none", cursor: "pointer",
              fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13,
              background: active ? (opt.dim || C.goldDim) : "transparent",
              color: active ? (opt.color || C.gold) : C.textDim, transition: "all .15s ease",
            }}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
function Chip({ label, active, color, onClick, small }) {
  return (
    <button onClick={onClick} style={{
      flexShrink: 0, padding: small ? "5px 10px" : "8px 14px", borderRadius: 999, fontFamily: FONT_BODY,
      fontSize: small ? 12 : 13, fontWeight: 600, cursor: "pointer",
      border: `1px solid ${active ? color : C.border}`, background: active ? color + "22" : C.surface2,
      color: active ? color : C.textDim, whiteSpace: "nowrap",
    }}>
      {label}
    </button>
  );
}
function FieldLabel({ children }) {
  return <div style={{ fontSize: 11.5, color: C.textFaint, fontWeight: 700, margin: "12px 2px 6px", letterSpacing: 0.3 }}>{children}</div>;
}
function inputStyle(mono) {
  return {
    width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12,
    padding: "12px 14px", color: C.text, fontSize: mono ? 20 : 14,
    fontFamily: mono ? FONT_MONO : FONT_BODY, fontWeight: mono ? 700 : 500,
  };
}
const btnStyle = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 7, border: "none",
  borderRadius: 15, padding: "13px 0", fontWeight: 750, fontSize: 14, cursor: "pointer", fontFamily: FONT_BODY,
  letterSpacing: "-0.01em", transition: "transform .16s ease, filter .16s ease, box-shadow .16s ease",
};
function StatCard({ icon, label, value, color }) {
  return (
    <div style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        {icon}<span style={{ fontSize: 12, color: C.textDim, fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 20, fontWeight: 700, color }}>{fmt(value)} ₽</div>
    </div>
  );
}
function EmptyState({ icon, title, hint }) {
  return (
    <div style={{ textAlign: "center", padding: "36px 20px", color: C.textFaint }}>
      <div style={{ width: 52, height: 52, borderRadius: 99, background: C.surface2, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
        {icon}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.textDim, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12.5, maxWidth: 240, margin: "0 auto" }}>{hint}</div>
    </div>
  );
}

// ---------- строка операции со свайпом ----------
function TxRow({ t, last, onDelete, onEdit }) {
  const rowRef = useRef(null);
  const [dragX, setDragX] = useState(0);
  const dragging = useRef(false);
  const startX = useRef(0);

  function onDown(e) {
    dragging.current = true;
    startX.current = (e.touches ? e.touches[0].clientX : e.clientX);
  }
  function onMove(e) {
    if (!dragging.current) return;
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const dx = Math.min(0, Math.max(x - startX.current, -88));
    setDragX(dx);
  }
  function onUp() {
    dragging.current = false;
    setDragX((prev) => (prev < -55 ? -88 : 0));
  }
  const isExpense = t.type === "expense";
  const d = new Date(t.date);
  const dateStr = d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });

  return (
    <div style={{ position: "relative", overflow: "hidden", borderBottom: last ? "none" : `1px dashed ${C.borderSoft}` }}>
      <div style={{
        position: "absolute", right: 0, top: 0, bottom: 0, width: 88, background: C.expense,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
        onClick={() => { haptic(); onDelete(t); setDragX(0); }}>
        <Trash2 size={18} color="#fff" />
      </div>
      <div
        ref={rowRef}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
        onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
        onClick={() => { if (dragX === 0) onEdit(t); else setDragX(0); }}
        style={{
          display: "flex", alignItems: "center", gap: 12, padding: "12px 12px", background: C.surface,
          transform: `translateX(${dragX}px)`, transition: dragging.current ? "none" : "transform .2s ease",
          cursor: "pointer", touchAction: "pan-y",
        }}
      >
        <div style={{
          width: 34, height: 34, borderRadius: 10, background: catColor(t.category) + "26", color: catColor(t.category),
          display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, flexShrink: 0,
        }}>
          {t.category?.[0]?.toUpperCase() || "?"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 5 }}>
            {t.category}
            {t.recurring && <Repeat size={11} color={C.textFaint} />}
            {t.includeInFamily && <Users size={11} color={C.gold} />}
          </div>
          <div style={{ fontSize: 12, color: C.textFaint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {t.description || dateStr}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: 700, color: isExpense ? C.expense : C.income }}>
            {isExpense ? "−" : "+"}{fmt(t.amount)} ₽
          </div>
          <div style={{ fontSize: 11, color: C.textFaint }}>{dateStr}</div>
        </div>
      </div>
    </div>
  );
}

// ---------- модалка редактирования операции ----------
function EditModal({ tx, onSave, onDelete, onClose, familyJoined }) {
  const [f, setF] = useState({ ...tx, dateInput: toDateInput(tx.date) });
  const color = f.type === "expense" ? C.expense : C.income;
  const [makeRecurring, setMakeRecurring] = useState(!!tx.recurring);
  const [recurringFreq, setRecurringFreq] = useState(tx.recurringFreq || "monthly");
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 100,
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }} onClick={onClose}>
      <div className="fade-up" onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 460, background: C.surface, borderTop: `1px solid ${C.border}`,
        borderRadius: "20px 20px 0 0", padding: 20, maxHeight: "85vh", overflowY: "auto",
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 4, background: C.border, margin: "0 auto 16px" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Изменить операцию</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer" }}><X size={20} /></button>
        </div>

        <FieldLabel>Тип</FieldLabel>
        <Segmented
          value={f.type}
          onChange={(v) => setF({ ...f, type: v })}
          options={[
            { key: "expense", label: "Расход", color: C.expense, dim: C.expenseDim },
            { key: "income", label: "Доход", color: C.income, dim: C.incomeDim },
          ]}
        />
        <FieldLabel>Сумма, ₽</FieldLabel>
        <input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} style={inputStyle(true)} />
        <FieldLabel>Категория</FieldLabel>
        <input type="text" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} style={inputStyle(false)} />
        <FieldLabel>Описание</FieldLabel>
        <input type="text" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={inputStyle(false)} />
        <FieldLabel>Дата</FieldLabel>
        <input type="date" value={f.dateInput} onChange={(e) => setF({ ...f, dateInput: e.target.value })} style={inputStyle(false)} />

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13, color: C.textDim, cursor: "pointer" }}>
          <input type="checkbox" checked={makeRecurring} onChange={(e) => setMakeRecurring(e.target.checked)} />
          <Repeat size={14} /> Сделать регулярным
        </label>
        {makeRecurring && (
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Chip label="Каждый месяц" active={recurringFreq === "monthly"} color={C.gold} onClick={() => setRecurringFreq("monthly")} />
            <Chip label="Каждую неделю" active={recurringFreq === "weekly"} color={C.gold} onClick={() => setRecurringFreq("weekly")} />
          </div>
        )}

        {familyJoined && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13, color: C.textDim, cursor: "pointer" }}>
            <input type="checkbox" checked={!!f.includeInFamily} onChange={(e) => setF({ ...f, includeInFamily: e.target.checked })} />
            Включить в семейный бюджет
          </label>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button onClick={() => onDelete(tx)} style={{ ...btnStyle, background: C.expenseDim, color: C.expense, padding: "12px 16px" }}>
            <Trash2 size={15} /> Удалить
          </button>
          <button
            onClick={() => {
              if (!f.amount || Number(f.amount) <= 0 || !f.category.trim()) return;
              onSave({ ...f, amount: Number(f.amount), date: fromDateInput(f.dateInput), recurringWanted: makeRecurring, recurringFreq });
            }}
            style={{ ...btnStyle, flex: 1, background: color, color: "#0B0C10" }}
          >
            <Check size={15} /> Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

// ========================= APP =========================
export default function WalletApp() {
  const [loaded, setLoaded] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [budgets, setBudgets] = useState({});
  const [merchantMap, setMerchantMap] = useState({});
  const [family, setFamily] = useState({ code: null, nickname: "" });
  const [deviceId, setDeviceId] = useState(null);
  const [familyTx, setFamilyTx] = useState([]);
  const [familyMembers, setFamilyMembers] = useState([]);
  const [familyLoading, setFamilyLoading] = useState(false);

  const [tab, setTab] = useState("home");
  const [editingTx, setEditingTx] = useState(null);
  const [toast, setToast] = useState(null);
  const undoRef = useRef(null);

  // ---------- загрузка данных ----------
  useEffect(() => {
    (async () => {
      const safeGet = async (key, shared = false) => {
        try {
          if (window.storage?.get) {
            const r = await window.storage.get(key, shared);
            return r ? JSON.parse(r.value) : null;
          }
          const raw = localStorage.getItem(`wallet:${shared ? "shared:" : ""}${key}`);
          return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
      };
      const [tx, rec, bud, mm, fam, dev] = await Promise.all([
        safeGet("transactions"), safeGet("recurring"), safeGet("budgets"),
        safeGet("merchant-map"), safeGet("family-settings"), safeGet("device-id"),
      ]);
      let did = dev;
      if (!did) {
        did = uid();
        try { await window.storage.set("device-id", JSON.stringify(did), false); } catch (e) {}
      }
      setTransactions(tx || []);
      setRecurring(rec || []);
      setBudgets(bud || {});
      setMerchantMap(mm || {});
      setFamily(fam || { code: null, nickname: "" });
      setDeviceId(did);
      setLoaded(true);
    })();
  }, []);

  // ---------- генерация регулярных платежей ----------
  useEffect(() => {
    if (!loaded || recurring.length === 0) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let newTx = [];
    const updated = recurring.map((t) => {
      let last = new Date(t.lastGeneratedDate); last.setHours(0, 0, 0, 0);
      let count = 0;
      while (count < 24) {
        const next = new Date(last);
        if (t.freq === "monthly") next.setMonth(next.getMonth() + 1);
        else next.setDate(next.getDate() + 7);
        if (next > today) break;
        newTx.push({
          id: uid(), type: t.type, amount: t.amount, category: t.category, description: t.description,
          date: next.toISOString(), generatedFrom: t.id, recurring: true, recurringFreq: t.freq, includeInFamily: false,
        });
        last = next; count++;
      }
      return { ...t, lastGeneratedDate: last.toISOString() };
    });
    if (newTx.length) {
      const nextTx = [...newTx, ...transactions];
      setTransactions(nextTx);
      setRecurring(updated);
      persistKey("transactions", nextTx);
      persistKey("recurring", updated);
      showToast(`Добавлено регулярных платежей: ${newTx.length}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  async function persistKey(key, value, shared = false) {
    try {
      if (window.storage?.set) {
        await window.storage.set(key, JSON.stringify(value), shared);
      } else {
        localStorage.setItem(`wallet:${shared ? "shared:" : ""}${key}`, JSON.stringify(value));
      }
    } catch (e) { showToast("Не удалось сохранить данные"); }
  }

  function showToast(message, actionLabel, onAction) {
    setToast({ message, actionLabel, onAction });
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => setToast(null), 4500);
  }

  // ---------- CRUD операций ----------
  function addTransactions(list) {
    const records = list.map((txn) => ({
      id: uid(), type: txn.type, amount: Number(txn.amount),
      category: (txn.category || "Без категории").trim(),
      description: (txn.description || "").trim(),
      date: txn.date || new Date().toISOString(),
      includeInFamily: !!txn.includeInFamily,
    }));
    const next = [...records, ...transactions];
    setTransactions(next);
    persistKey("transactions", next);
    records.forEach((r) => { if (r.includeInFamily) syncFamilyEntry(r); });
    return records;
  }

  function updateTransaction(updatedTx) {
    const clean = { ...updatedTx };
    const wanted = !!clean.recurringWanted;
    const freq = clean.recurringFreq || "monthly";
    delete clean.recurringWanted;
    clean.recurring = wanted;
    clean.recurringFreq = wanted ? freq : undefined;
    const next = transactions.map((t) => (t.id === clean.id ? clean : t));
    setTransactions(next);
    persistKey("transactions", next);
    if (clean.includeInFamily) syncFamilyEntry(clean);
    else removeFamilyEntry(clean);
    const existing = recurring.find((r) => r.sourceTransactionId === clean.id);
    if (wanted) {
      const template = { id: existing?.id || uid(), sourceTransactionId: clean.id, type: clean.type, amount: Number(clean.amount), category: clean.category, description: clean.description, freq, startDate: clean.date, lastGeneratedDate: clean.date };
      const nextRecurring = existing ? recurring.map((r) => r.id === existing.id ? template : r) : [...recurring, template];
      setRecurring(nextRecurring);
      persistKey("recurring", nextRecurring);
    } else if (existing) {
      const nextRecurring = recurring.filter((r) => r.id !== existing.id);
      setRecurring(nextRecurring);
      persistKey("recurring", nextRecurring);
    }
    setEditingTx(null);
    showToast("Изменения сохранены");
  }

  function deleteTransaction(tx) {
    const next = transactions.filter((t) => t.id !== tx.id);
    setTransactions(next);
    persistKey("transactions", next);
    if (tx.includeInFamily) removeFamilyEntry(tx);
    setEditingTx(null);
    clearTimeout(undoRef.current);
    showToast("Операция удалена", "Отменить", () => {
      const restored = [tx, ...next];
      setTransactions(restored);
      persistKey("transactions", restored);
      if (tx.includeInFamily) syncFamilyEntry(tx);
      setToast(null);
    });
  }

  function learnMerchant(merchant, category) {
    if (!merchant || !category) return;
    const key = merchant.trim().toLowerCase();
    if (!key) return;
    const next = { ...merchantMap, [key]: category };
    setMerchantMap(next);
    persistKey("merchant-map", next);
  }

  // ---------- бюджеты ----------
  function setBudget(category, limit) {
    const next = { ...budgets };
    if (!limit || Number(limit) <= 0) delete next[category];
    else next[category] = Number(limit);
    setBudgets(next);
    persistKey("budgets", next);
  }

  // ---------- регулярные платежи ----------
  function addRecurring(t) {
    const template = {
      id: uid(), type: t.type, amount: Number(t.amount), category: t.category, description: t.description,
      freq: t.freq, startDate: new Date().toISOString(), lastGeneratedDate: new Date().toISOString(),
    };
    const next = [...recurring, template];
    setRecurring(next);
    persistKey("recurring", next);
  }
  function removeRecurring(id) {
    const next = recurring.filter((r) => r.id !== id);
    setRecurring(next);
    persistKey("recurring", next);
    showToast("Регулярный платёж остановлен");
  }

  // ---------- семейный бюджет ----------
  async function loadFamilyTx(code) {
    if (!code || !deviceId) return;
    setFamilyLoading(true);
    try {
      let data;
      try {
        data = await callApi(`/family/${encodeURIComponent(code)}?deviceId=${encodeURIComponent(deviceId)}`, null, { method: "GET" });
      } catch (e) {
        // Старые семейные коды были только локальными. Для владельца приложения
        // автоматически переносим такой код в настоящее Cloudflare-хранилище.
        if (e.status === 404 && family.nickname) {
          data = await callApi("/family/ensure", { code, nickname: family.nickname, deviceId });
          const next = { ...family, memberId: data.memberId };
          setFamily(next); persistKey("family-settings", next);
        } else throw e;
      }
      setFamilyTx(data.transactions || []); setFamilyMembers(data.members || []);
    } catch (e) { setFamilyTx([]); setFamilyMembers([]); showToast(e.message || "Не удалось загрузить семейный бюджет"); }
    finally { setFamilyLoading(false); }
  }
  useEffect(() => { if (family.code && deviceId) loadFamilyTx(family.code); }, [family.code, deviceId]);

  async function syncFamilyEntry(tx) {
    if (!family.code || !deviceId) return;
    try {
      const data = await callApi("/family/tx", { code: family.code, deviceId, action: "upsert", transaction: {
        localId: tx.id, owner: deviceId, authorId: family.memberId || deviceId, nickname: family.nickname || "Без имени",
        type: tx.type, amount: Number(tx.amount), category: tx.category, description: tx.description, date: tx.date
      }});
      setFamilyTx(data.transactions || []); setFamilyMembers(data.members || familyMembers);
    } catch (e) { showToast(e.message || "Не удалось синхронизировать семейную операцию"); }
  }

  async function removeFamilyEntry(tx) {
    if (!family.code || !deviceId) return;
    try {
      const data = await callApi("/family/tx", { code: family.code, deviceId, action: "delete", localId: tx.id, owner: deviceId });
      setFamilyTx(data.transactions || []);
    } catch (e) { showToast(e.message || "Не удалось удалить семейную операцию"); }
  }

  async function changeFamilyAuthor(txId, authorId) {
    if (!family.code || !deviceId || !authorId) return;
    try { const data = await callApi("/family/tx", { code: family.code, deviceId, action: "author", txId, authorId }); setFamilyTx(data.transactions || []); }
    catch (e) { showToast(e.message || "Не удалось изменить автора"); }
  }

  async function createFamily(nickname) {
    try {
      const data = await callApi("/family/create", { nickname, deviceId });
      const next = { code: data.code, nickname, memberId: data.memberId };
      setFamily(next); setFamilyMembers(data.members || []); setFamilyTx([]); persistKey("family-settings", next); showToast("Семейный бюджет создан");
    } catch (e) { showToast(e.message || "Не удалось создать семейный бюджет"); }
  }

  async function joinFamily(code, nickname) {
    try {
      const normalized = code.trim().toUpperCase();
      const data = await callApi("/family/join", { code: normalized, nickname, deviceId });
      const next = { code: normalized, nickname, memberId: data.memberId };
      setFamily(next); setFamilyMembers(data.members || []); setFamilyTx(data.transactions || []); persistKey("family-settings", next); showToast("Вы присоединились к семейному бюджету");
    } catch (e) { showToast(e.message || "Код семейного бюджета не найден"); }
  }

  function leaveFamily() {
    const next = { code: null, nickname: family.nickname }; setFamily(next); setFamilyMembers([]); setFamilyTx([]); persistKey("family-settings", next); showToast("Вы вышли из семейного бюджета");
  }

  // ---------- производные данные ----------
  const now = new Date();
  const monthTx = useMemo(() => transactions.filter((t) => sameMonth(new Date(t.date), now)), [transactions]);
  const totalIncome = useMemo(() => transactions.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0), [transactions]);
  const totalExpense = useMemo(() => transactions.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0), [transactions]);
  const balance = totalIncome - totalExpense;
  const monthIncome = monthTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const monthExpense = monthTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const topCategories = catBreakdown(monthTx.filter((t) => t.type === "expense")).slice(0, 3);
  const recent = useMemo(() => [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8), [transactions]);
  function categoriesFor(t) { return Array.from(new Set(transactions.filter((x) => x.type === t).map((x) => x.category))).filter(Boolean); }

  const wrap = { minHeight: "100vh", background: "linear-gradient(180deg, #000000 0%, #08080A 42%, #000000 100%)", color: C.text, fontFamily: FONT_BODY, maxWidth: 460, margin: "0 auto", position: "relative", paddingBottom: 118, overflowX: "hidden" };

  if (!loaded) {
    return (
      <div style={{ ...wrap, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 size={26} color={C.textDim} className="spin" />
        <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <style>{`
        * { box-sizing: border-box; }
        html { background: #000; color-scheme: dark; }
        body { margin: 0; background: #000; color: ${C.text}; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; font-variant-numeric: proportional-nums; }
        button, input, select, textarea { font-family: ${FONT_BODY}; -webkit-tap-highlight-color: transparent; }
        button { transition: transform .18s cubic-bezier(.2,.8,.2,1), opacity .18s ease, background-color .18s ease, box-shadow .18s ease; }
        button:active { transform: scale(.985); }
        button:disabled { cursor: default; opacity: .55; }
        input::placeholder, textarea::placeholder { color: ${C.textFaint}; }
        input, select, textarea { outline: none; }
        input:focus, select:focus, textarea:focus { border-color: rgba(10,132,255,.78) !important; box-shadow: 0 0 0 3px rgba(10,132,255,.16); }
        select { color-scheme: dark; }
        ::selection { background: rgba(10,132,255,.35); color: ${C.text}; }
        ::-webkit-scrollbar { display: none; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .fade-up { animation: fadeUp .22s ease; }
        .ios-material { backdrop-filter: saturate(180%) blur(24px); -webkit-backdrop-filter: saturate(180%) blur(24px); }
        .glass-card { background: linear-gradient(180deg, rgba(44,44,46,.72), rgba(28,28,30,.62)); border: 1px solid rgba(255,255,255,.09); box-shadow: 0 18px 40px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.05); backdrop-filter: saturate(180%) blur(28px); -webkit-backdrop-filter: saturate(180%) blur(28px); }
        .wallet-field { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }
        .wallet-field input, .wallet-field textarea, .wallet-field select { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }
        .nav-glass { position: relative; }
        .nav-notch { position: absolute; left: 50%; top: -18px; width: 84px; height: 34px; transform: translateX(-50%); border-radius: 0 0 42px 42px; background: rgba(0,0,0,.92); box-shadow: 0 -1px 0 rgba(255,255,255,.04); }
        @media (max-width: 380px) {
          .wallet-title { font-size: 27px !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
        }
      `}</style>

      {tab === "home" && (
        <HomeTab balance={balance} monthIncome={monthIncome} monthExpense={monthExpense}
          topCategories={topCategories} recent={recent} onDelete={deleteTransaction} onEdit={setEditingTx}
          goStats={() => setTab("stats")} goHistory={() => setTab("history")} />
      )}

      {tab === "history" && (
        <HistoryTab transactions={transactions} onDelete={deleteTransaction} onEdit={setEditingTx} />
      )}

      {tab === "add" && (
        <AddTab
          transactions={transactions} categoriesFor={categoriesFor} merchantMap={merchantMap}
          familyJoined={!!family.code}
          onAddBatch={(list, learnFrom) => {
            addTransactions(list);
            if (learnFrom) learnMerchant(learnFrom.merchant, learnFrom.category);
            setTab("home"); showToast("Операции добавлены");
          }}
          onAddManual={(txn, recurringInfo) => {
            addTransactions([txn]);
            if (recurringInfo) addRecurring({ ...txn, freq: recurringInfo });
            setTab("home"); showToast("Добавлено");
          }}
          recurring={recurring} onRemoveRecurring={removeRecurring}
        />
      )}

      {tab === "stats" && (
        <StatsTab transactions={transactions} monthTx={monthTx} budgets={budgets} setBudget={setBudget} />
      )}

      {tab === "family" && (
        <FamilyTab family={family} familyTx={familyTx} familyMembers={familyMembers} familyLoading={familyLoading}
          onCreate={createFamily} onJoin={joinFamily} onLeave={leaveFamily} onChangeAuthor={changeFamilyAuthor}
          onRefresh={() => family.code && loadFamilyTx(family.code)} />
      )}

      {editingTx && (
        <EditModal tx={editingTx} onClose={() => setEditingTx(null)} onSave={updateTransaction}
          onDelete={deleteTransaction} familyJoined={!!family.code} />
      )}

      {toast && (
        <div className="fade-up" style={{
          position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)", background: C.surface2,
          border: `1px solid ${C.border}`, color: C.text, padding: "10px 16px", borderRadius: 12, fontSize: 13,
          fontWeight: 600, zIndex: 200, maxWidth: 400, display: "flex", alignItems: "center", gap: 12,
        }}>
          <span>{toast.message}</span>
          {toast.actionLabel && (
            <button onClick={toast.onAction} style={{ background: "none", border: "none", color: C.gold, fontWeight: 800, cursor: "pointer", fontSize: 13 }}>
              {toast.actionLabel}
            </button>
          )}
        </div>
      )}

      <BottomNav tab={tab} setTab={setTab} />
    </div>
  );
}

// ---------- вкладка "Обзор" ----------
function HomeTab({ balance, monthIncome, monthExpense, topCategories, recent, onDelete, onEdit, goStats, goHistory }) {
  return (
    <div>
      <div style={{ padding: "28px 20px 8px" }}>
        <div style={{ fontSize: 11, letterSpacing: 1.5, color: C.textFaint, fontWeight: 700, textTransform: "uppercase" }}>Личные финансы</div>
        <div style={{ fontSize: 13, color: C.textDim, marginTop: 6 }}>Баланс</div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 40, fontWeight: 700, letterSpacing: -1, marginTop: 2 }}>
          {balance < 0 ? "−" : ""}{fmt(Math.abs(balance))} ₽
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, padding: "10px 20px" }}>
        <StatCard icon={<TrendingUp size={16} color={C.income} />} label="Доход за месяц" value={monthIncome} color={C.income} />
        <StatCard icon={<TrendingDown size={16} color={C.expense} />} label="Расход за месяц" value={monthExpense} color={C.expense} />
      </div>

      {topCategories.length > 0 && (
        <div onClick={goStats} style={{ margin: "14px 20px 0", padding: 16, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, cursor: "pointer" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textDim }}>Топ категорий</div>
            <ChevronRight size={16} color={C.textFaint} />
          </div>
          {topCategories.map(([cat, val]) => (
            <div key={cat} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 99, background: catColor(cat), flexShrink: 0 }} />
              <div style={{ flex: 1, fontSize: 13 }}>{cat}</div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 13, color: C.textDim }}>{fmt(val)} ₽</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ margin: "20px 20px 0" }}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 16px 16px", padding: "4px 4px 8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px 4px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textDim }}>Последние операции</div>
            <button onClick={goHistory} style={{ background: "none", border: "none", color: C.textFaint, fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
              Все <ChevronRight size={13} />
            </button>
          </div>
          {recent.length === 0 && (
            <EmptyState icon={<WalletIcon size={22} color={C.textFaint} />} title="Здесь пока пусто"
              hint="Добавьте первую операцию через камеру или вручную — нажмите на золотую кнопку внизу." />
          )}
          {recent.map((t, i) => <TxRow key={t.id} t={t} last={i === recent.length - 1} onDelete={onDelete} onEdit={onEdit} />)}
        </div>
      </div>
    </div>
  );
}

// ---------- вкладка "История" с поиском и фильтрами ----------
function HistoryTab({ transactions, onDelete, onEdit }) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);

  const allCats = Array.from(new Set(transactions.map((t) => t.category))).filter(Boolean).sort();

  const filtered = useMemo(() => {
    const now = new Date();
    return transactions
      .filter((t) => (typeFilter === "all" ? true : t.type === typeFilter))
      .filter((t) => (catFilter === "all" ? true : t.category === catFilter))
      .filter((t) => {
        if (periodFilter === "all") return true;
        const d = new Date(t.date);
        if (periodFilter === "month") return sameMonth(d, now);
        if (periodFilter === "week") { const diff = (now - d) / 86400000; return diff <= 7 && diff >= 0; }
        return true;
      })
      .filter((t) => {
        if (!query.trim()) return true;
        const q = query.trim().toLowerCase();
        return t.category.toLowerCase().includes(q) || (t.description || "").toLowerCase().includes(q);
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [transactions, query, typeFilter, periodFilter, catFilter]);

  return (
    <div style={{ padding: "24px 20px" }}>
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 16 }}>История операций</div>

      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12, padding: "0 12px" }}>
          <Search size={15} color={C.textFaint} />
          <input placeholder="Поиск по категории или описанию" value={query} onChange={(e) => setQuery(e.target.value)}
            style={{ background: "none", border: "none", color: C.text, fontSize: 13, padding: "11px 0", width: "100%", fontFamily: FONT_BODY }} />
        </div>
        <button onClick={() => setShowFilters(!showFilters)} style={{
          width: 42, borderRadius: 12, border: `1px solid ${showFilters ? C.gold : C.border}`,
          background: showFilters ? C.goldDim : C.surface2, color: showFilters ? C.gold : C.textDim, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <SlidersHorizontal size={16} />
        </button>
      </div>

      {showFilters && (
        <div className="fade-up" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {[{ k: "all", l: "Все" }, { k: "expense", l: "Расход" }, { k: "income", l: "Доход" }].map((o) => (
              <Chip key={o.k} small label={o.l} active={typeFilter === o.k} color={C.gold} onClick={() => setTypeFilter(o.k)} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {[{ k: "all", l: "Всё время" }, { k: "week", l: "7 дней" }, { k: "month", l: "Этот месяц" }].map((o) => (
              <Chip key={o.k} small label={o.l} active={periodFilter === o.k} color={C.gold} onClick={() => setPeriodFilter(o.k)} />
            ))}
          </div>
          {allCats.length > 0 && (
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
              <Chip small label="Все категории" active={catFilter === "all"} color={C.gold} onClick={() => setCatFilter("all")} />
              {allCats.map((c) => <Chip key={c} small label={c} active={catFilter === c} color={catColor(c)} onClick={() => setCatFilter(c)} />)}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 18, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
        {filtered.length === 0 && (
          <EmptyState icon={<Search size={20} color={C.textFaint} />} title="Ничего не найдено" hint="Попробуйте изменить поиск или фильтры" />
        )}
        {filtered.map((t, i) => <TxRow key={t.id} t={t} last={i === filtered.length - 1} onDelete={onDelete} onEdit={onEdit} />)}
      </div>
    </div>
  );
}

// ---------- вкладка "Добавить" ----------
function AddTab({ transactions, categoriesFor, merchantMap, familyJoined, onAddBatch, onAddManual, recurring, onRemoveRecurring }) {
  const [type, setType] = useState("expense");
  const [form, setForm] = useState({ amount: "", category: "", description: "" });
  const [customMode, setCustomMode] = useState(false);
  const [wantRecurring, setWantRecurring] = useState(false);
  const [freq, setFreq] = useState("monthly");
  const [includeFamily, setIncludeFamily] = useState(false);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [batch, setBatch] = useState(null); // {date, merchant, items:[{amount,category,description,include}]}
  const fileInputRef = useRef(null);
  const screenshotInputRef = useRef(null);

  const color = type === "expense" ? C.expense : C.income;
  const categories = categoriesFor(type);

  function resetAll() {
    setForm({ amount: "", category: "", description: "" });
    setCustomMode(false); setBatch(null); setAiError(""); setWantRecurring(false); setIncludeFamily(false);
  }

  function onPickPhoto() { fileInputRef.current?.click(); }
  function onPickScreenshot() { screenshotInputRef.current?.click(); }

  async function onFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAiLoading(true); setAiError(""); setBatch(null);
    try {
      const prepared = await prepareImage(file);
      const result = await analyzeReceipt(prepared.base64, prepared.mediaType, categories, type, merchantMap);
      setBatch({
        date: result.date ? fromDateInput(result.date) : new Date().toISOString(),
        merchant: result.merchant || "",
        includeFamily: false,
        items: result.items.map((it) => ({
          id: uid(), amount: it.amount != null ? String(it.amount) : "", category: it.category || "",
          description: it.description || "", include: true,
        })),
      });
    } catch (err) {
      const msg = err?.message || "Не удалось распознать изображение";
      setAiError(msg.includes("VITE_API_URL") ? "Не настроен адрес AI Worker." : msg);
    } finally { setAiLoading(false); }
  }

  function updateBatchItem(id, patch) {
    setBatch({ ...batch, items: batch.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  }
  function removeBatchItem(id) { setBatch({ ...batch, items: batch.items.filter((it) => it.id !== id) }); }
  function addBatchItem() { setBatch({ ...batch, items: [...batch.items, { id: uid(), amount: "", category: "", description: "", include: true }] }); }

  function confirmBatch() {
    haptic();
    const included = batch.items.filter((it) => it.include && it.amount && Number(it.amount) > 0 && it.category.trim());
    if (included.length === 0) { return; }
    const list = included.map((it) => ({
      type, amount: it.amount, category: it.category, description: it.description || batch.merchant,
      date: batch.date, includeInFamily: batch.includeFamily,
    }));
    const learnFrom = included.length === 1 && batch.merchant ? { merchant: batch.merchant, category: included[0].category } : null;
    onAddBatch(list, learnFrom);
    resetAll();
  }

  function submitManual() {
    haptic();
    if (!form.amount || Number(form.amount) <= 0) return;
    if (!form.category.trim()) return;
    onAddManual({ type, amount: form.amount, category: form.category, description: form.description, includeInFamily: includeFamily }, wantRecurring ? freq : null);
    resetAll();
  }

  const batchTotal = batch ? batch.items.filter((it) => it.include).reduce((s, it) => s + (Number(it.amount) || 0), 0) : 0;

  return (
    <div style={{ padding: "24px 20px" }}>
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 16 }}>Новая операция</div>
      <Segmented value={type} onChange={(v) => { setType(v); resetAll(); }}
        options={[{ key: "expense", label: "Расход", color: C.expense, dim: C.expenseDim }, { key: "income", label: "Доход", color: C.income, dim: C.incomeDim }]} />

      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onFileChange} />
      <input ref={screenshotInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFileChange} />

      {!batch && (
        <div className="fade-up" style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button onClick={onPickPhoto} disabled={aiLoading} className="glass-card" style={{
            minHeight: 150, padding: "18px 12px", borderRadius: 20,
            border: `1.5px dashed ${aiLoading ? C.gold : C.border}`, background: C.surface,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, cursor: aiLoading ? "default" : "pointer",
          }}>
            {aiLoading ? <Loader2 size={24} color={C.gold} className="spin" /> : (
              <div style={{ width: 42, height: 42, borderRadius: 99, background: C.goldDim, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Camera size={19} color={C.gold} />
              </div>
            )}
            <div style={{ fontSize: 13, fontWeight: 700 }}>Сфотографировать</div>
            <div style={{ fontSize: 11, color: C.textFaint, textAlign: "center" }}>Чек или экран оплаты</div>
          </button>

          <button onClick={onPickScreenshot} disabled={aiLoading} className="glass-card" style={{
            minHeight: 150, padding: "18px 12px", borderRadius: 20,
            border: `1.5px dashed ${aiLoading ? C.gold : C.border}`, background: C.surface,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, cursor: aiLoading ? "default" : "pointer",
          }}>
            <div style={{ width: 42, height: 42, borderRadius: 99, background: C.goldDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>📱</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Из скриншота</div>
            <div style={{ fontSize: 11, color: C.textFaint, textAlign: "center" }}>Банк, маркетплейс или перевод</div>
          </button>
        </div>
      )}

      {!batch && !aiLoading && (
        <div style={{ marginTop: 9, fontSize: 11.5, color: C.textFaint, textAlign: "center", display: "flex", justifyContent: "center", alignItems: "center", gap: 5 }}>
          <Sparkles size={12} /> ИИ распознает сумму, магазин, дату и категории
        </div>
      )}
      {aiLoading && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: C.textDim, textAlign: "center", fontWeight: 600 }}>Распознаём изображение…</div>
      )}

      {aiError && (
        <div className="fade-up" style={{ marginTop: 12, fontSize: 12.5, color: C.expense, background: C.expenseDim, padding: "10px 12px", borderRadius: 10 }}>{aiError}</div>
      )}

      {batch && (
        <div className="fade-up glass-card" style={{ marginTop: 18, borderRadius: 22, padding: 16, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, color: C.gold, fontSize: 12, fontWeight: 700 }}>
              <Sparkles size={13} /> {batch.merchant ? `Чек: ${batch.merchant}` : "Данные распознаны"}
            </div>
            <div style={{ fontSize: 11.5, color: C.textFaint, marginBottom: 6 }}>Проверьте распознанную сумму — её можно изменить вручную.</div>
            <FieldLabel>Дата</FieldLabel>
            <div className="wallet-field"><input type="date" value={toDateInput(batch.date)} onChange={(e) => setBatch({ ...batch, date: fromDateInput(e.target.value) })} style={inputStyle(false)} /></div>

            {batch.items.map((it, idx) => (
              <div key={it.id} style={{ marginTop: 14, padding: 12, background: "rgba(44,44,46,.58)", borderRadius: 14, border: `1px solid ${C.border}`, opacity: it.include ? 1 : 0.45 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 11.5, color: C.textFaint, fontWeight: 700 }}>Позиция {idx + 1}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => updateBatchItem(it.id, { include: !it.include })} style={{ background: "none", border: "none", color: it.include ? C.gold : C.textFaint, cursor: "pointer" }}>
                      <Check size={15} />
                    </button>
                    <button onClick={() => removeBatchItem(it.id)} style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer" }}>
                      <X size={15} />
                    </button>
                  </div>
                </div>
                <input type="number" placeholder="Сумма · можно исправить" value={it.amount} onChange={(e) => updateBatchItem(it.id, { amount: e.target.value })} style={{ ...inputStyle(true), fontSize: 16, marginBottom: 8 }} className="wallet-field" />
                {categories.length > 0 && (
                  <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 8, paddingBottom: 2 }}>
                    {categories.map((c) => <Chip key={c} small label={c} active={it.category === c} color={color} onClick={() => updateBatchItem(it.id, { category: c })} />)}
                  </div>
                )}
                <input type="text" placeholder="Категория" value={it.category} onChange={(e) => updateBatchItem(it.id, { category: e.target.value })} style={{ ...inputStyle(false), marginBottom: 8 }} className="wallet-field" />
                <input type="text" placeholder="Описание" value={it.description} onChange={(e) => updateBatchItem(it.id, { description: e.target.value })} style={inputStyle(false)} className="wallet-field" />
              </div>
            ))}

            <button onClick={addBatchItem} style={{ ...btnStyle, marginTop: 10, background: C.surface2, color: C.textDim, border: `1px dashed ${C.border}`, width: "100%" }}>
              <ListPlus size={15} /> Добавить позицию
            </button>

            {familyJoined && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13, color: C.textDim, cursor: "pointer" }}>
                <input type="checkbox" checked={batch.includeFamily} onChange={(e) => setBatch({ ...batch, includeFamily: e.target.checked })} />
                Включить все позиции в семейный бюджет
              </label>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, fontSize: 13, color: C.textDim }}>
              <span>Итого</span>
              <span style={{ fontFamily: FONT_MONO, fontWeight: 700, color }}>{fmt(batchTotal)} ₽</span>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button onClick={() => setBatch(null)} style={{ ...btnStyle, flex: 1, background: C.surface2, color: C.textDim, border: `1px solid ${C.border}` }}><X size={15} /> Отмена</button>
              <button onClick={confirmBatch} style={{ ...btnStyle, flex: 2, background: color, color: "#0B0C10" }}><Check size={15} /> Добавить</button>
            </div>
          </div>
        </div>
      )}

      {!batch && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "22px 0 14px" }}>
            <div style={{ flex: 1, height: 1, background: C.border }} />
            <div style={{ fontSize: 11, color: C.textFaint, fontWeight: 700, letterSpacing: 0.5 }}>ИЛИ ВРУЧНУЮ</div>
            <div style={{ flex: 1, height: 1, background: C.border }} />
          </div>

          <FieldLabel>Сумма, ₽</FieldLabel>
          <input type="number" placeholder="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={inputStyle(true)} className="wallet-field" />

          <FieldLabel>Категория</FieldLabel>
          {!customMode && (
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 4 }}>
              {categories.map((c) => <Chip key={c} label={c} active={form.category === c} color={color} onClick={() => setForm({ ...form, category: c })} />)}
              <Chip label="+ своя" active={false} color={C.gold} onClick={() => setCustomMode(true)} />
            </div>
          )}
          {customMode && (
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" autoFocus placeholder="Например, Кафе" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={{ ...inputStyle(false), flex: 1 }} />
              <button onClick={() => setCustomMode(false)} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12, color: C.textDim, padding: "0 14px", cursor: "pointer" }}>Список</button>
            </div>
          )}

          <FieldLabel>Описание (необязательно)</FieldLabel>
          <input type="text" placeholder="Что это было?" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={inputStyle(false)} className="wallet-field" />

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 13, color: C.textDim, cursor: "pointer" }}>
            <input type="checkbox" checked={wantRecurring} onChange={(e) => setWantRecurring(e.target.checked)} />
            <Repeat size={14} /> Сделать регулярным платежом
          </label>
          {wantRecurring && (
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Chip label="Каждый месяц" active={freq === "monthly"} color={C.gold} onClick={() => setFreq("monthly")} />
              <Chip label="Каждую неделю" active={freq === "weekly"} color={C.gold} onClick={() => setFreq("weekly")} />
            </div>
          )}

          {familyJoined && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, color: C.textDim, cursor: "pointer" }}>
              <input type="checkbox" checked={includeFamily} onChange={(e) => setIncludeFamily(e.target.checked)} />
              <Users size={14} /> Включить в семейный бюджет
            </label>
          )}

          <button onClick={() => { haptic(); submitManual(); }} style={{ ...btnStyle, width: "100%", marginTop: 18, background: color, color: "#0B0C10", padding: "14px 0" }}>
            <Plus size={16} /> Добавить {type === "expense" ? "расход" : "доход"}
          </button>
        </>
      )}

      {recurring.length > 0 && !batch && (
        <div style={{ marginTop: 26 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textDim, marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
            <Repeat size={13} /> Активные регулярные платежи
          </div>
          {recurring.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 6 }}>
              <div style={{ flex: 1, fontSize: 13 }}>
                {r.category} · <span style={{ color: C.textFaint }}>{r.freq === "monthly" ? "ежемесячно" : "еженедельно"}</span>
              </div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 13, color: r.type === "expense" ? C.expense : C.income }}>{fmt(r.amount)} ₽</div>
              <button onClick={() => onRemoveRecurring(r.id)} style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer" }}><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- вкладка "Аналитика" ----------
function StatsTab({ transactions, monthTx, budgets, setBudget }) {
  function exportCSV() {
    const header = ["Дата","Тип","Сумма","Категория","Описание","В семейный бюджет"];
    const rows = transactions.map((t) => [new Date(t.date).toLocaleDateString("ru-RU"), t.type === "expense" ? "Расход" : "Доход", t.amount, t.category, t.description || "", t.includeInFamily ? "Да" : "Нет"]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replaceAll('"','""')}"`).join(";")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `wallet-${toDateInput(new Date())}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  function exportPDF() {
    const rows = [...transactions].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 100);
    const w = window.open("", "_blank"); if (!w) return;
    w.document.write(`<html><head><title>Отчёт</title><style>body{font-family:Arial;padding:24px}table{width:100%;border-collapse:collapse}th,td{padding:7px;border-bottom:1px solid #ddd;text-align:left}</style></head><body><h1>Отчёт по операциям</h1><p>${new Date().toLocaleDateString("ru-RU")}</p><table><tr><th>Дата</th><th>Тип</th><th>Сумма</th><th>Категория</th><th>Описание</th></tr>${rows.map(t=>`<tr><td>${new Date(t.date).toLocaleDateString("ru-RU")}</td><td>${t.type==="expense"?"Расход":"Доход"}</td><td>${fmt(t.amount)} ₽</td><td>${t.category}</td><td>${t.description||""}</td></tr>`).join("")}</table></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 250);
  }
  const [sub, setSub] = useState("categories");
  const [monthOffset, setMonthOffset] = useState(0);
  const now = new Date();
  const statsDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const statsTx = transactions.filter((t) => sameMonth(new Date(t.date), statsDate));
  const expenseBreakdown = catBreakdown(statsTx.filter((t) => t.type === "expense"));
  const incomeBreakdown = catBreakdown(statsTx.filter((t) => t.type === "income"));
  const statsExpenseTotal = expenseBreakdown.reduce((s, [, v]) => s + v, 0);
  const statsIncomeTotal = incomeBreakdown.reduce((s, [, v]) => s + v, 0);
  const maxCatVal = Math.max(1, ...expenseBreakdown.map(([, v]) => v), ...incomeBreakdown.map(([, v]) => v));

  const monthExpenseByCat = catBreakdown(monthTx.filter((t) => t.type === "expense"));
  const budgetCats = Array.from(new Set([...Object.keys(budgets), ...monthExpenseByCat.map(([c]) => c)]));
  const spentMap = Object.fromEntries(monthExpenseByCat);

  const trendData = useMemo(() => {
    const days = 30;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(today); start.setDate(start.getDate() - (days - 1));
    const before = transactions.filter((t) => new Date(t.date) < start);
    let running = before.reduce((s, t) => s + (t.type === "income" ? t.amount : -t.amount), 0);
    const byDay = {};
    transactions.forEach((t) => {
      const d = new Date(t.date); d.setHours(0, 0, 0, 0);
      if (d >= start && d <= today) {
        const key = d.toISOString().slice(0, 10);
        byDay[key] = (byDay[key] || 0) + (t.type === "income" ? t.amount : -t.amount);
      }
    });
    const points = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      running += byDay[key] || 0;
      points.push({ date: d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }), balance: Math.round(running) });
    }
    return points;
  }, [transactions]);

  return (
    <div style={{ padding: "24px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Аналитика</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={exportCSV} style={{ ...btnStyle, padding: "8px 10px", background: C.surface2, color: C.textDim, border: `1px solid ${C.border}` }}><Download size={14} /> CSV</button>
          <button onClick={exportPDF} style={{ ...btnStyle, padding: "8px 10px", background: C.surface2, color: C.textDim, border: `1px solid ${C.border}` }}><FileText size={14} /> PDF</button>
        </div>
      </div>
      <Segmented value={sub} onChange={setSub} options={[
        { key: "categories", label: "Категории", color: C.gold, dim: C.goldDim },
        { key: "budgets", label: "Бюджеты", color: C.gold, dim: C.goldDim },
        { key: "trend", label: "Динамика", color: C.gold, dim: C.goldDim },
      ]} />

      {sub === "categories" && (
        <div className="fade-up">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "18px 0" }}>
            <button onClick={() => setMonthOffset(monthOffset - 1)} style={navBtnStyle}><ChevronLeft size={16} color={C.textDim} /></button>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{MONTHS_RU[statsDate.getMonth()]} {statsDate.getFullYear()}</div>
            <button onClick={() => setMonthOffset(Math.min(0, monthOffset + 1))} style={navBtnStyle}><ChevronRight size={16} color={C.textDim} /></button>
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
            <StatCard icon={<TrendingDown size={16} color={C.expense} />} label="Расходы" value={statsExpenseTotal} color={C.expense} />
            <StatCard icon={<TrendingUp size={16} color={C.income} />} label="Доходы" value={statsIncomeTotal} color={C.income} />
          </div>
          <CategoryBlock title="Расходы по категориям" data={expenseBreakdown} total={statsExpenseTotal} max={maxCatVal} emptyText="Расходов за этот месяц пока нет" />
          <div style={{ height: 20 }} />
          <CategoryBlock title="Доходы по категориям" data={incomeBreakdown} total={statsIncomeTotal} max={maxCatVal} emptyText="Доходов за этот месяц пока нет" />
        </div>
      )}

      {sub === "budgets" && (
        <div className="fade-up" style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12.5, color: C.textFaint, marginBottom: 14 }}>Лимиты на текущий месяц ({MONTHS_RU[now.getMonth()]})</div>
          {budgetCats.length === 0 && <EmptyState icon={<AlertTriangle size={20} color={C.textFaint} />} title="Пока нет данных" hint="Как только появятся расходы по категориям, здесь можно будет задать лимиты" />}
          {budgetCats.map((cat) => {
            const spent = spentMap[cat] || 0;
            const limit = budgets[cat] || 0;
            const pct = limit ? Math.min(999, Math.round((spent / limit) * 100)) : 0;
            const over = limit > 0 && spent > limit;
            const barColor = !limit ? C.textFaint : pct > 100 ? C.expense : pct > 70 ? C.gold : C.income;
            return (
              <div key={cat} style={{ marginBottom: 16, padding: 14, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 99, background: catColor(cat) }} /> {cat}
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 12.5, color: C.textDim }}>
                    {fmt(spent)} ₽{limit > 0 ? ` / ${fmt(limit)} ₽` : ""}
                  </div>
                </div>
                {limit > 0 && (
                  <div style={{ height: 8, background: C.surface2, borderRadius: 99, overflow: "hidden", marginBottom: 8 }}>
                    <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: barColor, borderRadius: 99 }} />
                  </div>
                )}
                {over && (
                  <div style={{ fontSize: 12, color: C.expense, display: "flex", alignItems: "center", gap: 5, marginBottom: 8 }}>
                    <AlertTriangle size={12} /> Превышение бюджета на {fmt(spent - limit)} ₽
                  </div>
                )}
                <input type="number" placeholder="Задать лимит, ₽" defaultValue={limit || ""}
                  onBlur={(e) => setBudget(cat, e.target.value)}
                  style={{ ...inputStyle(false), fontSize: 13, padding: "8px 12px" }} />
              </div>
            );
          })}
        </div>
      )}

      {sub === "trend" && (
        <div className="fade-up" style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12.5, color: C.textFaint, marginBottom: 10 }}>Баланс за последние 30 дней</div>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: "16px 8px" }}>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={trendData} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fill: C.textFaint, fontSize: 10 }} interval={5} axisLine={{ stroke: C.border }} tickLine={false} />
                <Tooltip contentStyle={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 12 }}
                  labelStyle={{ color: C.textDim }} formatter={(v) => [`${fmt(v)} ₽`, "Баланс"]} />
                <Line type="monotone" dataKey="balance" stroke={C.gold} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

const navBtnStyle = { width: 32, height: 32, borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };

function CategoryBlock({ title, data, total, max, emptyText }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.textDim, marginBottom: 10 }}>{title}</div>
      {data.length === 0 && <div style={{ fontSize: 13, color: C.textFaint, padding: "8px 0" }}>{emptyText}</div>}
      {data.map(([cat, val]) => {
        const pct = total ? Math.round((val / total) * 100) : 0;
        const width = Math.max(4, (val / max) * 100);
        return (
          <div key={cat} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
              <span style={{ fontWeight: 600 }}>{cat}</span>
              <span style={{ fontFamily: FONT_MONO, color: C.textDim }}>{fmt(val)} ₽ · {pct}%</span>
            </div>
            <div style={{ height: 8, background: C.surface2, borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${width}%`, background: catColor(cat), borderRadius: 99 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- вкладка "Семья" ----------
function FamilyTab({ family, familyTx, familyMembers, familyLoading, onCreate, onJoin, onLeave, onChangeAuthor, onRefresh }) {
  const [nickname, setNickname] = useState(family.nickname || "");
  const [joinCode, setJoinCode] = useState("");
  const [copied, setCopied] = useState(false);

  if (!family.code) {
    return (
      <div style={{ padding: "24px 20px" }}>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Семейный бюджет</div>
        <div style={{ fontSize: 13, color: C.textDim, marginBottom: 20 }}>
          Ведите общий бюджет с близкими. Операции синхронизируются между устройствами через Cloudflare. Каждая операция остаётся личной — вы сами решаете, включать её в семейный список или нет.
        </div>

        <FieldLabel>Ваше имя (будет видно другим участникам)</FieldLabel>
        <input type="text" placeholder="Например, Аня" value={nickname} onChange={(e) => setNickname(e.target.value)} style={inputStyle(false)} />

        <div style={{ marginTop: 20, padding: 16, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Создать новый бюджет</div>
          <div style={{ fontSize: 12.5, color: C.textFaint, marginBottom: 12 }}>Сгенерируется код, которым можно поделиться с партнёром</div>
          <button onClick={() => nickname.trim() && onCreate(nickname.trim())} disabled={!nickname.trim()}
            style={{ ...btnStyle, width: "100%", background: nickname.trim() ? C.gold : C.surface2, color: nickname.trim() ? "#0B0C10" : C.textFaint }}>
            <Users size={15} /> Создать
          </button>
        </div>

        <div style={{ marginTop: 14, padding: 16, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Присоединиться по коду</div>
          <input type="text" placeholder="Например, X7K2QP" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} style={{ ...inputStyle(false), marginBottom: 10, letterSpacing: 2, fontFamily: FONT_MONO }} />
          <button onClick={() => nickname.trim() && joinCode.trim() && onJoin(joinCode, nickname.trim())} disabled={!nickname.trim() || !joinCode.trim()}
            style={{ ...btnStyle, width: "100%", background: (nickname.trim() && joinCode.trim()) ? C.gold : C.surface2, color: (nickname.trim() && joinCode.trim()) ? "#0B0C10" : C.textFaint }}>
            Присоединиться
          </button>
        </div>
      </div>
    );
  }

  const income = familyTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = familyTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const byMember = {};
  familyTx.filter((t) => t.type === "expense").forEach((t) => (byMember[t.nickname] = (byMember[t.nickname] || 0) + t.amount));
  const memberList = Object.entries(byMember).sort((a, b) => b[1] - a[1]);
  const recent = [...familyTx].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);

  return (
    <div style={{ padding: "24px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Семейный бюджет</div>
        <button onClick={onLeave} style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
          <LogOut size={13} /> Выйти
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "14px 0", padding: "10px 14px", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12 }}>
        <div style={{ fontSize: 12, color: C.textFaint }}>Код для приглашения</div>
        <div style={{ flex: 1, fontFamily: FONT_MONO, fontWeight: 700, letterSpacing: 3, fontSize: 15 }}>{family.code}</div>
        <button onClick={async () => { try { await navigator.clipboard.writeText(family.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {} }}
          style={{ background: "none", border: "none", color: copied ? C.income : C.gold, cursor: "pointer" }}>
          <Copy size={15} />
        </button>
      </div>

      {familyMembers?.length > 0 && (
        <div style={{ marginBottom: 18, padding: 14, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14 }}>
          <div style={{ fontSize: 12, color: C.textFaint, marginBottom: 8 }}>Участники</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {familyMembers.map((m) => <div key={m.id} style={{ padding: "6px 9px", borderRadius: 999, background: C.surface2, border: `1px solid ${C.border}`, fontSize: 11.5 }}>{m.nickname}</div>)}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <StatCard icon={<TrendingUp size={16} color={C.income} />} label="Доходы семьи" value={income} color={C.income} />
        <StatCard icon={<TrendingDown size={16} color={C.expense} />} label="Расходы семьи" value={expense} color={C.expense} />
      </div>

      {memberList.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.textDim, marginBottom: 10 }}>Расходы по участникам</div>
          {memberList.map(([name, val]) => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: 99, background: catColor(name) + "26", color: catColor(name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>
                {name[0]?.toUpperCase()}
              </div>
              <div style={{ flex: 1, fontSize: 13 }}>{name}</div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 13, color: C.textDim }}>{fmt(val)} ₽</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.textDim }}>Общая лента</div>
        <button onClick={onRefresh} style={{ background: "none", border: "none", color: C.gold, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          {familyLoading ? "Обновляем…" : "Обновить"}
        </button>
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
        {recent.length === 0 && <EmptyState icon={<Users size={20} color={C.textFaint} />} title="Пока нет общих операций" hint="Отметьте «Включить в семейный бюджет» при добавлении операции" />}
        {recent.map((t, i) => {
          const d = new Date(t.date);
          const isExpense = t.type === "expense";
          return (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: i === recent.length - 1 ? "none" : `1px dashed ${C.borderSoft}` }}>
              <div style={{ width: 30, height: 30, borderRadius: 10, background: catColor(t.category) + "26", color: catColor(t.category), display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
                {t.category?.[0]?.toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{t.category}</div>
                <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 2 }}>{new Date(t.date).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}</div>
                {familyMembers?.length > 0 ? (
                  <select value={t.authorId || familyMembers.find((m) => m.nickname === t.nickname)?.id || ""} onChange={(e) => onChangeAuthor(t.id, e.target.value)}
                    style={{ marginTop: 6, maxWidth: 160, background: C.surface2, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 8, padding: "5px 7px", fontSize: 11.5 }}>
                    {familyMembers.map((m) => <option key={m.id} value={m.id}>{m.nickname}</option>)}
                  </select>
                ) : <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 2 }}>{t.nickname}</div>}
              </div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 700, color: isExpense ? C.expense : C.income, flexShrink: 0 }}>
                {isExpense ? "−" : "+"}{fmt(t.amount)} ₽
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- нижняя навигация ----------
function BottomNav({ tab, setTab }) {
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none", zIndex: 150 }}>
      <div className="nav-glass" style={{
        pointerEvents: "auto", width: "100%", maxWidth: 460, background: "rgba(28,28,30,.78)", backdropFilter: "saturate(180%) blur(28px)", WebkitBackdropFilter: "saturate(180%) blur(28px)",
        borderTop: `1px solid rgba(255,255,255,.08)`, display: "flex", alignItems: "center", justifyContent: "space-around",
        padding: "9px 8px calc(env(safe-area-inset-bottom, 8px) + 8px)", boxShadow: "0 -10px 30px rgba(0,0,0,.22)"
      }}>
        <div className="nav-notch" />
        <NavItem icon={<WalletIcon size={19} />} label="Обзор" active={tab === "home"} onClick={() => setTab("home")} />
        <NavItem icon={<Search size={19} />} label="История" active={tab === "history"} onClick={() => setTab("history")} />
        <button aria-label="Добавить операцию" onClick={() => setTab("add")} style={{
          position: "relative", zIndex: 2, width: 58, height: 58, marginTop: -30, borderRadius: 99, border: `1px solid rgba(255,255,255,.16)`, background: C.blue,
          display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 10px 30px rgba(10,132,255,.38), inset 0 1px 0 rgba(255,255,255,.25)", cursor: "pointer", flexShrink: 0,
        }}>
          <Plus size={23} color="#fff" strokeWidth={2.6} />
        </button>
        <NavItem icon={<PieChart size={19} />} label="Аналитика" active={tab === "stats"} onClick={() => setTab("stats")} />
        <NavItem icon={<Users size={19} />} label="Семья" active={tab === "family"} onClick={() => setTab("family")} />
      </div>
    </div>
  );
}
function NavItem({ icon, label, active, onClick }) {
  return (
    <button onClick={onClick} style={{ background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: active ? C.gold : C.textFaint, cursor: "pointer", padding: 4 }}>
      {icon}<span style={{ fontSize: 10, fontWeight: 700 }}>{label}</span>
    </button>
  );
}
