FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV PORT=8000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update && apt-get install -y \
    curl ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./

# Install ALL deps (including dev) — needed for TypeScript build
RUN npm ci

COPY . .

RUN npm run build

# Remove dev deps after build to slim the image
RUN npm prune --omit=dev

EXPOSE 8000

CMD ["npm", "start"]
