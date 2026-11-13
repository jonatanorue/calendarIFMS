// Apoio aos testes de tela: sobe o servidor com banco temporário e controla o Chrome sem janela
// pelo protocolo de depuração (DevTools), sem dependências externas.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate)) || null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, { timeout = 10000, interval = 100 } = {}) {
  const start = Date.now();
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch {
      // ainda não pronto
    }
    if (Date.now() - start > timeout) throw new Error("Tempo esgotado esperando a condição.");
    await sleep(interval);
  }
}

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "calendario-ui-"));
  const port = 3700 + Math.floor(Math.random() * 500);
  const server = spawn(process.execPath, [path.join(__dirname, "..", "..", "server.js")], {
    env: { ...process.env, PORT: String(port), DATABASE_PATH: path.join(dataDir, "ui.db"), DEV_LOGIN: "1", NODE_ENV: "test", ADMIN_EMAIL: "admin@ifms.edu.br", GOOGLE_CLIENT_ID: "teste", COOKIE_SECURE: "0" },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/health`)).ok);
  return {
    base,
    dataDir,
    stop() {
      server.kill();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

// Cliente da API com sessão própria (login de desenvolvimento).
async function apiAs(base, email) {
  const response = await fetch(`${base}/api/auth/dev`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
  if (!response.ok) throw new Error(`Login de ${email} falhou: ${response.status}`);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  return async (method, url, body) => {
    const result = await fetch(base + url, { method, headers: { "Content-Type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: result.status, data: await result.json().catch(() => ({})) };
  };
}

async function startBrowser() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "calendario-chrome-"));
  const port = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1300,900", "about:blank"], { stdio: "ignore" });
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((item) => item.type === "page"));
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      id += 1;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("DOM.enable");

  const page = {
    errors,
    send,
    async evaluate(expression) {
      const { result } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    },
    async goto(url) {
      await send("Page.navigate", { url });
      await waitFor(() => page.evaluate("document.readyState === 'complete'"));
    },
    async reload() {
      await send("Page.reload");
      await sleep(300);
      await waitFor(() => page.evaluate("document.readyState === 'complete'"));
    },
    waitFor: (expression, options) => waitFor(() => page.evaluate(expression), options),
    async setViewport(width, height, mobile = false) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
      await sleep(150);
    },
    async setFile(selector, file) {
      const { root } = (await send("DOM.getDocument")).result;
      const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector })).result;
      await send("DOM.setFileInputFiles", { nodeId, files: [file] });
      await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event("change"))`);
    },
    async screenshot(file) {
      fs.writeFileSync(file, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
    },
  };
  return {
    page,
    stop() {
      socket.close();
      chrome.kill();
      setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500);
    },
  };
}

module.exports = { chromePath, startServer, startBrowser, apiAs, sleep };
