const http = require("http");
const fs = require("fs");
const path = require("path");
const campuses = require("./public/campuses.js");
const db = require("./db");
const { verifyGoogleIdToken } = require("./google-auth");

const port = Number(process.env.PORT || 3001);
const publicDir = path.join(__dirname, "public");
const isProduction = process.env.NODE_ENV === "production";
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
// Domínio Google Workspace exigido no token (claim "hd"). Vazio desativa a exigência.
const googleHostedDomain = process.env.GOOGLE_HOSTED_DOMAIN ?? "ifms.edu.br";
const devLogin = process.env.DEV_LOGIN === "1" && !isProduction;
const cookieSecure = process.env.COOKIE_SECURE === "1";
const trustProxy = process.env.TRUST_PROXY === "1";
const sessionMaxAgeSeconds = 8 * 60 * 60;
// O prefixo __Host- impede que subdomínios definam ou sobrescrevam o cookie (exige Secure).
const sessionCookie = cookieSecure ? "__Host-calendar_session" : "calendar_session";
const roles = ["REITORIA", "CAMPUS", "ADMIN"];
const institutionalEmailPattern = /^[a-z0-9._%+-]+@ifms\.edu\.br$/;

if (process.env.DEV_LOGIN === "1" && isProduction) {
  console.warn("DEV_LOGIN ignorado: não é permitido com NODE_ENV=production.");
}

const securityHeaders = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' https://accounts.google.com/gsi/client",
    "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
    "frame-src https://accounts.google.com/gsi/",
    "connect-src 'self' https://accounts.google.com/gsi/",
    "img-src 'self' data: https://*.googleusercontent.com",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // O popup do login do Google precisa se comunicar com a página.
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  ...(cookieSecure ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
};

// Limite simples de tentativas de login por IP, em memória.
const loginAttempts = new Map();
const loginWindowMs = 5 * 60 * 1000;
const maxLoginAttempts = 20;

function clientIp(req) {
  const forwarded = trustProxy ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "";
  return forwarded || req.socket.remoteAddress || "desconhecido";
}

