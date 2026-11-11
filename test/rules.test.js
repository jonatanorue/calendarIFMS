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
