// Testes de tela no Chrome sem janela. Rodar com: npm run test:ui
// São pulados quando o Chrome não está instalado (defina CHROME_PATH se estiver em outro lugar).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const rules = require("../../public/rules.js");
const { chromePath, startServer, startBrowser, apiAs } = require("./browser.js");

const skip = chromePath ? false : "Chrome não encontrado (defina CHROME_PATH)";
const Y = "/api/years/2027-02-01";
let server;
let browser;
let page;
const api = {};

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

async function loginAs(email) {
  await page.goto(server.base);
  await page.evaluate(`fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })`);
  await page.evaluate(`fetch("/api/auth/dev", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: ${JSON.stringify(email)} }) })`);
  await page.reload();
  await page.waitFor(`!document.body.classList.contains("signed-out") && typeof currentYear !== "undefined" && currentYear !== null`);
}

const openView = (view) => page.evaluate(`document.querySelector('nav [data-view="${view}"]').click()`);
const toast = () => page.evaluate(`document.getElementById("toast").textContent`);
// No modo celular o Chrome aumenta a janela para caber o conteúdo; a largura real é a do documento.
const overflow = () => page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");

function writeCsv(name, lines) {
  const file = path.join(server.dataDir, name);
  fs.writeFileSync(file, `﻿${lines.join("\r\n")}`);
  return file;
}

test.before(async () => {
  if (skip) return;
  server = await startServer();
  api.admin = await apiAs(server.base, "admin@ifms.edu.br");
  await api.admin("POST", "/api/users", { email: "reitoria@ifms.edu.br", role: "REITORIA" });
  await api.admin("POST", "/api/users", { email: "coxim@ifms.edu.br", role: "CAMPUS", campus: "Coxim" });
  api.reitoria = await apiAs(server.base, "reitoria@ifms.edu.br");
  await api.reitoria("POST", "/api/years", { start: "2027-02-01", end: "2028-01-31" });
  const starts = { Técnico: ["2027-02-08", "2027-08-02"], Graduação: ["2027-02-15", "2027-08-09"] };
  for (const [course, list] of Object.entries(starts)) {
    for (const [index, start] of list.entries()) {
      const type = rules.courseRules[course].boundaryType;
      await api.reitoria("POST", `${Y}/events`, { type, title: `Início ${course} ${index + 1}º`, start, end: start, course, semester: index + 1 });
      const end = endFor(course, start);
      await api.reitoria("POST", `${Y}/events`, { type, title: `Fim ${course} ${index + 1}º`, start: end, end, course, semester: index + 1 });
    }
  }
  browser = await startBrowser();
  page = browser.page;
});

test.after(() => {
  browser?.stop();
  server?.stop();
});

test("Reitoria entra e o Dashboard mostra a validação dos semestres", { skip }, async () => {
  await loginAs("reitoria@ifms.edu.br");
  assert.equal(await page.evaluate(`document.querySelectorAll("#validationSummary .validation-card").length`), 5);
  assert.equal(await page.evaluate(`document.getElementById("yearFilter").selectedOptions[0].textContent`), "Ano letivo 2027/2028");
});

test("importação: prévia aponta erros e duplicados e grava só as linhas prontas", { skip }, async () => {
  const file = writeCsv("base.csv", [
    "Tipo;Título;Início;Fim;Campus;Curso;Semestre",
    "Feriado Nacional;Tiradentes;21/04/2027;;Todos os campi;;",
    "Recesso institucional;Carnaval - Recesso;10/02/2027;;;;",
    "Início/Fim de aulas Técnicas;Início Técnico 1º;08/02/2027;;;Técnico;1",
    "Feriado Lunar;Inexistente;01/03/2027;;;;",
  ]);
  await openView("annual");
  await page.evaluate(`document.querySelector('[data-action="open-import"]').click()`);
  await page.setFile("#importFile", file);
  await page.waitFor(`!document.getElementById("importPreview").hidden`);
  const summary = await page.evaluate(`document.getElementById("importSummary").textContent`);
  assert.match(summary, /4 linha\(s\): 2 pronta\(s\) para importar, 1 com erro/);
  assert.match(summary, /1 já existente/);
  assert.equal(await page.evaluate(`document.getElementById("importSubmit").textContent`), "Importar 2 evento(s)");
  await page.evaluate(`document.getElementById("importForm").requestSubmit()`);
  await page.waitFor(`!document.getElementById("importDialog").open`);
  assert.match(await toast(), /2 evento\(s\) importado\(s\)/);
  const { data } = await api.reitoria("GET", Y);
  assert.ok(data.year.events.some((event) => event.title === "Tiradentes" && event.type === "Feriado Nacional"));
  assert.ok(data.year.events.some((event) => event.type === "Recesso institucional"));
  assert.equal(data.year.events.filter((event) => event.title === "Início Técnico 1º").length, 1, "o duplicado não foi gravado");
});

test("telas internas não rolam para o lado num celular (400px)", { skip }, async () => {
  await page.setViewport(400, 860, true);
  try {
    for (const view of ["dashboard", "annual", "monthly", "events", "approval", "reports", "audit"]) {
      await page.evaluate("window.scrollTo(0, 0)");
      await openView(view);
      assert.ok((await overflow()) <= 1, `tela "${view}" rola ${await overflow()}px para o lado`);
    }
    await openView("annual");
    await page.evaluate(`document.querySelector('[data-action="open-reitoria-event"]').click()`);
    assert.ok((await overflow()) <= 1, "diálogo de evento");
    await page.evaluate(`document.getElementById("eventDialog").close()`);
  } finally {
    await page.setViewport(1300, 900);
  }
});

test("campus importa sempre no próprio campus", { skip }, async () => {
  await api.reitoria("POST", `${Y}/publish-base`, {});
  await loginAs("coxim@ifms.edu.br");
  const file = writeCsv("campus.csv", ["Tipo;Título;Início;Campus", "Feriado Municipal;Aniversário da cidade;12/04/2027;Dourados"]);
  await openView("annual");
  await page.evaluate(`document.querySelector('[data-action="open-import"]').click()`);
  await page.setFile("#importFile", file);
  await page.waitFor(`!document.getElementById("importPreview").hidden`);
  assert.equal(await page.evaluate(`document.querySelector("#importRows tr").cells[5].textContent`), "Coxim");
  await page.evaluate(`document.getElementById("importForm").requestSubmit()`);
  await page.waitFor(`!document.getElementById("importDialog").open`);
  const { data } = await api.admin("GET", Y);
  const holiday = data.year.events.find((event) => event.title === "Aniversário da cidade");
  assert.equal(holiday?.campus, "Coxim");
});

test("calendário oficial (PDF) monta as folhas do campus", { skip }, async () => {
  await page.goto(`${server.base}/impressao?ano=2027-02-01&campus=Coxim`);
  await page.waitFor(`document.getElementById("status").textContent.includes("folha(s)")`);
  assert.ok((await page.evaluate(`document.querySelectorAll(".page").length`)) >= 2);
  assert.match(await page.evaluate(`document.querySelector(".page").textContent`), /Campus\s*Coxim/);
});

test("páginas abertas (guia, privacidade, pública) funcionam no celular", { skip }, async () => {
  await page.setViewport(400, 860, true);
  try {
    for (const url of ["/ajuda", "/privacidade", "/publico"]) {
      await page.goto(server.base + url);
      assert.ok((await overflow()) <= 1, `${url} rola ${await overflow()}px para o lado`);
    }
  } finally {
    await page.setViewport(1300, 900);
  }
});

test("nenhum erro de JavaScript nas telas", { skip }, () => {
  assert.deepEqual(page.errors, []);
});