function isLoginRateLimited(req) {
  const now = Date.now();
  const ip = clientIp(req);
  const recent = (loginAttempts.get(ip) || []).filter((time) => now - time < loginWindowMs);
  recent.push(now);
  loginAttempts.set(ip, recent);
  if (loginAttempts.size > 10000) {
    for (const [key, times] of loginAttempts) {
      if (times.every((time) => now - time >= loginWindowMs)) loginAttempts.delete(key);
    }
  }
  return recent.length > maxLoginAttempts;
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
if (adminEmail && !institutionalEmailPattern.test(adminEmail)) {
  console.warn(`ADMIN_EMAIL ignorado: ${adminEmail} não é um e-mail @ifms.edu.br.`);
} else if (db.ensureAdmin(adminEmail)) {
  console.log(`Administrador inicial cadastrado: ${adminEmail}`);
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    ...securityHeaders,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024) {
        reject(Object.assign(new Error("Requisição muito grande."), { status: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error("JSON inválido."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function getCookie(req, name) {
  const cookies = (req.headers.cookie || "").split(";").map((item) => item.trim().split("="));
  const match = cookies.find(([key]) => key === name);
  return match ? decodeURIComponent(match.slice(1).join("=")) : "";
}

function sessionCookieHeader(token, maxAge) {
  const secure = cookieSecure ? "; Secure" : "";
  return `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function currentUser(req) {
  const token = getCookie(req, sessionCookie);
  return token ? db.findSessionUser(token) : null;
}

function startSession(res, email) {
  const user = db.findUser(email.toLowerCase());
  if (!user) {
    sendJson(res, 403, { error: `O e-mail ${email} não tem autorização para acessar o sistema. Procure a TI.` });
    return;
  }
  const token = db.createSession(user.email, sessionMaxAgeSeconds);
  sendJson(res, 200, user, { "Set-Cookie": sessionCookieHeader(token, sessionMaxAgeSeconds) });
}

function validateUserInput(body) {
  const email = String(body.email || "").trim().toLowerCase();
  const role = String(body.role || "");
  const campus = role === "CAMPUS" ? String(body.campus || "") : null;
  if (!institutionalEmailPattern.test(email)) return { error: "Informe um e-mail válido do domínio @ifms.edu.br." };
  if (!roles.includes(role)) return { error: "Perfil inválido." };
  if (role === "CAMPUS" && !campuses.includes(campus)) return { error: "Selecione o campus que o usuário irá gerenciar." };
  return { value: { email, role, campus } };
}

async function handleUsers(req, res, url, admin) {
  const targetEmail = (safeDecode(url.pathname.slice("/api/users/".length)) ?? "").toLowerCase();

  if (req.method === "GET" && url.pathname === "/api/users") {
    sendJson(res, 200, db.listUsers());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/users") {
    const { error, value } = validateUserInput(await readJson(req));
    if (error) return sendJson(res, 400, { error });
    if (db.findUser(value.email)) return sendJson(res, 409, { error: "Este e-mail já está cadastrado." });
    sendJson(res, 201, db.createUser(value, admin.email));
    return;
  }

  const existing = targetEmail && db.findUser(targetEmail);
  if (!existing) return sendJson(res, 404, { error: "Usuário não encontrado." });
  const isLastAdmin = existing.role === "ADMIN" && db.countAdmins() === 1;

  if (req.method === "PUT") {
    const { error, value } = validateUserInput(await readJson(req));
    if (error) return sendJson(res, 400, { error });
    if (value.email !== existing.email && db.findUser(value.email)) {
      return sendJson(res, 409, { error: "Este e-mail já está cadastrado." });
    }
    if (isLastAdmin && value.role !== "ADMIN") {
      return sendJson(res, 409, { error: "É necessário manter pelo menos um administrador." });
    }
    sendJson(res, 200, db.updateUser(existing.email, value));
    return;
  }

  if (req.method === "DELETE") {
    if (isLastAdmin) return sendJson(res, 409, { error: "É necessário manter pelo menos um administrador." });
    db.deleteUser(existing.email);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: "Método não permitido." });
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /api/config") {
    sendJson(res, 200, { googleClientId, devLogin });
    return;
  }

  // Exigir JSON nas escritas impede envio de formulários de outros sites (CSRF).
  if (req.method !== "GET" && !String(req.headers["content-type"] || "").startsWith("application/json")) {
    sendJson(res, 415, { error: "Envie os dados como JSON." });
    return;
  }

  if (route.startsWith("POST /api/auth/") && route !== "POST /api/auth/logout" && isLoginRateLimited(req)) {
    sendJson(res, 429, { error: "Muitas tentativas de login. Aguarde alguns minutos e tente novamente." });
    return;
  }

  if (route === "POST /api/auth/google") {
    if (!googleClientId) return sendJson(res, 503, { error: "Login com Google não configurado (GOOGLE_CLIENT_ID)." });
    const { credential } = await readJson(req);
    let payload;
    try {
      payload = await verifyGoogleIdToken(credential, googleClientId);
    } catch (error) {
      console.warn(`Login Google recusado: ${error.message}`);
      return sendJson(res, 401, { error: "Não foi possível validar o login do Google." });
    }
    if (googleHostedDomain && payload.hd !== googleHostedDomain) {
      console.warn(`Login Google recusado: conta fora do domínio ${googleHostedDomain} (${payload.email})`);
      return sendJson(res, 403, { error: `Use sua conta institucional @${googleHostedDomain}.` });
    }
    startSession(res, payload.email);
    return;
  }

  if (route === "POST /api/auth/dev" && devLogin) {
    const { email } = await readJson(req);
    startSession(res, String(email || "").trim());
    return;
  }

  if (route === "POST /api/auth/logout") {
    const token = getCookie(req, sessionCookie);
    if (token) db.deleteSession(token);
    sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookieHeader("", 0) });
    return;
  }

  const user = currentUser(req);
  if (!user) return sendJson(res, 401, { error: "Sessão expirada. Entre novamente." });

  if (route === "GET /api/me") {
    sendJson(res, 200, user);
    return;
  }

  if (url.pathname === "/api/users" || url.pathname.startsWith("/api/users/")) {
    if (user.role !== "ADMIN") return sendJson(res, 403, { error: "Acesso restrito ao administrador." });
    await handleUsers(req, res, url, user);
    return;
  }

  sendJson(res, 404, { error: "Rota não encontrada." });
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function sendText(res, status, text) {
  res.writeHead(status, { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "Método não permitido");
  const cleanUrl = safeDecode(url.pathname);
  if (cleanUrl === null || cleanUrl.includes("\0")) return sendText(res, 400, "Requisição inválida");
  const requestedPath = cleanUrl === "/" ? "/index.html" : cleanUrl;
  const filePath = path.normalize(path.join(publicDir, requestedPath));

  if (!filePath.startsWith(publicDir + path.sep)) return sendText(res, 403, "Acesso negado");

  fs.readFile(filePath, (error, content) => {
    if (error) return sendText(res, 404, "Arquivo não encontrado");

    const ext = path.extname(filePath);
    res.writeHead(200, {
      ...securityHeaders,
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      // Sempre revalida, para que atualizações do sistema cheguem a todos.
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  });
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    return sendText(res, 400, "Requisição inválida");
  }

  if (url.pathname === "/health") {
    sendJson(res, 200, { status: "ok", service: "calendar-ifms-prototype" });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    try {
      await handleApi(req, res, url);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) sendJson(res, error.status || 500, { error: error.status ? error.message : "Erro interno do servidor." });
    }
    return;
  }

  try {
    serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendText(res, 500, "Erro interno do servidor");
  }
});

// Uma requisição com erro não pode derrubar o servidor inteiro.
process.on("unhandledRejection", (error) => console.error("Erro não tratado:", error));

server.listen(port, () => {
  console.log(`Calendar IFMS prototype running at http://localhost:${port}`);
  if (!googleClientId) console.warn("GOOGLE_CLIENT_ID não definido: o login com Google ficará indisponível.");
  if (devLogin) console.warn("DEV_LOGIN=1: login sem Google habilitado. Use apenas em desenvolvimento.");
});
