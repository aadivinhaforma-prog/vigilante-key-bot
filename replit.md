# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server **+ Vigilante Key Discord bot** rodando juntos no mesmo processo.

**Bot Discord — Vigilante Key**

- Tag: `Vigilante Key#9288`. Owner: `1467333025430900860`. Sempre responde PT-BR informal.
- Entry: `src/index.ts` — auto-atualiza `yt-dlp`, sobe Express + bot.
- Bot: `src/bot.ts` — registra 13 comandos slash globais e roteia interações.
- Análise de vídeo: `src/videoAnalyzer.ts` (yt-dlp + AudD para música + OpenAI Whisper para transcrição + ffmpeg drawtext para watermark).
- Previsão viral: `src/viralPredictor.ts` (vídeo, canal e live).
- Trending: `src/trendingAnalyzer.ts`.

**Storage** — SQLite embutido (`node:sqlite` nativo do Node 24, sem builds nativas).
DB em `data/vigilante.db`. Schema definido em `src/lib/db.ts`.

**Módulos da lógica de negócio (src/lib/)**

- `db.ts` — schema completo, `ensureUser`, `getSistema/setSistema`, `isManutencao`.
- `permissions.ts` — `isOwner`, `isBotAdmin`, `isServerAdmin`.
- `safety.ts` — limpeza de URL, validação, anti-spam (5s + 5/min → bloqueio 10min), filtro de conteúdo proibido, classificação de erros, retry, limite diário/criador, bloqueios.
- `eventos.ts` — calendário automático (Páscoa/Carnaval calculados, Natal, Halloween, Dia da Mentira que mente, etc.) + eventos manuais.
- `fichas.ts` — sistema de tokens com VIP, fidelidade 30 dias, eventos.
- `watermark.ts` — drawtext ffmpeg com `@criador`. Falha = vídeo NÃO é enviado (regra obrigatória).
- `troll.ts` — 15 efeitos de trollagem (mudo, lento, mini, idioma, etc.).
- `historico.ts` — top virais, ranking mensal, conquistas.
- `acoes.ts` — registro/desfazer de ações de admin/owner por 24h.
- `servidor.ts` — config por guild (canal permitido, limite, destino, bloqueios).

**Comandos slash registrados**

Usuário: `/video`, `/prever`, `/trending`, `/fichas`, `/perfil`, `/historico`, `/top`, `/ranking`, `/ajuda`.

Admin de servidor: `/adm <subcommand>` (banir, desbanir, fichas, resetar, canal, log, limite, status, destino, bloquear/desbloquear-criador/video, lista-bloqueios, desfazer) + `/ajuda-adm`.

Owner do bot: `/owner <group> <subcommand>` agrupados em `admin`, `geral`, `fichas`, `vip`, `troll`, `servidor`, `bloqueio`, `evento`, `sistema` + `/ajuda-owner`.

**Secrets necessários**: `DISCORD_BOT_TOKEN`, `AUDD_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`. Opcional: `DISCORD_CLIENT_ID` (cai no client.user.id se não definido).

**Dependências do sistema**: `yt-dlp` e `ffmpeg` precisam estar disponíveis no PATH.

**Express API** — Routes em `src/routes/` usam `@workspace/api-zod` e `@workspace/db`.

- App setup: `src/app.ts` — CORS, JSON, routes em `/api`.
- Routes: `src/routes/health.ts` expõe `GET /api/health`.
- Depends on: `@workspace/db`, `@workspace/api-zod`.
- `pnpm --filter @workspace/api-server run dev` — dev server.
- `pnpm --filter @workspace/api-server run build` — esbuild bundle.

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.
