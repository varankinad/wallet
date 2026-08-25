# Wallet — GitHub Pages + Cloudflare Workers AI

React/Vite-приложение для учёта финансов. Фронтенд публикуется через GitHub Pages, а распознавание чеков и скриншотов выполняет отдельный Cloudflare Worker с Workers AI.

## Архитектура

```text
GitHub Pages
  ↓
React/Vite Wallet
  ↓ POST image → Cloudflare Worker
  ↓
Workers AI — @cf/meta/llama-3.2-11b-vision-instruct
  ↓ structured JSON
Wallet
```

Cloudflare Workers AI имеет бесплатную дневную квоту 10 000 Neurons. Конкретная стоимость зависит от модели и объёма inference; у используемой vision-модели есть бесплатная квота в рамках Workers AI Free. Проверь актуальные лимиты в Cloudflare Dashboard перед публичным запуском.

## 1. GitHub Pages

Репозиторий рекомендуется назвать `wallet`. Тогда адрес:

`https://YOUR-LOGIN.github.io/wallet/`

Vite уже настроен с `base: /wallet/`.

После push в `main` workflow `.github/workflows/deploy.yml` соберёт и опубликует `dist`.

## 2. Cloudflare Worker

Войдите в Cloudflare и откройте Workers & Pages → Workers AI.

Первый запуск модели Llama 3.2 11B Vision требует принять лицензию Meta. Cloudflare показывает это требование при первом запросе модели.

Установите Wrangler:

```bash
cd worker
npm install
npx wrangler login
```

Деплой:

```bash
npx wrangler deploy
```

После деплоя получите URL вида:

`https://wallet-ai.YOUR-SUBDOMAIN.workers.dev`

### Ограничить CORS

После создания GitHub Pages сайта лучше заменить `ALLOWED_ORIGIN` в `worker/wrangler.jsonc`:

```json
"vars": {
  "ALLOWED_ORIGIN": "https://YOUR-LOGIN.github.io"
}
```

Для первого теста оставлен `*`.

## 3. Подключить Worker к GitHub Pages

В GitHub → Settings → Secrets and variables → Actions добавьте Repository Secret:

`VITE_API_URL`

Значение:

`https://wallet-ai.YOUR-SUBDOMAIN.workers.dev`

Workflow уже передаёт этот secret в Vite при сборке.

После следующего push приложение будет использовать Cloudflare Worker.

## 4. Локальный запуск

```bash
npm install
npm run dev
```

Для production-сборки:

```bash
npm run build
```

## 5. Проверка Worker

После деплоя можно проверить:

```bash
curl -X POST https://wallet-ai.YOUR-SUBDOMAIN.workers.dev \
  -H 'Content-Type: application/json' \
  -d '{"base64":"...","mediaType":"image/jpeg","prompt":"Верни JSON с датой, магазином и позициями покупки."}'
```

## Важно

- Платный внешний AI API не нужен для распознавания.
- Секреты Cloudflare не попадают во фронтенд.
- Изображение отправляется напрямую из браузера в твой Worker.
- Worker передаёт изображение в Workers AI и возвращает JSON.
- Для чеков и скриншотов используется одна и та же vision-модель.
