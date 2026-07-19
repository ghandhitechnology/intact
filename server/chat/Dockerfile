FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY *.ts tsconfig.json ./
RUN yarn build

FROM node:22-alpine AS production-dependencies
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=true

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 realtime
COPY --from=builder --chown=realtime:nodejs /app/package.json /app/yarn.lock ./
COPY --from=production-dependencies --chown=realtime:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=realtime:nodejs /app/dist ./dist
USER realtime
EXPOSE 3001
CMD ["node", "dist/index.js"]
