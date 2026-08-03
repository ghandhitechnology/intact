FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts=false && npm cache clean --force
COPY src ./src
COPY verdict.schema.json ./verdict.schema.json
ENV NODE_ENV=production
ENV PORT=8787
ENV CODEX_HOME=/var/lib/intact-codex
RUN mkdir -p /var/lib/intact-codex && chown -R node:node /app /var/lib/intact-codex
USER node
EXPOSE 8787
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.mjs"]
