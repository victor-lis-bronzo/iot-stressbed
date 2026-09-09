# syntax=docker/dockerfile:1
# node:22-alpine: LTS atual do Node; o projeto não fixa engines.node em package.json.
FROM node:22-alpine AS deps
WORKDIR /app
COPY apps/api/package.json apps/api/package-lock.json* ./
# python3/make/g++: bcrypt precisa compilar binário nativo no musl do alpine.
RUN apk add --no-cache python3 make g++ \
    && npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/api/ ./
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV API_PORT=3000
COPY apps/api/package.json apps/api/package-lock.json* ./
RUN apk add --no-cache python3 make g++ \
    && npm ci --omit=dev \
    && apk del python3 make g++
COPY --from=build /app/dist ./dist
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=15s \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1 || exit 1
CMD ["node", "dist/main.js"]
