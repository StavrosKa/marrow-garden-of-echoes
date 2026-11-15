# Marrow: Garden of Echoes

A haunted garden you wake with your body. Garden of Echoes is a web game played in front of a webcam, seated and with one hand: reach for lanterns, watch the spirits, remember the echoes of an old hall, and draw plants in the air. It first learns how far you can comfortably reach and only places things inside that range. It also plays without a camera, using a mouse.

Two levels, one continuous journey: **Lantern Garden** (the night forest) and **Whisper Hall** (the candle-lit hall inside it), ending in a garden you grow and keep.

Marrow is the input engine underneath: pose tracking, comfort map, dwell selection and a headless simulator.

Work in progress for Kiroween 2026.

## Install

Requires Node 22.13 or newer (`^22.13 || >=24`). `.nvmrc` pins Node 24 (`nvm use`).

```sh
npm install
npx playwright install chromium   # only needed for npm run test:e2e
```

## Run

```sh
npm run dev
```

Opens the Garden of Echoes app (`apps/garden-of-echoes`) at http://localhost:5173. For now it shows only a page with the app name.

`npm run build` builds the app into `apps/garden-of-echoes/dist`. To host it under a sub-path, set `BASE_PATH` for the build, for example `BASE_PATH=/garden-of-echoes/ npm run build` (in PowerShell: `$env:BASE_PATH='/garden-of-echoes/'; npm run build`).

## Check

```sh
npm run typecheck
npm run lint
npm test
npm run test:e2e   # starts the dev server and loads the page in Chromium
```

`npm run simulate` is reserved for the headless session simulator and does nothing yet.

## License

MIT. See [LICENSE](LICENSE).
