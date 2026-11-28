# ---------- Stage 1: build the web client (Vite) ----------
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- Stage 2: runtime (production dependencies only) ----------
FROM node:22-slim
ENV NODE_ENV=production PORT=2567
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY tsconfig.json ./
COPY shared ./shared
COPY server ./server
COPY --from=build /app/dist ./dist
USER node
EXPOSE 2567
CMD ["node", "--import", "tsx", "server/index.ts"]
