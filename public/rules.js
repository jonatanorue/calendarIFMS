// Regras do calendário compartilhadas entre o navegador e o servidor:
// tipos de evento, cursos, semestres e a contagem de dias letivos.
const calendarRules = (() => {
  const allCampusesLabel = "Todos os campi";

  // scope: quem é dono do evento. REITORIA = calendário base; CAMPUS = calendário do campus.
  // addableByReitoria: tipos do campus que a Reitoria também pode incluir para um campus.
  const eventTypes = {
    "Férias Docentes": { color: "#facc15", scope: "REITORIA", alwaysNonSchoolDay: true },
    Planejamento: { color: "#f9a8d4", scope: "REITORIA", alwaysNonSchoolDay: true },
    "Feriado Nacional": { color: "#d1d5db", scope: "REITORIA", alwaysNonSchoolDay: true },
    "Feriado Estadual/Local": { color: "#86efac", scope: "REITORIA", alwaysNonSchoolDay: true },
    "Início/Fim de aulas Técnicas": { color: "#fb923c", scope: "REITORIA" },
    "Início/Fim de aulas Graduação": { color: "#c2410c", scope: "REITORIA" },
    "Feriado Municipal": { color: "#4ade80", scope: "CAMPUS", alwaysNonSchoolDay: true, addableByReitoria: true },
    Recesso: { color: "#60a5fa", scope: "CAMPUS", alwaysNonSchoolDay: true },
    "Sábado Letivo": { color: "#93c5fd", scope: "CAMPUS" },
    "Troca de Dia Letivo": { color: "#bbf7d0", scope: "CAMPUS" },
    "Fechamento de Diários": { color: "#c084fc", scope: "CAMPUS" },
    "Entrega de Notas": { color: "#a855f7", scope: "CAMPUS" },
  };

  const courseRules = {
    Técnico: {
      boundaryType: "Início/Fim de aulas Técnicas",
      allowedWeekdays: [1, 2, 3, 4, 5],
      requiredDaysPerSemester: 100,
    },
    Graduação: {
      boundaryType: "Início/Fim de aulas Graduação",
      allowedWeekdays: [1, 2, 3, 4, 5, 6],
      requiredDaysPerSemester: 100,
    },
  };

  const semesters = [1, 2];
  const boundaryTypes = Object.values(courseRules).map((rule) => rule.boundaryType);
  const blockingTypes = ["Férias Docentes", "Planejamento", "Feriado Nacional", "Feriado Estadual/Local", "Feriado Municipal", "Recesso"];
  const editableStatuses = ["Em edição", "Rejeitado"];

  // Datas em UTC para dar o mesmo resultado no navegador e no servidor, em qualquer fuso.
  function weekday(isoDate) {
    return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  }

  function dateRange(start, end) {
    const dates = [];
    const current = new Date(`${start}T00:00:00Z`);
    const last = new Date(`${end}T00:00:00Z`);
    while (current <= last) {
      dates.push(current.toISOString().slice(0, 10));
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return dates;
  }

  function addDays(isoDate, days) {
    const date = new Date(`${isoDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  // Eventos que valem para um campus: os de todos os campi e os daquele campus.
  function eventsForCampus(events, campus) {
    if (!campus || campus === allCampusesLabel) return events;
    return events.filter((event) => !event.campus || event.campus === campus);
  }

  function appliesToCourse(event, course) {
    return !event.course || event.course === course;
  }

  function semesterBoundaries(events, course, semester) {
    const boundaryType = courseRules[course].boundaryType;
    const dates = events
      .filter((event) => event.type === boundaryType && appliesToCourse(event, course) && (event.semester || 1) === semester)
      .flatMap((event) => [event.start, event.end])
      .sort();
    return { start: dates[0] || null, end: dates[dates.length - 1] || null };
  }

  // Dias letivos de um curso em um semestre: dias permitidos entre o início e o fim das aulas
  // daquele semestre, menos os eventos que bloqueiam e mais os que contam como dia letivo.
  function countCourseSchoolDays(events, course, semester) {
    const rule = courseRules[course];
    const dates = new Set();
    const { start, end } = semesterBoundaries(events, course, semester);
    if (!start || !end) return { total: 0, dates, start, end };
    const inSemester = (date) => date >= start && date <= end;

    dateRange(start, end).forEach((date) => {
      if (rule.allowedWeekdays.includes(weekday(date))) dates.add(date);
    });
    events
      .filter((event) => !event.affectsSchoolDay && blockingTypes.includes(event.type) && appliesToCourse(event, course))
      .forEach((event) => dateRange(event.start, event.end).filter(inSemester).forEach((date) => dates.delete(date)));
    events
      .filter((event) => event.affectsSchoolDay && appliesToCourse(event, course))
      .forEach((event) => dateRange(event.start, event.end).filter(inSemester).forEach((date) => dates.add(date)));

    return { total: dates.size, dates, start, end };
  }

  function courseSchoolDates(events, course) {
    return new Set(semesters.flatMap((semester) => [...countCourseSchoolDays(events, course, semester).dates]));
  }

  // Exatamente o número exigido de dias letivos em cada semestre de cada curso.
  function meetsSchoolDayRules(events) {
    return Object.keys(courseRules).every((course) =>
      semesters.every((semester) => countCourseSchoolDays(events, course, semester).total === courseRules[course].requiredDaysPerSemester),
    );
  }

  return {
    allCampusesLabel,
    eventTypes,
    courseRules,
    semesters,
    boundaryTypes,
    editableStatuses,
    weekday,
    dateRange,
    addDays,
    eventsForCampus,
    semesterBoundaries,
    countCourseSchoolDays,
    courseSchoolDates,
    meetsSchoolDayRules,
  };
})();

if (typeof module !== "undefined") module.exports = calendarRules;
