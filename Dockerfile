FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --break-system-packages yt-dlp

RUN npm install -g pnpm@10.26.1

WORKDIR /app

COPY . .

RUN pnpm install --no-frozen-lockfile

RUN pnpm --filter @workspace/api-server... run build

RUN mkdir -p /app/artifacts/api-server/data

ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@workspace/api-server", "run", "start"]
