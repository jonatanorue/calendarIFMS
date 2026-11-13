const test = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../public/rules.js");

// Fim das aulas para chegar a exatamente `total` dias letivos a partir do início.
function endFor(course, start, total = 100) {
  const allowed = rules.courseRules[course].allowedWeekdays;
  let date = start;
  let count = 0;
  for (;;) {
    if (allowed.includes(rules.weekday(date))) count += 1;
    if (count === total) return date;
    date = rules.addDays(date, 1);
  }
}

function boundaries(course, semester, start) {
  const type = rules.courseRules[course].boundaryType;
  return [
    { type, title: "Início", start, end: start, course, semester },
    { type, title: "Fim", start: endFor(course, start), end: endFor(course, start), course, semester },
  ];
}

const tecnico1 = boundaries("Técnico", 1, "2027-02-08"); // segunda-feira

test("Técnico conta só de segunda a sexta", () => {
  assert.equal(rules.countCourseSchoolDays(tecnico1, "Técnico", 1).total, 100);
  const saturday = "2027-02-13";
  assert.equal(rules.weekday(saturday), 6);
  assert.equal(rules.countCourseSchoolDays(tecnico1, "Técnico", 1).dates.has(saturday), false);
});

test("Graduação conta todos os sábados", () => {
  const graduacao = boundaries("Graduação", 1, "2027-02-08");
  const result = rules.countCourseSchoolDays(graduacao, "Graduação", 1);
  assert.equal(result.total, 100);
  assert.equal(result.dates.has("2027-02-13"), true);
});

test("semestre sem início ou fim não conta dias", () => {
  assert.equal(rules.countCourseSchoolDays(tecnico1, "Técnico", 2).total, 0);
  assert.equal(rules.meetsSchoolDayRules(tecnico1), false);
});

test("recesso institucional (da base) é dia não letivo para todos os campi", () => {
  assert.equal(rules.eventTypes["Recesso institucional"].scope, "REITORIA");
  const recess = { type: "Recesso institucional", title: "Carnaval - Recesso", start: "2027-02-10", end: "2027-02-10" };
  assert.equal(rules.countCourseSchoolDays([...tecnico1, recess], "Técnico", 1).total, 99);
  assert.equal(rules.eventsForCampus([recess], "Coxim").length, 1);
});

test("feriado municipal é dia não letivo", () => {
  const events = [...tecnico1, { type: "Feriado Municipal", title: "x", start: "2027-03-02", end: "2027-03-02", campus: "Coxim" }];
  assert.equal(rules.countCourseSchoolDays(events, "Técnico", 1).total, 99);
});

test("eventos de outro campus não entram na contagem do campus", () => {
  const events = [...tecnico1, { type: "Feriado Municipal", title: "x", start: "2027-03-02", end: "2027-03-02", campus: "Dourados" }];
  assert.equal(rules.countCourseSchoolDays(rules.eventsForCampus(events, "Coxim"), "Técnico", 1).total, 100);
});

test("troca de dia letivo: o dia original sai e a reposição entra", () => {
  const swap = { type: "Troca de Dia Letivo", title: "Troca", start: "2027-03-02", end: "2027-03-02", swapDate: "2027-03-06" };
  const result = rules.countCourseSchoolDays([...tecnico1, swap], "Técnico", 1);
  assert.equal(result.total, 100, "a troca mantém o total");
  assert.equal(result.dates.has("2027-03-02"), false);
  assert.equal(result.dates.has("2027-03-06"), true, "o sábado de reposição passa a ser letivo");
});

test("troca com reposição fora do semestre só tira o dia original", () => {
  const swap = { type: "Troca de Dia Letivo", title: "Troca", start: "2027-03-02", end: "2027-03-02", swapDate: "2027-12-30" };
  assert.equal(rules.countCourseSchoolDays([...tecnico1, swap], "Técnico", 1).total, 99);
});

test("evento marcado como letivo acrescenta o dia", () => {
  const saturday = { type: "Sábado Letivo", title: "Sábado", start: "2027-03-06", end: "2027-03-06", affectsSchoolDay: true };
  assert.equal(rules.countCourseSchoolDays([...tecnico1, saturday], "Técnico", 1).total, 101);
});

test("datas não dependem do fuso horário", () => {
  assert.deepEqual(rules.dateRange("2027-02-27", "2027-03-02"), ["2027-02-27", "2027-02-28", "2027-03-01", "2027-03-02"]);
  assert.equal(rules.addDays("2028-02-28", 1), "2028-02-29");
});

