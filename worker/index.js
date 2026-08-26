const MODEL = "@cf/google/gemma-4-26b-a4b-it";
const FAMILY_KEY = (code) => `family:${String(code || "").toUpperCase()}`;

const JSON_SCHEMA = {
  type: "object",
  properties: {
    date: { type: ["string", "null"] },
    merchant: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          amount: { type: "number" },
          category: { type: "string" },
          description: { type: "string" }
        },
        required: ["amount", "category", "description"]
      }
    }
  },
  required: ["date", "merchant", "items"]
};

function corsHeaders(origin, allowedOrigin) {
  const allow = allowedOrigin === "*" ? "*" : (origin === allowedOrigin ? origin : allowedOrigin);
  return {
    "Access-Control-Allow-Origin": allow || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(data, status, request, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(request.headers.get("Origin"), env.ALLOWED_ORIGIN || "*") },
  });
}

function cleanCode(code) { return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}
function memberId() { return crypto.randomUUID(); }
function txId() { return crypto.randomUUID(); }

async function readFamily(env, code) {
  if (!env.FAMILY_KV) throw new Error("FAMILY_KV binding is not configured");
  const raw = await env.FAMILY_KV.get(FAMILY_KEY(code));
  return raw ? JSON.parse(raw) : null;
}
async function writeFamily(env, family) {
  await env.FAMILY_KV.put(FAMILY_KEY(family.code), JSON.stringify(family));
}
function isMember(family, deviceId) { return !!family?.members?.some((m) => m.deviceId === deviceId); }
function publicFamily(family) {
  return {
    code: family.code,
    members: (family.members || []).map(({ id, nickname, joinedAt }) => ({ id, nickname, joinedAt })),
    transactions: (family.transactions || []).map(({ owner, ...t }) => t)
  };
}

async function handleAI(request, env) {
  const body = await request.json().catch(() => ({}));
  const { base64, mediaType, prompt } = body || {};
  if (!base64 || !mediaType || !prompt) return json({ error: "base64, mediaType and prompt are required" }, 400, request, env);
  if (!env.AI) return json({ error: "Workers AI binding is not configured" }, 500, request, env);

  const image = `data:${mediaType};base64,${base64}`;
  const system = `You are a meticulous financial OCR and vision assistant. Read text literally from the supplied image. Return only a JSON object. Never invent amounts. The user wants the actual transaction amount, not a balance, discount, cashback, bonus, order number, or pre-discount price. For Russian bank screenshots, identify labels such as Сумма, Списано, Оплачено, Перевод, Зачисление. For receipts identify ИТОГО / К ОПЛАТЕ. For marketplaces identify Итого / Оплачено / К оплате. If uncertain, return an empty items array.`;

  const run = async (extraPrompt = "") => {
    const result = await env.AI.run(MODEL, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: `${prompt}\n\n${extraPrompt}` },
      ],
      image,
      max_tokens: 1200,
      temperature: 0.0,
    });
    return result;
  };

  try {
    let result = await run("Read the image carefully and return the JSON. Double-check the exact visible amount and transaction date.");
    let text = typeof result?.response === "string" ? result.response : typeof result === "string" ? result : JSON.stringify(result?.response || result?.result || result);
    // One retry if the model produced no useful JSON / no text.
    if (!text || text === "{}" || text === "null") {
      result = await run("Second pass: focus only on the transaction total and merchant. Return a single JSON object with items containing the most clearly visible actual payment amount.");
      text = typeof result?.response === "string" ? result.response : typeof result === "string" ? result : JSON.stringify(result?.response || result?.result || result);
    }
    return json({ text }, 200, request, env);
  } catch (error) {
    return json({ error: error?.message || "Workers AI error", code: error?.code || null, model: MODEL }, 502, request, env);
  }
}

