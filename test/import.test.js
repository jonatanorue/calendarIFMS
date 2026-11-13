const test = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../public/rules.js");
const campuses = require("../public/campuses.js");
const calendarImport = require("../public/import.js");

const options = (extra = {}) => ({
  eventTypes: rules.eventTypes,
  boundaryTypes: rules.boundaryTypes,
  campuses,
  courses: Object.keys(rules.courseRules),
  calendar: { start: "2027-02-01", end: "2028-01-31" },
  role: "REITORIA",
  userCampus: "",
  existing: [],
  ...extra,
});

const convert = (csv, extra) => calendarImport.rowsToEvents(calendarImport.parseCsv(csv), options(extra));

test("lê CSV com BOM, ponto e vírgula, aspas e quebra de linha", () => {
  const rows = calendarImport.parseCsv('﻿Tipo;Título\r\nFeriado Nacional;"Tiradentes; feriado"\r\nRecesso;"Linha 1\nLinha 2 com ""aspas"""\r\n');
  assert.deepEqual(rows, [["Tipo", "Título"], ["Feriado Nacional", "Tiradentes; feriado"], ["Recesso", 'Linha 1\nLinha 2 com "aspas"']]);
});

test("detecta vírgula como separador", () => {
  assert.deepEqual(calendarImport.parseCsv("Tipo,Título\nFeriado Nacional,Natal"), [["Tipo", "Título"], ["Feriado Nacional", "Natal"]]);
});

test("datas em dd/mm/aaaa, dd/mm/aa e aaaa-mm-dd; rejeita datas impossíveis", () => {
  assert.equal(calendarImport.parseDate("21/04/2027"), "2027-04-21");
  assert.equal(calendarImport.parseDate("1/2/27"), "2027-02-01");
  assert.equal(calendarImport.parseDate("2027-04-21"), "2027-04-21");
  assert.equal(calendarImport.parseDate("31/02/2027"), null);
  assert.equal(calendarImport.parseDate("abril"), null);
});

test("importa a planilha que o próprio sistema exporta", () => {
  const exported = [
    "﻿Ano letivo;Campus;Tipo;Título;Início;Fim;Dia de reposição;Curso;Semestre;Conta como dia letivo;Origem",
    "2027/2028;Todos os campi;Início/Fim de aulas Técnicas;Início das aulas;08/02/2027;08/02/2027;;Técnico;1º;Não;Reitoria",
    "2027/2028;Ponta Porã;Troca de Dia Letivo;Troca;02/03/2027;02/03/2027;06/03/2027;Técnico;;Não;Campus",
    "2027/2028;Ponta Porã;Sábado Letivo;Sábado;27/03/2027;27/03/2027;;Todos;;Sim;Campus",
    "2027/2028;Todos os campi;Prazo ou atividade;'-Prazo com hífen;10/02/2027;12/02/2027;;Todos;;Não;Reitoria",
  ].join("\r\n");
  const { events, problems } = convert(exported);
  assert.deepEqual(problems, []);
  assert.ok(events.every((row) => row.errors.length === 0), JSON.stringify(events.map((row) => row.errors)));
  const [boundary, swap, saturday, deadline] = events.map((row) => row.event);
  assert.deepEqual(boundary, { type: "Início/Fim de aulas Técnicas", title: "Início das aulas", start: "2027-02-08", end: "2027-02-08", campus: "", course: "Técnico", semester: 1, affectsSchoolDay: false, swapDate: null });
  assert.equal(swap.swapDate, "2027-03-06");
  assert.equal(swap.campus, "Ponta Porã");
  assert.equal(saturday.affectsSchoolDay, true);
  assert.equal(saturday.course, "");
  assert.equal(deadline.title, "-Prazo com hífen", "remove o apóstrofo de proteção do Excel");
});

test("aponta o erro de cada linha", () => {
  const csv = [
    "Tipo;Título;Início;Fim;Campus;Curso",
    "Feriado Lunar;X;01/03/2027;;;",
    "Feriado Nacional;;01/03/2027;;;",
    "Feriado Nacional;Data ruim;31/02/2027;;;",
    "Feriado Nacional;Fora;01/03/2030;;;",
    "Feriado Municipal;Sem campus;01/03/2027;;;",
    "Recesso;Campus errado;01/03/2027;;Atlântida;",
    "Feriado Nacional;Curso errado;01/03/2027;;;Medicina",
    "Feriado Nacional;Fim antes;10/03/2027;01/03/2027;;",
    "Troca de Dia Letivo;Sem reposição;02/03/2027;;Coxim;",
  ].join("\n");
  const errors = convert(csv).events.map((row) => `${row.line}: ${row.errors.join(", ")}`);
  assert.match(errors[0], /^2: tipo "Feriado Lunar" não existe/);
  assert.match(errors[1], /^3: título vazio/);
  assert.match(errors[2], /^4: data de início inválida/);
  assert.match(errors[3], /^5: fora do período/);
  assert.match(errors[4], /^6: eventos do campus precisam/);
  assert.match(errors[5], /^7: campus "Atlântida" não existe/);
  assert.match(errors[6], /^8: curso "Medicina" não existe/);
  assert.match(errors[7], /^9: o fim é anterior ao início/);
  assert.match(errors[8], /^10: troca sem o dia de reposição/);
});

test("faltando colunas obrigatórias, explica quais", () => {
  const { problems } = convert("Nome;Quando\nNatal;25/12/2027");
  assert.match(problems[0], /Tipo, Título, Início/);
});

test("marca eventos que já existem no ano e repetidos na planilha", () => {
  const csv = "Tipo;Título;Início\nFeriado Nacional;Natal;25/12/2027\nFeriado Nacional;Tiradentes;21/04/2027\nFeriado Nacional;Tiradentes;21/04/2027";
  const existing = [{ type: "Feriado Nacional", title: "NATAL", start: "2027-12-25", campus: "" }];
  const rows = convert(csv, { existing }).events;
  assert.deepEqual(rows.map((row) => [row.duplicate, row.repeated]), [[true, false], [false, false], [false, true]]);
});

test("perfil Campus importa sempre no próprio campus", () => {
  const rows = convert("Tipo;Título;Início;Campus\nFeriado Municipal;Padroeiro;19/03/2027;Dourados", { role: "CAMPUS", userCampus: "Ponta Porã" }).events;
  assert.equal(rows[0].event.campus, "Ponta Porã");
});

test("o modelo de planilha é importado sem erros", () => {
  const rows = convert(calendarImport.templateCsv()).events;
  assert.equal(rows.length, 7);
  assert.ok(rows.every((row) => row.errors.length === 0), JSON.stringify(rows.map((row) => row.errors)));
});
