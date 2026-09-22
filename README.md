# Sistema de Calendário Acadêmico IFMS

Protótipo web para gerenciamento do calendário acadêmico do IFMS.

## Requisitos

- Node.js 22.13 ou superior (usa o módulo nativo `node:sqlite`, sem dependências externas).

## Configuração

1. No [Google Cloud Console](https://console.cloud.google.com/apis/credentials), crie um **ID do cliente OAuth** do tipo **Aplicativo da Web**.
   Em **Origens JavaScript autorizadas**, adicione `http://localhost:3001` e `http://localhost`.
2. Copie `.env.example` para `.env` e preencha:
   - `GOOGLE_CLIENT_ID`: o ID do cliente criado no passo anterior.
   - `ADMIN_EMAIL`: e-mail `@ifms.edu.br` do primeiro administrador. Ele é cadastrado no banco ao iniciar o servidor, se ainda não existir.

## Como executar

```bash
npm run dev
```

Depois acesse:

```txt
http://localhost:3001
```

## Docker

Com o `.env` preenchido (`GOOGLE_CLIENT_ID` é obrigatório):

```bash
docker compose up -d --build
```

- O banco fica no volume `calendario-data`, montado em `/app/data`. Ele sobrevive a atualizações do container.
- A porta publicada é a 3001. Para mudar, defina `HOST_PORT` no `.env`.
- `COOKIE_SECURE` vale `1` por padrão: sirva o sistema por HTTPS (por exemplo, atrás de um proxy reverso como Nginx ou Traefik).
- `DEV_LOGIN` nunca é repassado ao container. Ali o login é sempre pelo Google.
- Em produção, adicione a URL pública do sistema (ex.: `https://calendario.ifms.edu.br`) às origens autorizadas do Client ID no Google Cloud Console.

Atualizar após mudanças no código:

```bash
git pull && docker compose up -d --build
```

Cópia de segurança do banco:

```bash
docker compose cp calendario:/app/data/calendar.db ./backup-calendar.db
```

## Acesso

- O login é feito com a conta Google institucional.
- Só entra quem estiver cadastrado no banco (`data/calendar.db`). Os demais recebem a mensagem de acesso não autorizado.
- O perfil (Reitoria, Campus ou Administrador) e o campus vêm do cadastro no banco.
- Somente o Administrador cadastra, altera e remove usuários, pela tela **Usuários**. São aceitos apenas e-mails `@ifms.edu.br`, e usuários do perfil Campus precisam ter um campus.
- Para desenvolvimento sem Google, defina `DEV_LOGIN=1` no `.env`: a tela de login passa a aceitar o e-mail digitado (ele ainda precisa estar cadastrado). Nunca habilite em produção.

## Funcionalidades já prototipadas

- Período acadêmico definido pela Reitoria ao inicializar o calendário.
- Lista dos 13 campi do IFMS em ordem alfabética.
- Filtro por campus e por tipo de evento.
- Eventos da Reitoria para todos os campi ou para um campus específico.
- Eventos locais do campus.
- Inclusão de eventos por dia único ou intervalo de datas, inclusive com duplo clique no dia.
- Visualização anual e mensal.
- Arrastar e soltar eventos.
- Totais e validações acadêmicas.
- Fluxo de publicação da base, envio, aprovação e rejeição.
- Relatórios em CSV, comparação entre campi e impressão paisagem.
- Auditoria.

Os dados do calendário (eventos, status e auditoria) ainda ficam no `localStorage` do navegador. Os usuários e as sessões ficam no banco SQLite.
