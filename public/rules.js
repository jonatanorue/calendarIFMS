// Regras do calendário compartilhadas entre o navegador e o servidor:
// tipos de evento, cursos, semestres e a contagem de dias letivos.
const calendarRules = (() => {
  const allCampusesLabel = "Todos os campi";

  // scope: quem é dono do evento. REITORIA = calendário base; CAMPUS = calendário do campus.
  // addableByReitoria: tipos do campus que a Reitoria também pode incluir para um campus.
  // swap: troca de dia letivo; o dia do evento deixa de ser letivo e o swapDate passa a ser.
  const eventTypes = {
    "Férias Docentes": { color: "#facc15", scope: "REITORIA", alwaysNonSchoolDay: true },
    Planejamento: { color: "#f9a8d4", scope: "REITORIA", alwaysNonSchoolDay: true },
    "Feriado Nacional": { color: "#d1d5db", scope: "REITORIA", alwaysNonSchoolDay: true },
    "Feriado Estadual": { color: "#86efac", scope: "REITORIA", alwaysNonSchoolDay: true },
    "Início/Fim de aulas Técnicas": { color: "#fb923c", scope: "REITORIA" },
    "Início/Fim de aulas Graduação": { color: "#c2410c", scope: "REITORIA" },
    "Feriado Municipal": { color: "#4ade80", scope: "CAMPUS", alwaysNonSchoolDay: true, addableByReitoria: true },
    Recesso: { color: "#60a5fa", scope: "CAMPUS", alwaysNonSchoolDay: true },
    "Sábado Letivo": { color: "#93c5fd", scope: "CAMPUS" },
    "Troca de Dia Letivo": { color: "#bbf7d0", scope: "CAMPUS", swap: true },
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
  const blockingTypes = ["Férias Docentes", "Planejamento", "Feriado Nacional", "Feriado Estadual", "Feriado Municipal", "Recesso"];
  // Nomes antigos de tipos, convertidos ao ler dados gravados antes da mudança.
  const renamedTypes = { "Feriado Estadual/Local": "Feriado Estadual" };
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

  function isSwap(event) {
    return Boolean(eventTypes[event.type]?.swap && event.swapDate);
  }

  // Dias letivos de um curso em um semestre: dias permitidos entre o início e o fim das aulas
  // daquele semestre, menos os eventos que bloqueiam, mais os que contam como dia letivo e,
  // por último, as trocas (o dia original sai e o dia de reposição entra).
  // Também devolve o que cada evento tirou ou acrescentou, para explicar a contagem.
  function countCourseSchoolDays(events, course, semester) {
    const rule = courseRules[course];
    const dates = new Set();
    const removed = [];
    const added = [];
    const { start, end } = semesterBoundaries(events, course, semester);
    if (!start || !end) return { total: 0, base: 0, dates, start, end, removed, added };
    const inSemester = (date) => date >= start && date <= end;
    const remove = (date, event) => {
      if (inSemester(date) && dates.delete(date)) removed.push({ date, event });
    };
    const add = (date, event) => {
      if (inSemester(date) && !dates.has(date)) {
        dates.add(date);
        added.push({ date, event });
      }
    };

    dateRange(start, end).forEach((date) => {
      if (rule.allowedWeekdays.includes(weekday(date))) dates.add(date);
    });
    const base = dates.size;
    events
      .filter((event) => !event.affectsSchoolDay && blockingTypes.includes(event.type) && appliesToCourse(event, course))
      .forEach((event) => dateRange(event.start, event.end).forEach((date) => remove(date, event)));
    events
      .filter((event) => !isSwap(event) && event.affectsSchoolDay && appliesToCourse(event, course))
      .forEach((event) => dateRange(event.start, event.end).forEach((date) => add(date, event)));
    events
      .filter((event) => isSwap(event) && appliesToCourse(event, course))
      .forEach((event) => {
        remove(event.start, event);
        add(event.swapDate, event);
      });

    return { total: dates.size, base, dates, start, end, removed, added };
  }

  function courseSchoolDates(events, course) {
    return new Set(semesters.flatMap((semester) => [...countCourseSchoolDays(events, course, semester).dates]));
  }

  function formatShort(isoDate) {
    return isoDate.split("-").reverse().join("/");
  }

  // Avisos para conferir antes de publicar ou enviar: não bloqueiam, só apontam o que
  // provavelmente está errado. Recebe os eventos já filtrados para o campus.
  function reviewWarnings(events) {
    const warnings = [];
    Object.keys(courseRules).forEach((course) => {
      const bounds = semesters.map((semester) => semesterBoundaries(events, course, semester));
      bounds.forEach((bound, index) => {
        if (!bound.start) warnings.push(`${course} ${semesters[index]}º semestre: falta cadastrar o início e o fim das aulas.`);
        else if (bound.start === bound.end) warnings.push(`${course} ${semesters[index]}º semestre: só há uma data de início/fim (${formatShort(bound.start)}). Cadastre as duas.`);
      });
      if (bounds[0].end && bounds[1].start && bounds[1].start <= bounds[0].end) {
        warnings.push(`${course}: o 2º semestre começa (${formatShort(bounds[1].start)}) antes de terminar o 1º (${formatShort(bounds[0].end)}).`);
      }
    });

    const counts = Object.keys(courseRules).flatMap((course) => semesters.map((semester) => ({ course, ...countCourseSchoolDays(events, course, semester) })));
    events.forEach((event) => {
      const courses = Object.keys(courseRules).filter((course) => appliesToCourse(event, course));
      if (event.type === "Sábado Letivo" && weekday(event.start) !== 6) {
        warnings.push(`"${event.title}" (${formatShort(event.start)}) é um Sábado Letivo que não cai num sábado.`);
      }
      if (isSwap(event)) {
        const relevant = counts.filter((item) => courses.includes(item.course));
        const restored = relevant.filter((item) => item.added.some((entry) => entry.event === event));
        const taken = relevant.filter((item) => item.removed.some((entry) => entry.event === event));
        if (!taken.length) warnings.push(`Troca "${event.title}": ${formatShort(event.start)} já não era dia letivo, então a troca não tira aula.`);
        courses.forEach((course) => {
          if (taken.some((item) => item.course === course) && !restored.some((item) => item.course === course)) {
            warnings.push(`Troca "${event.title}": ${formatShort(event.swapDate)} já é letivo (ou está fora do semestre) no ${course}, então a troca tira um dia dele.`);
          }
        });
        return;
      }
      if (event.affectsSchoolDay) {
        const changed = counts.some((item) => courses.includes(item.course) && item.added.some((entry) => entry.event === event));
        if (!changed) warnings.push(`"${event.title}" (${formatShort(event.start)}) está marcado como dia letivo, mas não altera a contagem (fora dos semestres ou já era letivo).`);
      }
    });

    const seen = new Map();
    events.forEach((event) => {
      const key = `${event.type}|${event.start}|${event.campus || ""}`;
      if (seen.has(key)) warnings.push(`Há mais de um "${event.type}" em ${formatShort(event.start)}: "${seen.get(key)}" e "${event.title}".`);
      else seen.set(key, event.title);
    });
    return warnings;
  }

  // Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher).
  function easterDate(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // Feriados nacionais (e o estadual de MS) de um ano civil, para a Reitoria conferir e incluir.
  function nationalHolidays(year) {
    const easter = easterDate(year);
    const fixed = (monthDay, title, type = "Feriado Nacional") => ({ date: `${year}-${monthDay}`, title, type });
    const movable = (offset, title) => ({ date: addDays(easter, offset), title, type: "Feriado Nacional" });
    return [
      fixed("01-01", "Confraternização Universal"),
      movable(-48, "Carnaval (ponto facultativo)"),
      movable(-47, "Carnaval (ponto facultativo)"),
      movable(-2, "Paixão de Cristo"),
      fixed("04-21", "Tiradentes"),
      fixed("05-01", "Dia do Trabalho"),
      movable(60, "Corpus Christi (ponto facultativo)"),
      fixed("09-07", "Independência do Brasil"),
      fixed("10-11", "Criação do Estado de Mato Grosso do Sul", "Feriado Estadual"),
      fixed("10-12", "Nossa Senhora Aparecida"),
      fixed("11-02", "Finados"),
      fixed("11-15", "Proclamação da República"),
      fixed("11-20", "Dia Nacional de Zumbi e da Consciência Negra"),
      fixed("12-25", "Natal"),
    ].sort((first, second) => first.date.localeCompare(second.date));
  }

  // Feriados que caem dentro de um período (que pode atravessar o ano civil).
  function holidaysInPeriod(start, end) {
    const years = [];
    for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year += 1) years.push(year);
    return years.flatMap(nationalHolidays).filter((holiday) => holiday.date >= start && holiday.date <= end);
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
    renamedTypes,
    isSwap,
    weekday,
    dateRange,
    addDays,
    eventsForCampus,
    semesterBoundaries,
    countCourseSchoolDays,
    courseSchoolDates,
    meetsSchoolDayRules,
    reviewWarnings,
    easterDate,
    nationalHolidays,
    holidaysInPeriod,
  };
})();

if (typeof module !== "undefined") module.exports = calendarRules;
