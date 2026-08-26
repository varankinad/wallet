# Wallet — GitHub Pages + Cloudflare Workers AI

Готовый React/Vite-проект личных финансов.

## Что исправлено

- Распознавание чеков, банковских скриншотов и маркетплейсов через Cloudflare Workers AI.
- Используется `@cf/google/gemma-4-26b-a4b-it`: vision/OCR, в том числе многоязычный OCR и разбор экранов/документов.
- Убран Anthropic.
- Изображения перед отправкой уменьшаются до разумного размера для стабильного OCR.
- AI возвращает JSON с датой, магазином и позициями.
- Семейный бюджет теперь действительно синхронизируется между устройствами через Cloudflare KV.
- Код приглашения проверяется на сервере.
- Можно менять автора каждой операции в семейной ленте.
- Старый локальный семейный код владельца можно автоматически перенести в серверное хранилище при первом запуске новой версии.

## 1. Frontend / GitHub Pages

Репозиторий должен называться `wallet`, чтобы адрес был:

`https://ВАШ-ЛОГИН.github.io/wallet/`

В GitHub Pages выберите **GitHub Actions**.

Добавьте Secret:

`VITE_API_URL=https://wallet-ai.ВАШ-SUBDOMAIN.workers.dev`

## 2. Cloudflare Worker

```bash
cd worker
npm install
npx wrangler login
```

Создайте KV namespace:

```bash
npx wrangler kv namespace create FAMILY_KV
```

Cloudflare вернёт ID вида:

```text
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Откройте `worker/wrangler.jsonc` и замените:

```json
"REPLACE_WITH_KV_NAMESPACE_ID"
```

на полученный ID.

После этого:

```bash
npx wrangler deploy
```

Worker должен получить URL вида:

`https://wallet-ai.ВАШ-SUBDOMAIN.workers.dev`

Именно этот URL укажите в GitHub Secret `VITE_API_URL`.

## 3. Workers AI

Worker использует binding `AI`:

```json
"ai": { "binding": "AI" }
```

и модель:

`@cf/google/gemma-4-26b-a4b-it`

Эта модель поддерживает vision и OCR. Для неё не нужен отдельный шаг принятия Meta License, который требовался для старой Llama 3.2 Vision.

## 4. Семейный бюджет

API:

- `POST /family/create`
- `POST /family/join`
- `GET /family/:code?deviceId=...`
- `POST /family/tx`

KV хранит участников и общие операции. Личные операции остаются в браузерном хранилище; в семейный список попадают только операции с флагом «Включить в семейный бюджет».

В семейной ленте у каждой операции есть выбор автора. Изменение автора не меняет владельца личной операции — оно меняет только автора в семейном бюджете.

## 5. Локальная проверка

```bash
npm install
npm run build
```

Для Worker:

```bash
cd worker
npm install
npx wrangler deploy
```

## Важно про бесплатный тариф

Workers AI имеет бесплатную дневную квоту, но это не безлимитный AI. Если квота закончится, новые AI-запросы будут отклоняться до сброса лимита или перехода на Paid.


## UI refresh

Inter-first typography with SF Pro/system fallbacks, stronger hierarchy, saturated lime/blue/coral accents, deep graphite surfaces, subtle gradients, and touch-friendly controls based on the supplied mobile references.
