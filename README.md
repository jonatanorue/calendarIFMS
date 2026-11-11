# Sistema de Calendário Acadêmico IFMS

Protótipo web para gerenciamento do calendário acadêmico do IFMS.

## Requisitos

- Node.js 22.13 ou superior (usa o módulo nativo `node:sqlite`, sem dependências externas).

## Configuração

1. No [Google Cloud Console](https://console.cloud.google.com/apis/credentials), crie um **ID do cliente OAuth** do tipo **Aplicativo da Web**.
   Em **Origens JavaScript autorizadas**, adicione `http://localhost:3001` e `http://localhost`.
2. Copie `.env.example` para `.env` e preencha:
   - `GOOGLE_CLIENT_ID`: o ID do cliente criado no passo anterior.
   - `ADMIN_EMAIL`: e-mail `@ifms.edu.br` do primeiro administrador. Ele é cadastrado ao iniciar o servidor apenas enquanto o banco não tiver nenhum administrador; depois disso, administradores são geridos só pela tela **Usuários**.

## Como executar

```bash
npm run dev
```

Depois acesse:

```txt
http://localhost:3001
```

## Testes

```bash
npm test
```

Roda as regras de contagem de dias letivos e a API inteira (permissões, publicação, aprovação, trocas e anos letivos) contra um servidor com banco temporário. Não usa nem altera `data/calendar.db`.

## Docker

Com o `.env` preenchido (`GOOGLE_CLIENT_ID` é obrigatório):

```bash
docker compose up -d --build
```

- O banco fica no volume `calendario-data`, montado em `/app/data`. Ele sobrevive a atualizações do container.
- A porta é publicada em `127.0.0.1:3001`, ou seja, só o próprio servidor (o proxy HTTPS) acessa o container. Se o proxy estiver em outra máquina, defina `HOST_BIND=0.0.0.0`; para mudar a porta, `HOST_PORT`.
- `COOKIE_SECURE` vale `1` por padrão: sirva o sistema por HTTPS (por exemplo, atrás de um proxy reverso como Nginx ou Traefik).
- `DEV_LOGIN` nunca é repassado ao container, e o servidor o recusa com `NODE_ENV=production`. Ali o login é sempre pelo Google.
- O container roda sem root, com sistema de arquivos somente leitura (exceto o volume do banco), sem capabilities e com limite de memória.
- Em produção, adicione a URL pública do sistema (ex.: `https://calendario.ifms.edu.br`) às origens autorizadas do Client ID no Google Cloud Console.

Atualizar após mudanças no código:

```bash
git pull && docker compose up -d --build
```

Cópia de segurança do banco:

```bash
docker compose cp calendario:/app/data/calendar.db ./backup-calendar.db
```

## Segurança

- Login só com conta Google do domínio `ifms.edu.br` (claim `hd` do token, configurável em `GOOGLE_HOSTED_DOMAIN`) e cadastrada no banco.
- O token do Google é validado no servidor (assinatura, emissor, Client ID, validade e e-mail verificado).
- Sessão em cookie `HttpOnly`, `SameSite=Lax` e, com `COOKIE_SECURE=1`, `Secure` com prefixo `__Host-`; o banco guarda só o hash do token.
- Escritas na API exigem JSON (proteção contra CSRF) e há limite de 20 tentativas de login a cada 5 minutos por IP.
- Cabeçalhos de segurança: CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy` e HSTS (com `COOKIE_SECURE=1`).
- Todas as regras do calendário (quem inclui, altera, envia, aprova e publica) são conferidas no servidor, inclusive a contagem de 100 dias letivos antes do envio. O navegador só esconde os botões.

## Acesso

- O login é feito com a conta Google institucional.
- Só entra quem estiver cadastrado no banco (`data/calendar.db`). Os demais recebem a mensagem de acesso não autorizado.
- O perfil (Reitoria, Campus ou Administrador) e o campus vêm do cadastro no banco.
- Somente o Administrador cadastra, altera e remove usuários, pela tela **Usuários**. São aceitos apenas e-mails `@ifms.edu.br`, e usuários do perfil Campus precisam ter um campus.
- Para desenvolvimento sem Google, defina `DEV_LOGIN=1` no `.env`: a tela de login passa a aceitar o e-mail digitado (ele ainda precisa estar cadastrado). Nunca habilite em produção.

## Funcionalidades já prototipadas

- Vários anos letivos, criados pela Reitoria, com opção de copiar os eventos de um ano anterior. O período pode ser corrigido e o ano excluído enquanto a base não foi publicada (depois disso, só o Administrador exclui, e nunca após a publicação final).
- Lista dos 13 campi do IFMS em ordem alfabética.
- Filtro por campus e por tipo de evento.
- Eventos da Reitoria (calendário base) para todos os campi ou para um campus específico.
- Eventos do campus, incluindo feriados municipais (cadastrados pela Reitoria ou pelo próprio campus) e trocas de dia letivo (um dia deixa de ser letivo e outro passa a ser).
- Se a Reitoria inclui, altera ou remove um evento de um campus já enviado ou aprovado, o campus volta para "Em edição" para revisar a contagem.
- Inclusão de eventos por dia único ou intervalo de datas, inclusive com duplo clique no dia.
- Visualização anual e mensal.
- Arrastar e soltar eventos.
- Totais e validações acadêmicas.
- Publicação da base (depois de publicada, não pode mais ser alterada), envio, aprovação, rejeição com motivo e publicação do calendário final.
- Relatórios em CSV, comparação entre campi e impressão paisagem.
- Auditoria gravada pelo servidor.

## Dados

Tudo fica no banco SQLite (`data/calendar.db`): usuários, sessões, anos letivos, eventos, status dos campi, histórico de aprovação e auditoria. No navegador ficam só preferências de tela (ano, campus, mês e filtro selecionados).

As regras de tipos de evento e de contagem de dias letivos ficam em `public/rules.js`, usado pelo navegador e pelo servidor.