test("troca para um sábado não repõe nada na Graduação, onde o sábado já é letivo", () => {
  const graduacao = boundaries("Graduação", 1, "2027-02-08");
  const swap = { type: "Troca de Dia Letivo", title: "Troca", start: "2027-03-02", end: "2027-03-02", swapDate: "2027-03-06" };
  assert.equal(rules.countCourseSchoolDays([...graduacao, swap], "Graduação", 1).total, 99);
});

test("contagem explica o que cada evento tirou e acrescentou", () => {
  const holiday = { type: "Feriado Nacional", title: "Feriado", start: "2027-03-02", end: "2027-03-02" };
  const saturday = { type: "Sábado Letivo", title: "Sábado", start: "2027-03-06", end: "2027-03-06", affectsSchoolDay: true };
  const result = rules.countCourseSchoolDays([...tecnico1, holiday, saturday], "Técnico", 1);
  assert.equal(result.base, 100);
  assert.deepEqual(result.removed.map((entry) => [entry.date, entry.event.title]), [["2027-03-02", "Feriado"]]);
  assert.deepEqual(result.added.map((entry) => [entry.date, entry.event.title]), [["2027-03-06", "Sábado"]]);
  assert.equal(result.total, result.base - result.removed.length + result.added.length);
});

test("Páscoa e feriados móveis", () => {
  assert.equal(rules.easterDate(2025), "2025-04-20");
  assert.equal(rules.easterDate(2027), "2027-03-28");
  assert.equal(rules.easterDate(2028), "2028-04-16");
  const holidays = rules.nationalHolidays(2027);
  const find = (title) => holidays.find((holiday) => holiday.title.startsWith(title))?.date;
  assert.equal(find("Paixão"), "2027-03-26");
  assert.equal(find("Corpus Christi"), "2027-05-27");
  assert.deepEqual(holidays.filter((holiday) => holiday.title.startsWith("Carnaval")).map((holiday) => holiday.date), ["2027-02-08", "2027-02-09"]);
  assert.equal(holidays.find((holiday) => holiday.date === "2027-10-11").type, "Feriado Estadual");
});

test("feriados de um período que atravessa o ano civil", () => {
  const list = rules.holidaysInPeriod("2027-02-01", "2028-01-31");
  assert.equal(list[0].date, "2027-02-08");
  assert.equal(list.at(-1).date, "2028-01-01");
  assert.equal(list.some((holiday) => holiday.date === "2027-01-01"), false);
});

test("conferência aponta os problemas comuns", () => {
  const warnings = rules.reviewWarnings([
    ...tecnico1,
    { type: "Sábado Letivo", title: "Sábado errado", start: "2027-03-03", end: "2027-03-03", affectsSchoolDay: true },
    { type: "Sábado Letivo", title: "Fora", start: "2027-12-18", end: "2027-12-18", affectsSchoolDay: true, course: "Técnico" },
    { type: "Feriado Nacional", title: "A", start: "2027-04-21", end: "2027-04-21" },
    { type: "Feriado Nacional", title: "B", start: "2027-04-21", end: "2027-04-21" },
    { type: "Troca de Dia Letivo", title: "Troca no domingo", start: "2027-03-07", end: "2027-03-07", swapDate: "2027-03-13" },
  ]);
  const has = (text) => warnings.some((warning) => warning.includes(text));
  assert.ok(has("Técnico 2º semestre: falta cadastrar"));
  assert.ok(has("Graduação 1º semestre: falta cadastrar"));
  assert.ok(has('"Sábado errado"') && has("não cai num sábado"));
  assert.ok(has('"Fora"') && has("não altera a contagem"));
  assert.ok(has('Há mais de um "Feriado Nacional"'));
  assert.ok(has("Troca no domingo") && has("já não era dia letivo"));
});

test("conferência sem problemas", () => {
  const complete = Object.keys(rules.courseRules).flatMap((course) => [
    ...boundaries(course, 1, "2027-02-08"),
    ...boundaries(course, 2, "2027-08-02"),
  ]);
  assert.deepEqual(rules.reviewWarnings(complete), []);
});

test("tipos informativos (prazos, atividades, ajuste de horário) não alteram a contagem", () => {
  const informational = ["Ajuste de horário", "Prazo ou atividade", "Atividade do campus"].map((type) => ({
    type,
    title: type,
    start: "2027-03-02",
    end: "2027-03-12",
    affectsSchoolDay: true,
  }));
  assert.equal(rules.countCourseSchoolDays([...tecnico1, ...informational.map((event) => ({ ...event, affectsSchoolDay: false }))], "Técnico", 1).total, 100);
  for (const type of ["Ajuste de horário", "Prazo ou atividade", "Atividade do campus"]) assert.equal(rules.eventTypes[type].informational, true);
});
