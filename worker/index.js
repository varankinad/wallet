const MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(data, status, request, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request.headers.get("Origin"), env.ALLOWED_ORIGIN || "*"),
    },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request.headers.get("Origin"), env.ALLOWED_ORIGIN || "*"),
      });
    }

    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, request, env);

    try {
      const body = await request.json();
      const { base64, mediaType, prompt } = body || {};
      if (!base64 || !mediaType || !prompt) {
        return json({ error: "base64, mediaType and prompt are required" }, 400, request, env);
      }

      const image = `data:${mediaType};base64,${base64}`;
      const system = "Ты аккуратный финансовый OCR/vision-помощник. Извлекай только данные, которые видны на изображении. Если данных нет, используй null/пустую строку, но не выдумывай покупки.";

      const result = await env.AI.run(MODEL, {
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        image,
        max_tokens: 1500,
        temperature: 0.1,
        response_format: {
          type: "json_schema",
          json_schema: JSON_SCHEMA,
        },
      });

      const text = result?.response || result?.result || result;
      if (!text) return json({ error: "Cloudflare AI returned an empty response" }, 502, request, env);

      return json({ text: typeof text === "string" ? text : JSON.stringify(text) }, 200, request, env);
    } catch (error) {
      return json({ error: error?.message || "Cloudflare Worker error" }, 500, request, env);
    }
  },
};
