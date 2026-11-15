FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build
ENV NODE_ENV=production AUTOQA_DEPLOYMENT=hosted
EXPOSE 8080
CMD ["node", "scripts/start-hosted.mjs"]