async function handleFamily(request, env, url) {
  const path = url.pathname;
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};

  if (path === "/family/create") {
    const nickname = String(body.nickname || "").trim().slice(0, 40);
    const deviceId = String(body.deviceId || "").trim();
    if (!nickname || !deviceId) return json({ error: "nickname and deviceId are required" }, 400, request, env);
    let code = makeCode();
    for (let i = 0; i < 5 && await readFamily(env, code); i++) code = makeCode();
    const member = { id: memberId(), deviceId, nickname, joinedAt: new Date().toISOString() };
    const family = { code, createdAt: new Date().toISOString(), members: [member], transactions: [] };
    await writeFamily(env, family);
    return json({ ...publicFamily(family), memberId: member.id }, 200, request, env);
  }

  if (path === "/family/ensure") {
    const code = cleanCode(body.code), nickname = String(body.nickname || "").trim().slice(0, 40), deviceId = String(body.deviceId || "").trim();
    if (!code || !nickname || !deviceId) return json({ error: "code, nickname and deviceId are required" }, 400, request, env);
    let family = await readFamily(env, code);
    if (!family) {
      const member = { id: memberId(), deviceId, nickname, joinedAt: new Date().toISOString() };
      family = { code, createdAt: new Date().toISOString(), members: [member], transactions: [] };
      await writeFamily(env, family);
      return json({ ...publicFamily(family), memberId: member.id, created: true }, 200, request, env);
    }
    const existing = family.members.find((m) => m.deviceId === deviceId);
    if (existing) existing.nickname = nickname;
    else family.members.push({ id: memberId(), deviceId, nickname, joinedAt: new Date().toISOString() });
    await writeFamily(env, family);
    const me = family.members.find((m) => m.deviceId === deviceId);
    return json({ ...publicFamily(family), memberId: me.id }, 200, request, env);
  }

  if (path === "/family/join") {
    const code = cleanCode(body.code), nickname = String(body.nickname || "").trim().slice(0, 40), deviceId = String(body.deviceId || "").trim();
    if (!code || !nickname || !deviceId) return json({ error: "Введите код и имя" }, 400, request, env);
    const family = await readFamily(env, code);
    if (!family) return json({ error: "Такого семейного бюджета нет. Проверьте код." }, 404, request, env);
    let member = family.members.find((m) => m.deviceId === deviceId);
    if (!member) { member = { id: memberId(), deviceId, nickname, joinedAt: new Date().toISOString() }; family.members.push(member); }
    else {
      member.nickname = nickname;
      for (const tx of family.transactions || []) if (tx.authorId === member.id) tx.nickname = nickname;
    }
    await writeFamily(env, family);
    return json({ ...publicFamily(family), memberId: member.id }, 200, request, env);
  }

  const match = path.match(/^\/family\/([^/]+)$/);
  if (match && request.method === "GET") {
    const code = cleanCode(match[1]);
    const deviceId = url.searchParams.get("deviceId") || "";
    const family = await readFamily(env, code);
    if (!family) return json({ error: "Семейный бюджет не найден" }, 404, request, env);
    if (!isMember(family, deviceId)) return json({ error: "Вы не состоите в этом семейном бюджете" }, 403, request, env);
    return json(publicFamily(family), 200, request, env);
  }

  if (path === "/family/tx") {
    const code = cleanCode(body.code), deviceId = String(body.deviceId || "").trim();
    const family = await readFamily(env, code);
    if (!family) return json({ error: "Семейный бюджет не найден" }, 404, request, env);
    if (!isMember(family, deviceId)) return json({ error: "Нет доступа к семейному бюджету" }, 403, request, env);

    if (body.action === "upsert") {
      const t = body.transaction || {};
      const id = t.id || `${t.owner || deviceId}-${t.localId || txId()}`;
      const idx = family.transactions.findIndex((x) => x.id === id || (x.localId === t.localId && x.owner === t.owner));
      const existing = idx >= 0 ? family.transactions[idx] : null;
      const entry = {
        id: existing?.id || id, localId: String(t.localId || ""), owner: String(t.owner || deviceId),
        authorId: existing?.authorId || String(t.authorId || deviceId), nickname: existing?.nickname || String(t.nickname || "Без имени"),
        type: t.type === "income" ? "income" : "expense", amount: Number(t.amount) || 0,
        category: String(t.category || "Без категории").slice(0, 80), description: String(t.description || "").slice(0, 160), date: t.date || new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      if (idx >= 0) family.transactions[idx] = entry; else family.transactions.push(entry);
      await writeFamily(env, family);
      return json(publicFamily(family), 200, request, env);
    }

    if (body.action === "delete") {
      family.transactions = family.transactions.filter((x) => !(x.localId === String(body.localId || "") && x.owner === String(body.owner || deviceId)));
      await writeFamily(env, family);
      return json(publicFamily(family), 200, request, env);
    }

    if (body.action === "author") {
      const tx = family.transactions.find((x) => x.id === body.txId);
      const member = family.members.find((m) => m.id === body.authorId);
      if (!tx || !member) return json({ error: "Операция или участник не найдены" }, 404, request, env);
      tx.authorId = member.id;
      tx.nickname = member.nickname;
      tx.updatedAt = new Date().toISOString();
      await writeFamily(env, family);
      return json(publicFamily(family), 200, request, env);
    }
  }

  return json({ error: "Not found" }, 404, request, env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin"), env.ALLOWED_ORIGIN || "*") });
    try {
      if (url.pathname === "/ai" && request.method === "POST") return await handleAI(request, env);
      if (url.pathname.startsWith("/family/")) return await handleFamily(request, env, url);
      return json({ ok: true, service: "wallet-ai", model: MODEL, endpoints: ["/ai", "/family/create", "/family/join", "/family/:code", "/family/tx"] }, 200, request, env);
    } catch (error) {
      return json({ error: error?.message || "Worker error" }, 500, request, env);
    }
  },
};
