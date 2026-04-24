# Guia de Deploy de Bot no Railway 24/7

Guia genérico para colocar qualquer bot Node.js (Discord, Telegram, etc) rodando 24/7 no Railway a partir de um repositório GitHub.

---

## 1. Arquivos criados/modificados na raiz do projeto

| Arquivo | Por quê |
|---|---|
| `Dockerfile` | Define a imagem do container com a versão exata do Node, dependências de sistema (ffmpeg, python, yt-dlp) e instalação do gerenciador de pacotes. Usar Dockerfile é mais previsível que detecção automática (Nixpacks/Buildpacks). |
| `.dockerignore` | Evita copiar `node_modules`, `dist`, `.git`, segredos e assets pesados pra dentro da imagem — build fica rápido e leve. |
| `railway.json` | Diz ao Railway qual builder usar (`DOCKERFILE`), qual comando de start, política de restart automático e o caminho do healthcheck. |
| `.gitignore` | Garante que `.env`, `node_modules`, banco SQLite local e logs **nunca** vão pro GitHub. |
| `.env.example` | Lista as variáveis de ambiente que o bot precisa (sem valores). Documentação rápida pra quem clonar o repo. |
| `package.json` (raiz) | Adicionar `engines.node` (ex: `>=24`) e `packageManager` (ex: `pnpm@10.26.1`) garante consistência entre desenvolvimento e produção. |

---

## 2. Variáveis de ambiente

Adicionar todas no painel do Railway → aba **Variables** do serviço.

**Obrigatórias** (variam por bot, exemplos comuns):

- `DISCORD_BOT_TOKEN` (ou `TELEGRAM_BOT_TOKEN`, etc) — token do bot
- `DISCORD_CLIENT_ID` — ID da aplicação (quando aplicável)
- API keys de serviços externos usados pelo bot (ex: `OPENAI_API_KEY`, `AUDD_API_KEY`)
- `NODE_ENV=production` — recomendado

**Automáticas** (Railway define sozinho, **não configurar manualmente**):

- `PORT` — porta HTTP que o Railway expõe; o app deve ler `process.env.PORT`

---

## 3. Volume para persistir dados (SQLite, uploads, cache)

Sem volume, **toda vez que o container reiniciar você perde tudo** que tiver sido salvo em disco.

**Como criar:**

1. Serviço no Railway → aba **Settings** → seção **Volumes** → **+ New Volume**
2. Preencher:
   - **Mount path:** caminho absoluto onde o app grava dados, ex: `/app/data` ou `/app/artifacts/<nome>/data`
   - **Size:** começa com 1 GB (dá pra aumentar depois)
3. Salvar
4. **Importante:** fazer um redeploy manual depois de criar o volume (Deployments → 3 pontinhos no deploy ativo → **Redeploy**) pra ele subir já com o volume montado

---

## 4. Subindo o código pro GitHub

Pré-requisitos: ter um repositório criado no GitHub (pode ser privado).

No terminal/Shell, dentro da pasta do projeto:

```bash
# Primeira vez (configura o remote)
git remote add origin https://github.com/SEU-USUARIO/NOME-DO-REPO.git
git branch -M main
git add .
git commit -m "Initial commit"
git push -u origin main
```

**Pushes seguintes** (depois que já tá conectado):

```bash
git add .
git commit -m "mensagem do commit"
git push
```

**Se o push for rejeitado** (acontece quando o repositório no GitHub foi criado com README/license e você quer manter só o código local):

```bash
git push --force-with-lease
```

---

## 5. Deploy no Railway do zero — passo a passo

### Passo 1: criar conta
- Entra em [railway.app](https://railway.app)
- Login com GitHub é o mais simples

### Passo 2: criar projeto a partir do GitHub
1. Dashboard → **+ New Project** → **Deploy from GitHub repo**
2. Autorizar o Railway a ler seus repositórios
3. Selecionar o repositório do bot

### Passo 3: cuidado com monorepo
- Se o repositório for um monorepo (vários workspaces/pacotes), o Railway pode oferecer criar **um serviço por workspace**
- **Recusar** essa sugestão (clicar em "Skip" ou "No") — você quer **1 serviço só**
- Se já tiver criado vários sem querer, apaga os errados em **Settings → Danger → Delete Service** e cria um novo

### Passo 4: configurar o serviço

Aba **Settings** do serviço:

- **Root Directory:** deixar em branco (ou `/`) — o build precisa enxergar o repositório inteiro
- **Build Command:** deixar em branco — o `railway.json` + `Dockerfile` cuidam
- **Start Command:** deixar em branco — já vem do `railway.json`
- **Watch Paths:** deixar em branco

### Passo 5: variáveis
- Aba **Variables** → adicionar todas as secrets/keys do bot (ver seção 2)

### Passo 6: volume
- Aba **Settings** → **Volumes** → criar conforme seção 3

### Passo 7: primeiro deploy
- Aba **Deployments** → o push do GitHub já dispara build automático
- Acompanhar em **View Logs**
- Estágios esperados (todos verdes):
  - Initialization
  - Build
  - Deploy
  - Network (healthcheck)
  - Post-deploy

### Passo 8: validar healthcheck
- O `railway.json` aponta um caminho HTTP que o Railway bate pra confirmar que o app subiu
- Verificar que esse caminho **existe de verdade** no código do app e responde 200
- Caminho errado = "Healthcheck failure" mesmo com app rodando
- Timeout padrão: 30s; se o app demora pra inicializar (conectar em APIs externas, etc), aumentar pra 60-120s no `railway.json`

### Passo 9: testar o bot
- Status do deploy: **Active** (verde)
- Testar um comando do bot na plataforma alvo (Discord, Telegram, etc)

---

## Boas práticas

- **Logs:** acompanhar pela aba **Deployments → View Logs** ou pelo CLI (`npm i -g @railway/cli`, depois `railway logs`)
- **Restart automático:** já configurado no `railway.json` (`ON_FAILURE`, máx 10 retries)
- **Atualizações de código:** todo `git push` na branch `main` dispara redeploy automático
- **Trocar variáveis:** após salvar uma nova variável, o Railway reinicia o serviço sozinho
- **Plano gratuito:** dá ~500h de execução/mês; pra bot ligado 24/7 é necessário plano Hobby ($5/mês com $5 de crédito de uso)
- **Backups:** baixar periodicamente o conteúdo do volume (snapshot) é uma boa prática se os dados forem críticos

---

## Erros comuns e onde olhar

| Sintoma | Onde investigar |
|---|---|
| Build falha logo no início | Versão do Node/pnpm no `Dockerfile` ou `engines` |
| Build falha em `pnpm install` | Lockfile desatualizado — regenerar localmente e fazer push |
| Deploy falha em healthcheck | Caminho HTTP no `railway.json` não bate com a rota real do app, ou app não tá ouvindo em `process.env.PORT` |
| Container crasha no start | Ver logs em **Deploy Logs** — geralmente variável de ambiente faltando |
| Dados somem após redeploy | Volume não foi criado ou está montado em caminho errado |
| Bot fica off depois de algumas horas | Plano free esgotou — precisa do Hobby |

---

Pronto. Com esses passos qualquer bot Node.js sobe no Railway e fica de pé 24/7.
