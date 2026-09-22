FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=3001 \
    DATABASE_PATH=/app/data/calendar.db

WORKDIR /app

# Sem dependências externas: basta copiar o código.
COPY package.json server.js db.js google-auth.js ./
COPY public ./public

RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "server.js"]
