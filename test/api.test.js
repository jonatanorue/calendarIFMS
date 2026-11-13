// Testa as regras da API com um servidor real e um banco temporário.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const rules = require("../public/rules.js");

const port = 3200 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "calendario-ifms-test-"));
let server;

test.before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_PATH: path.join(dataDir, "test.db"),
      DEV_LOGIN: "1",
      NODE_ENV: "test",
      ADMIN_EMAIL: "admin@ifms.edu.br",
      GOOGLE_CLIENT_ID: "teste",
      COOKIE_SECURE: "0",
    },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      // servidor ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("O servidor de teste não subiu.");
});

test.after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function login(email) {
  const response = await fetch(`${base}/api/auth/dev`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  assert.equal(response.status, 200, `login de ${email}`);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  return async (method, url, body) => {
    const result = await fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json", cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: result.status, data: await result.json().catch(() => ({})) };
  };
}

function endFor(course, start) {
  const allowed = rules.courseRules[course].allowedWeekdays;
  let date = start;
  let count = 0;
  for (;;) {
    if (allowed.includes(rules.weekday(date))) count += 1;
    if (count === 100) return date;
    date = rules.addDays(date, 1);
  }
}

const Y = "/api/years/2027-02-01";
const as = {};

test("prepara usuários", async () => {
  as.admin = await login("admin@ifms.edu.br");
  for (const [email, role, campus] of [
    ["reitoria@ifms.edu.br", "REITORIA"],
    ["coxim@ifms.edu.br", "CAMPUS", "Coxim"],
    ["dourados@ifms.edu.br", "CAMPUS", "Dourados"],
  ]) {
    assert.equal((await as.admin("POST", "/api/users", { email, role, campus })).status, 201);
  }
  as.reitoria = await login("reitoria@ifms.edu.br");
  as.coxim = await login("coxim@ifms.edu.br");
  as.dourados = await login("dourados@ifms.edu.br");
  assert.equal((await fetch(`${base}/api/auth/dev`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"email":"fulano@ifms.edu.br"}' })).status, 403);
});

test("ano letivo: só a Reitoria cria, sem sobreposição", async () => {
  assert.equal((await as.coxim("POST", "/api/years", { start: "2027-02-01", end: "2028-01-31" })).status, 403);
  assert.equal((await as.reitoria("POST", "/api/years", { start: "2027-02-01", end: "2028-01-31" })).status, 201);
  assert.equal((await as.reitoria("POST", "/api/years", { start: "2027-06-01", end: "2028-05-31" })).status, 409);
});

test("base: eventos de início e fim chegam a 100 dias", async () => {
  const starts = { Técnico: ["2027-02-08", "2027-08-02"], Graduação: ["2027-02-15", "2027-08-09"] };
  for (const [course, list] of Object.entries(starts)) {
    for (const [index, start] of list.entries()) {
      const type = rules.courseRules[course].boundaryType;
      const semester = index + 1;
      assert.equal((await as.reitoria("POST", `${Y}/events`, { type, title: `Início ${course} ${semester}`, start, end: start, course, semester })).status, 200);
      const end = endFor(course, start);
      assert.equal((await as.reitoria("POST", `${Y}/events`, { type, title: `Fim ${course} ${semester}`, start: end, end, course, semester })).status, 200);
    }
  }
  const { data } = await as.reitoria("GET", Y);
  assert.equal(rules.meetsSchoolDayRules(data.year.events), true);
});

test("período do ano: corrige antes de publicar e não deixa eventos de fora", async () => {
  assert.equal((await as.coxim("PUT", Y, { start: "2027-02-01", end: "2028-01-30" })).status, 403);
  const tooShort = await as.reitoria("PUT", Y, { start: "2027-03-01", end: "2028-01-31" });
  assert.equal(tooShort.status, 409, "eventos de fevereiro ficariam de fora");
  const ok = await as.reitoria("PUT", Y, { start: "2027-02-01", end: "2028-01-30" });
  assert.equal(ok.data.year.calendar.end, "2028-01-30");
});

test("campus não inclui antes da base publicada", async () => {
  const response = await as.coxim("POST", `${Y}/events`, { type: "Recesso", title: "x", start: "2027-03-01", end: "2027-03-01" });
  assert.equal(response.status, 409);
});

test("base publicada não pode mais ser alterada, nem pelo Administrador", async () => {
  assert.equal((await as.coxim("POST", `${Y}/publish-base`, {})).status, 403);
  assert.equal((await as.reitoria("POST", `${Y}/publish-base`, {})).status, 200);
  const baseEvent = (await as.reitoria("GET", Y)).data.year.events[0];
  assert.equal((await as.reitoria("PUT", `${Y}/events/${baseEvent.id}`, { ...baseEvent, title: "alterado" })).status, 409);
  assert.equal((await as.reitoria("POST", `${Y}/events`, { type: "Feriado Nacional", title: "x", start: "2027-04-21", end: "2027-04-21" })).status, 409);
  assert.equal((await as.admin("DELETE", `${Y}/events/${baseEvent.id}`, {})).status, 409);
  assert.equal((await as.reitoria("PUT", Y, { start: "2027-02-01", end: "2028-01-31" })).status, 409, "período travado");
});

test("feriado municipal: Reitoria inclui para um campus; outros tipos não", async () => {
  const ok = await as.reitoria("POST", `${Y}/events`, { type: "Feriado Municipal", title: "Aniversário de Dourados", start: "2027-04-13", end: "2027-04-13", campus: "Dourados" });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data.reopened, [], "Dourados ainda está em edição");
  assert.equal((await as.reitoria("POST", `${Y}/events`, { type: "Recesso", title: "x", start: "2027-03-01", end: "2027-03-01", campus: "Coxim" })).status, 403);
});

test("campus: só o próprio campus, e o servidor esconde os outros", async () => {
  const created = await as.coxim("POST", `${Y}/events`, { type: "Feriado Municipal", title: "Aniversário de Coxim", start: "2027-04-12", end: "2027-04-12", campus: "Dourados" });
  assert.equal(created.status, 200);
  const holiday = created.data.year.events.find((event) => event.title === "Aniversário de Coxim");
  assert.equal(holiday.campus, "Coxim", "o campus informado é ignorado");
  assert.equal(created.data.year.events.some((event) => event.campus === "Dourados"), false);
  assert.deepEqual(Object.keys(created.data.year.campusStatus), ["Coxim"]);
  const douradosEvent = (await as.reitoria("GET", Y)).data.year.events.find((event) => event.campus === "Dourados");
  assert.equal((await as.coxim("DELETE", `${Y}/events/${douradosEvent.id}`, {})).status, 404);
  assert.equal((await as.coxim("POST", `${Y}/campus/Dourados/submit`, {})).status, 403);
  const blocked = await as.coxim("POST", `${Y}/campus/Coxim/submit`, {});
  assert.equal(blocked.status, 409, "o feriado tirou um dia letivo");
  assert.equal((await as.coxim("DELETE", `${Y}/events/${holiday.id}`, {})).status, 200);
});

test("troca de dia letivo exige o dia de reposição e mantém o total", async () => {
  const missing = await as.coxim("POST", `${Y}/events`, { type: "Troca de Dia Letivo", title: "Troca", start: "2027-03-02", end: "2027-03-02" });
  assert.equal(missing.status, 400);
  const same = await as.coxim("POST", `${Y}/events`, { type: "Troca de Dia Letivo", title: "Troca", start: "2027-03-02", swapDate: "2027-03-02" });
  assert.equal(same.status, 400);
  // Só para o Técnico: na Graduação o sábado já é letivo, e a troca tiraria um dia.
  const ok = await as.coxim("POST", `${Y}/events`, { type: "Troca de Dia Letivo", title: "Troca", start: "2027-03-02", end: "2027-03-10", swapDate: "2027-03-06", course: "Técnico" });
  assert.equal(ok.status, 200);
  const swap = ok.data.year.events.find((event) => event.type === "Troca de Dia Letivo");
  assert.equal(swap.end, "2027-03-02", "a troca é de um dia só");
  assert.equal(swap.swapDate, "2027-03-06");
  const counted = rules.countCourseSchoolDays(rules.eventsForCampus(ok.data.year.events, "Coxim"), "Técnico", 1);
  assert.equal(counted.total, 100);
  assert.equal(counted.dates.has("2027-03-02"), false);
  const graduacao = rules.countCourseSchoolDays(rules.eventsForCampus(ok.data.year.events, "Coxim"), "Graduação", 1);
  assert.equal(graduacao.total, 100, "troca só do Técnico não afeta a Graduação");
});

test("envio, rejeição com motivo e aprovação", async () => {
  assert.equal((await as.coxim("POST", `${Y}/campus/Coxim/submit`, {})).data.year.campusStatus.Coxim.status, "Pendente");
  assert.equal((await as.coxim("POST", `${Y}/events`, { type: "Recesso", title: "x", start: "2027-03-01", end: "2027-03-01" })).status, 409);
  assert.equal((await as.coxim("POST", `${Y}/campus/Coxim/review`, { action: "approve" })).status, 403);
  assert.equal((await as.reitoria("POST", `${Y}/campus/Coxim/review`, { action: "reject", reason: " " })).status, 400);
  await as.reitoria("POST", `${Y}/campus/Coxim/review`, { action: "reject", reason: "Conferir o recesso." });
  assert.equal((await as.coxim("GET", Y)).data.year.campusStatus.Coxim.reason, "Conferir o recesso.");
  await as.coxim("POST", `${Y}/campus/Coxim/submit`, {});
  const approved = await as.reitoria("POST", `${Y}/campus/Coxim/review`, { action: "approve" });
  assert.equal(approved.data.year.campusStatus.Coxim.status, "Aprovado");
});

test("Reitoria mexe no calendário de campus aprovado: ele volta para edição", async () => {
  const response = await as.reitoria("POST", `${Y}/events`, { type: "Feriado Municipal", title: "Feriado novo", start: "2027-05-04", end: "2027-05-04", campus: "Coxim" });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.reopened, ["Coxim"]);
  const status = response.data.year.campusStatus.Coxim;
  assert.equal(status.status, "Em edição");
  assert.match(status.reason, /Reaberto automaticamente/);
  const holiday = response.data.year.events.find((event) => event.title === "Feriado novo");
  assert.equal((await as.coxim("DELETE", `${Y}/events/${holiday.id}`, {})).status, 200, "o campus volta a poder editar");
});

test("calendário final: só com todos aprovados, e trava tudo", async () => {
  assert.equal((await as.reitoria("POST", `${Y}/final`, { published: true })).status, 409);
  const douradosEvent = (await as.reitoria("GET", Y)).data.year.events.find((event) => event.campus === "Dourados");
  await as.reitoria("DELETE", `${Y}/events/${douradosEvent.id}`, {});
  const statuses = (await as.admin("GET", Y)).data.year.campusStatus;
  for (const campus of Object.keys(statuses)) {
    if (statuses[campus].status !== "Aprovado") {
      assert.equal((await as.admin("POST", `${Y}/campus/${encodeURIComponent(campus)}/submit`, {})).status, 200, `envio de ${campus}`);
      await as.reitoria("POST", `${Y}/campus/${encodeURIComponent(campus)}/review`, { action: "approve" });
    }
  }
  assert.equal((await as.reitoria("POST", `${Y}/final`, { published: true })).data.year.finalPublished, true);
  assert.equal((await as.admin("POST", `${Y}/events`, { type: "Feriado Municipal", title: "x", start: "2027-03-01", end: "2027-03-01", campus: "Coxim" })).status, 409);
  assert.equal((await as.reitoria("POST", `${Y}/campus/Coxim/review`, { action: "reopen" })).status, 409);
  assert.equal((await as.admin("DELETE", Y, {})).status, 409, "ano com calendário final não é excluído");
  assert.equal((await as.reitoria("POST", `${Y}/final`, { published: false })).data.year.finalPublished, false);
});

test("calendário público: só o final publicado, sem e-mails, com .ics", async () => {
  assert.deepEqual(await (await fetch(`${base}/api/public/years`)).json(), [], "nada publicado ainda");
  assert.equal((await fetch(`${base}/api/public/years/2027-02-01`)).status, 404);
  assert.equal((await as.reitoria("POST", `${Y}/final`, { published: true })).status, 200);

  const years = await (await fetch(`${base}/api/public/years`)).json();
  assert.deepEqual(years.map((year) => year.id), ["2027-02-01"]);
  const all = await (await fetch(`${base}/api/public/years/2027-02-01`)).json();
  assert.ok(all.events.length > 0);
  assert.equal(JSON.stringify(all).includes("@ifms.edu.br"), false, "não expõe quem editou");
  const coxim = await (await fetch(`${base}/api/public/years/2027-02-01?campus=Coxim`)).json();
  assert.ok(coxim.events.every((event) => !event.campus || event.campus === "Coxim"));
  assert.equal((await fetch(`${base}/api/public/years/2027-02-01?campus=Xyz`)).status, 400);

  const ics = await fetch(`${base}/api/public/years/2027-02-01/calendario.ics?campus=Coxim`);
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get("content-type"), /text\/calendar/);
  assert.match(ics.headers.get("content-disposition"), /calendario-ifms-2027-2028-coxim\.ics/);
  const text = await ics.text();
  assert.ok(text.startsWith("BEGIN:VCALENDAR\r\n") && text.trimEnd().endsWith("END:VCALENDAR"));
  assert.ok(text.includes("DTSTART;VALUE=DATE:20270208"), "início das aulas técnicas");
  assert.ok(text.includes("(reposição de 02/03/2027)"), "a troca gera o dia de reposição");
  assert.ok(text.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75), "linhas dobradas em 75 bytes");
  assert.equal((await fetch(`${base}/api/public/years`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${base}/publico`)).status, 200);
});

test("feriados em lote: tudo ou nada", async () => {
  const draft = await as.reitoria("POST", "/api/years", { start: "2029-02-01", end: "2030-01-31" });
  assert.equal(draft.status, 201);
  const batchUrl = "/api/years/2029-02-01/events/batch";
  const bad = await as.reitoria("POST", batchUrl, { events: [
    { type: "Feriado Nacional", title: "Tiradentes", start: "2029-04-21", end: "2029-04-21" },
    { type: "Feriado Nacional", title: "Fora do ano", start: "2031-01-01", end: "2031-01-01" },
  ] });
  assert.equal(bad.status, 400);
  assert.equal((await as.reitoria("GET", "/api/years/2029-02-01")).data.year.events.length, 0, "nada foi gravado");
  const holidays = rules.holidaysInPeriod("2029-02-01", "2030-01-31");
  const ok = await as.reitoria("POST", batchUrl, { events: holidays.map((holiday) => ({ type: holiday.type, title: holiday.title, start: holiday.date, end: holiday.date })) });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.year.events.length, holidays.length);
  assert.equal((await as.coxim("POST", batchUrl, { events: [{ type: "Feriado Nacional", title: "x", start: "2029-04-21", end: "2029-04-21" }] })).status, 403);
  assert.equal((await as.reitoria("DELETE", "/api/years/2029-02-01", {})).status, 200);
});

test("novo ano copia a base deslocada, inclusive a reposição das trocas", async () => {
  const response = await as.reitoria("POST", "/api/years", { start: "2028-02-01", end: "2029-01-31", copyFrom: "2027-02-01", includeCampusEvents: true });
  assert.equal(response.status, 201);
  const swap = response.data.year.events.find((event) => event.type === "Troca de Dia Letivo");
  assert.equal(swap.start, "2028-03-02");
  assert.equal(swap.swapDate, "2028-03-06");
  assert.equal(response.data.year.basePublished, false);
});

test("exclusão de ano: Reitoria só antes de publicar a base", async () => {
  assert.equal((await as.coxim("DELETE", "/api/years/2028-02-01", {})).status, 403);
  assert.equal((await as.reitoria("DELETE", Y, {})).status, 409, "base publicada");
  assert.equal((await as.reitoria("DELETE", "/api/years/2028-02-01", {})).status, 200);
  assert.equal((await as.reitoria("GET", "/api/years/2028-02-01")).status, 404);
});

test("auditoria: gravada no servidor e restrita à Reitoria", async () => {
  assert.equal((await as.coxim("GET", "/api/audit")).status, 403);
  const { data } = await as.reitoria("GET", "/api/audit");
  const actions = data.map((entry) => entry.action);
  for (const action of ["Calendário base publicado", "Ano letivo excluído", "Período do ano letivo alterado", "Usuário cadastrado"]) {
    assert.ok(actions.includes(action), action);
  }
});

test("endereços inválidos não derrubam o servidor", async () => {
  assert.equal((await as.reitoria("GET", "/api/years/%E0")).status, 400);
  assert.equal((await fetch(`${base}/%E0`)).status, 400);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});
