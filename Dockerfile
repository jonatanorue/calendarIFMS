# Imagem do Node fixada na versão testada (versão + digest), para cada build sair igual.
# Para atualizar: escolha a nova versão, rode "docker pull node:<versão>-alpine<x.y>", pegue o digest
# com "docker image inspect node:<versão>-alpine<x.y> --format '{{index .RepoDigests 0}}'",
# troque a linha abaixo e rode os testes (npm test e npm run test:ui) antes de publicar.
ARG NODE_IMAGE=node:24.22.3-alpine3.24@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
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
