# Imagem do Node. Para builds reproduzíveis, fixe a versão testada com o digest, por exemplo:
#   docker build --build-arg NODE_IMAGE=node:24-alpine@sha256:<digest> .
# (o digest aparece em "docker pull node:24-alpine" ou "docker images --digests").
ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE}

ENV NODE_ENV=production \
    PORT=3001 \
    DATABASE_PATH=/app/data/calendar.db

WORKDIR /app

# Sem dependências externas: basta copiar o código.
COPY package.json server.js db.js google-auth.js calendar-api.js storage.js ./
COPY public ./public

RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "server.js"]
