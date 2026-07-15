const campuses = [
  "Amambai",
  "Aquidauana",
  "Campo Grande",
  "Campo Grande 2",
  "Corumbá",
  "Coxim",
  "Dourados",
  "Jardim",
  "Naviraí",
  "Nova Andradina",
  "Paranaíba",
  "Ponta Porã",
  "Três Lagoas",
];

const academicMonths = [
  { label: "Fevereiro", short: "Fev", year: 2027, month: 1 },
  { label: "Março", short: "Mar", year: 2027, month: 2 },
  { label: "Abril", short: "Abr", year: 2027, month: 3 },
  { label: "Maio", short: "Mai", year: 2027, month: 4 },
  { label: "Junho", short: "Jun", year: 2027, month: 5 },
  { label: "Julho", short: "Jul", year: 2027, month: 6 },
  { label: "Agosto", short: "Ago", year: 2027, month: 7 },
  { label: "Setembro", short: "Set", year: 2027, month: 8 },
  { label: "Outubro", short: "Out", year: 2027, month: 9 },
  { label: "Novembro", short: "Nov", year: 2027, month: 10 },
  { label: "Dezembro", short: "Dez", year: 2027, month: 11 },
  { label: "Janeiro", short: "Jan", year: 2028, month: 0 },
];

const eventTypes = {
  "Férias Docentes": { color: "#facc15", scope: "REITORIA", editableByCampus: false, alwaysNonSchoolDay: true },
  Planejamento: { color: "#f9a8d4", scope: "REITORIA", editableByCampus: false, alwaysNonSchoolDay: true },
  "Feriado Nacional": { color: "#d1d5db", scope: "REITORIA", editableByCampus: false, alwaysNonSchoolDay: true },
  "Feriado Estadual/Local": { color: "#86efac", scope: "REITORIA", editableByCampus: false, alwaysNonSchoolDay: true },
  "Início/Fim de aulas Técnicas": { color: "#fb923c", scope: "REITORIA", editableByCampus: false },
  "Início/Fim de aulas Graduação": { color: "#c2410c", scope: "REITORIA", editableByCampus: false },
  Recesso: { color: "#60a5fa", scope: "CAMPUS", editableByCampus: true, alwaysNonSchoolDay: true },
  "Sábado Letivo": { color: "#93c5fd", scope: "CAMPUS", editableByCampus: true },
  "Troca de Dia Letivo": { color: "#bbf7d0", scope: "CAMPUS", editableByCampus: true },
  "Fechamento de Diários": { color: "#c084fc", scope: "CAMPUS", editableByCampus: true },
  "Entrega de Notas": { color: "#a855f7", scope: "CAMPUS", editableByCampus: true },
};

const storageKey = "calendar-ifms-state-v4";
const today = new Date().toLocaleString("pt-BR");

const semesterLimits = {
  first: { start: "2027-02-01", end: "2027-07-31" },
};

const courseRules = {
  Técnico: {
    boundaryType: "Início/Fim de aulas Técnicas",
    allowedWeekdays: [1, 2, 3, 4, 5],
    requiredDays: 100,
  },
  Graduação: {
    boundaryType: "Início/Fim de aulas Graduação",
    allowedWeekdays: [1, 2, 3, 4, 5, 6],
    requiredDays: 100,
  },
};

const initialState = {
  selectedCampus: "Todos os campi",
  selectedMonthIndex: 0,
  eventFilter: "Todos",
  basePublished: false,
  campusStatus: Object.fromEntries(
    campuses.map((campus, index) => [
      campus,
      {
        status: index % 6 === 0 ? "Rejeitado" : index % 3 === 0 ? "Pendente" : "Em edição",
        submittedAt: index % 3 === 0 ? "10/10/2026" : "",
      },
    ]),
  ),
  events: [
    makeEvent("Planejamento", "Planejamento pedagógico", "2027-02-03", "2027-02-07", "REITORIA", "", false),
    makeEvent("Início/Fim de aulas Técnicas", "Início das aulas técnicas", "2027-02-10", "2027-02-10", "REITORIA", "Técnico", false),
    makeEvent("Início/Fim de aulas Técnicas", "Fim das aulas técnicas", "2027-07-04", "2027-07-04", "REITORIA", "Técnico", false),
    makeEvent("Início/Fim de aulas Graduação", "Início da graduação", "2027-02-17", "2027-02-17", "REITORIA", "Graduação", false),
    makeEvent("Início/Fim de aulas Graduação", "Fim da graduação", "2027-07-05", "2027-07-05", "REITORIA", "Graduação", false),
    makeEvent("Sábado Letivo", "Sábado letivo", "2027-02-22", "2027-02-22", "CAMPUS", "Graduação", true, "Aquidauana"),
  ],
  audit: [
    auditEntry("Sistema", "Calendário inicial criado", "-", "Fevereiro/2027 a Janeiro/2028"),
  ],
};

let state = loadState();

function makeEvent(type, title, start, end, scope, course, affectsSchoolDay, campus = "") {
  const typeConfig = eventTypes[type];
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    type,
    title,
    start,
    end,
    scope,
    course,
    affectsSchoolDay: typeConfig.alwaysNonSchoolDay ? false : affectsSchoolDay,
    campus,
    color: typeConfig.color,
    editableByCampus: typeConfig.editableByCampus,
  };
}

function auditEntry(user, action, oldValue, newValue) {
  return { user, at: today, action, oldValue, newValue };
}

function loadState() {
  const saved = localStorage.getItem(storageKey);
  return saved ? JSON.parse(saved) : structuredClone(initialState);
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function logAudit(action, oldValue, newValue) {
  state.audit.unshift(auditEntry("Usuário Reitoria", action, oldValue, newValue));
  saveState();
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 2600);
}

function selectedCampusEvents() {
  return scopedCampusEvents(true);
}

function scopedCampusEvents(applyEventFilter) {
  return state.events.filter((event) => {
    const campusMatches =
      state.selectedCampus === "Todos os campi" ||
      event.scope === "REITORIA" ||
      event.campus === state.selectedCampus ||
      event.campus === "";
    const typeMatches = !applyEventFilter || state.eventFilter === "Todos" || event.type === state.eventFilter;
    return campusMatches && typeMatches;
  });
}

function isInAcademicPeriod(date) {
  return date >= "2027-02-01" && date <= "2028-01-31";
}

function dateRange(start, end) {
  const dates = [];
  const current = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (current <= last) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function render() {
  renderFilters();
  renderMetrics();
  renderCampusStatus();
  renderValidation();
  renderLegend();
  renderAnnual();
  renderMonthly();
  renderApproval();
  renderAudit();
  document.getElementById("calendarStatus").textContent = state.basePublished ? "Base publicada" : "Base em edição";
}

function renderFilters() {
  const campusFilter = document.getElementById("campusFilter");
  campusFilter.innerHTML = ["Todos os campi", ...campuses].map((campus) => `<option>${campus}</option>`).join("");
  campusFilter.value = state.selectedCampus;

  const eventFilter = document.getElementById("eventFilter");
  eventFilter.innerHTML =
    '<option value="Todos">Todos os eventos</option>' +
    Object.keys(eventTypes).map((type) => `<option value="${type}">${type}</option>`).join("");
  eventFilter.value = state.eventFilter;

  const monthSelector = document.getElementById("monthSelector");
  monthSelector.innerHTML = academicMonths
    .map((month, index) => `<option value="${index}">${month.label} ${month.year}</option>`)
    .join("");
  monthSelector.value = String(state.selectedMonthIndex);
}

function renderMetrics() {
  const statuses = Object.values(state.campusStatus);
  const approved = statuses.filter((item) => item.status === "Aprovado").length;
  const pending = statuses.filter((item) => item.status === "Pendente").length;
  const rejected = statuses.filter((item) => item.status === "Rejeitado").length;
  document.getElementById("metrics").innerHTML = `
    <article><span>${campuses.length}</span><small>Campi monitorados</small></article>
    <article><span>${approved}</span><small>Calendários aprovados</small></article>
    <article><span>${pending}</span><small>Pendentes</small></article>
    <article><span>${rejected}</span><small>Com ajustes</small></article>
  `;
}

function renderCampusStatus() {
  document.getElementById("campusStatus").innerHTML = campuses
    .map((campus) => {
      const status = state.campusStatus[campus].status;
      return `<div class="status-row"><strong>${campus}</strong><span class="tag ${statusClass(status)}">${status}</span></div>`;
    })
    .join("");
}

function renderLegend() {
  document.getElementById("legend").innerHTML = Object.entries(eventTypes)
    .map(([name, config]) => `<span class="legend-item"><span class="swatch" style="background:${config.color}"></span>${name}</span>`)
    .join("");
}

function renderAnnual() {
  const events = selectedCampusEvents();
  document.getElementById("months").innerHTML = academicMonths
    .map((month) => {
      const monthEvents = events.filter((event) => {
        const start = new Date(`${event.start}T00:00:00`);
        return start.getFullYear() === month.year && start.getMonth() === month.month;
      });
      const eventHtml = monthEvents
        .map((event) => `<div class="event ${event.scope.toLowerCase()}" style="background:${event.color}">${event.title}<small>${event.type}</small></div>`)
        .join("");
      return `<article class="month"><strong>${month.short} ${month.year}</strong>${eventHtml || '<p class="empty">Sem eventos</p>'}</article>`;
    })
    .join("");
}

function renderMonthly() {
  const month = academicMonths[state.selectedMonthIndex];
  document.getElementById("monthlyTitle").textContent = `${month.label} ${month.year}`;
  const first = new Date(month.year, month.month, 1);
  const totalDays = new Date(month.year, month.month + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const cells = [];
  const monthStart = `${month.year}-${String(month.month + 1).padStart(2, "0")}-01`;
  const monthEnd = `${month.year}-${String(month.month + 1).padStart(2, "0")}-${String(totalDays).padStart(2, "0")}`;
  const tecnicoDates = countCourseSchoolDays("Técnico", monthStart, monthEnd).dates;
  const graduationDates = countCourseSchoolDays("Graduação", monthStart, monthEnd).dates;
  const monthEvents = selectedCampusEvents().filter((event) => {
    const start = new Date(`${event.start}T00:00:00`);
    return start.getFullYear() === month.year && start.getMonth() === month.month;
  });

  ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].forEach((day) => cells.push(`<div class="weekday">${day}</div>`));
  for (let i = 0; i < offset; i += 1) cells.push('<div class="day muted"></div>');
  for (let day = 1; day <= totalDays; day += 1) {
    const iso = `${month.year}-${String(month.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const eventsHtml = monthEvents
      .filter((event) => dateRange(event.start, event.end).includes(iso))
      .map((event) => eventMarkup(event))
      .join("");
    const tecnico = tecnicoDates.has(iso);
    const graduation = graduationDates.has(iso);
    const schoolDayClass = tecnico || graduation ? "school-day" : "non-school-day";
    const badges = [
      tecnico ? '<span class="day-badge tecnico">T</span>' : "",
      graduation ? '<span class="day-badge graduacao">G</span>' : "",
    ].join("");
    const label = tecnico || graduation ? "Letivo" : "Não letivo";
    cells.push(`<div class="day ${schoolDayClass}" data-date="${iso}">
      <div class="day-head"><strong>${day}</strong><span class="day-kind">${label}</span></div>
      <div class="day-badges">${badges}</div>
      ${eventsHtml}
    </div>`);
  }
  document.getElementById("monthGrid").innerHTML = cells.join("");
  renderMonthTotals(monthEvents);
}

function eventMarkup(event) {
  const draggable = event.editableByCampus ? 'draggable="true"' : "";
  const actionButtons = `<div class="event-actions">
    <button class="event-edit" type="button" data-action="edit-event" data-event-id="${event.id}" title="Editar evento">✎</button>
    <button class="event-remove" type="button" data-action="remove-event" data-event-id="${event.id}" title="Remover evento">×</button>
  </div>`;
  return `<div class="event ${event.scope.toLowerCase()}" ${draggable} data-event-id="${event.id}" style="background:${event.color}">
    <span>${event.title}</span>${actionButtons}<small>${event.scope === "REITORIA" ? "Reitoria" : event.campus || "Campus"}</small>
  </div>`;
}

function renderMonthTotals(monthEvents) {
  const month = academicMonths[state.selectedMonthIndex];
  const monthStart = `${month.year}-${String(month.month + 1).padStart(2, "0")}-01`;
  const monthEnd = `${month.year}-${String(month.month + 1).padStart(2, "0")}-${String(new Date(month.year, month.month + 1, 0).getDate()).padStart(2, "0")}`;
  const tecnicoDays = countCourseSchoolDays("Técnico", monthStart, monthEnd).total;
  const graduationDays = countCourseSchoolDays("Graduação", monthStart, monthEnd).total;
  const localEvents = monthEvents.filter((event) => event.scope === "CAMPUS").length;
  const reitoriaEvents = monthEvents.filter((event) => event.scope === "REITORIA").length;
  document.getElementById("monthTotals").innerHTML = `
    <dt>Dias letivos técnicos</dt><dd>${tecnicoDays}</dd>
    <dt>Dias letivos graduação</dt><dd>${graduationDays}</dd>
    <dt>Eventos da Reitoria</dt><dd>${reitoriaEvents}</dd>
    <dt>Eventos locais</dt><dd>${localEvents}</dd>
    <dt>Legenda</dt><dd><span class="day-badge tecnico">T</span> <span class="day-badge graduacao">G</span></dd>
  `;
}

function renderValidation() {
  const counts = countSchoolDays();
  document.getElementById("validationSummary").innerHTML = [
    validationCard("Técnico - 1º semestre", counts.tecnicoFirst.total, 100, counts.tecnicoFirst.periodLabel),
    validationCard("Graduação - 1º semestre", counts.graduacaoFirst.total, 100, counts.graduacaoFirst.periodLabel),
    weekdayCard("Distribuição semanal", counts.weekdays),
  ].join("");
}

function validationCard(title, actual, required, detail = "") {
  const diff = actual - required;
  const width = Math.min(100, Math.round((actual / required) * 100));
  const text = diff === 0 ? "Regra atendida." : diff < 0 ? `Faltam ${Math.abs(diff)} dias.` : `Excede ${diff} dias.`;
  return `<div class="validation-card">
    <strong>${title}</strong>
    <div class="bar ${diff === 0 ? "" : "warning"}"><span style="width:${width}%"></span></div>
    <p>${actual}/${required} dias letivos. ${text}</p>
    ${detail ? `<p>${detail}</p>` : ""}
  </div>`;
}

function weekdayCard(title, weekdays) {
  return `<div class="validation-card">
    <strong>${title}</strong>
    <p>Seg ${weekdays[1]} · Ter ${weekdays[2]} · Qua ${weekdays[3]} · Qui ${weekdays[4]} · Sex ${weekdays[5]} · Sáb ${weekdays[6]}</p>
  </div>`;
}

function countSchoolDays() {
  const tecnicoFirst = countCourseSchoolDays("Técnico", semesterLimits.first.start, semesterLimits.first.end);
  const graduacaoFirst = countCourseSchoolDays("Graduação", semesterLimits.first.start, semesterLimits.first.end);
  const weekdayDates = new Set([...tecnicoFirst.dates, ...graduacaoFirst.dates]);
  const counts = { tecnicoFirst, graduacaoFirst, weekdays: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } };
  weekdayDates.forEach((date) => {
    const weekday = new Date(`${date}T00:00:00`).getDay();
    if (weekday >= 1 && weekday <= 6) counts.weekdays[weekday] += 1;
  });
  return counts;
}

function countCourseSchoolDays(course, limitStart, limitEnd) {
  const rule = courseRules[course];
  const countedDates = new Set();
  const boundaries = getCourseBoundaries(course);
  const periodStart = maxDate(boundaries.start, limitStart);
  const periodEnd = minDate(boundaries.end, limitEnd);

  if (periodStart && periodEnd && periodEnd >= periodStart) {
    dateRange(periodStart, periodEnd).forEach((date) => {
      const weekday = new Date(`${date}T00:00:00`).getDay();
      if (rule.allowedWeekdays.includes(weekday)) countedDates.add(date);
    });
  }

  scopedCampusEvents(false)
    .filter((event) => !event.affectsSchoolDay && isBlockingSchoolDayEvent(event, course))
    .forEach((event) => {
      dateRange(event.start, event.end).forEach((date) => {
        if (date >= limitStart && date <= limitEnd) countedDates.delete(date);
      });
    });

  scopedCampusEvents(false)
    .filter((event) => event.affectsSchoolDay && appliesToCourse(event, course))
    .forEach((event) => {
      dateRange(event.start, event.end).forEach((date) => {
        if (date >= limitStart && date <= limitEnd) countedDates.add(date);
      });
    });

  return {
    total: countedDates.size,
    dates: countedDates,
    periodLabel:
      boundaries.start && boundaries.end
        ? `Período analisado: ${formatDate(periodStart)} a ${formatDate(periodEnd)}.`
        : `Cadastre início e fim das aulas de ${course.toLowerCase()} para fechar a contagem.`,
  };
}

function appliesToCourse(event, course) {
  return !event.course || event.course === course;
}

function isBlockingSchoolDayEvent(event, course) {
  const blockingTypes = [
    "Férias Docentes",
    "Planejamento",
    "Feriado Nacional",
    "Feriado Estadual/Local",
    "Recesso",
  ];
  return blockingTypes.includes(event.type) && appliesToCourse(event, course);
}

function getCourseBoundaries(course) {
  const boundaryType = courseRules[course].boundaryType;
  const boundaryDates = scopedCampusEvents(false)
    .filter((event) => event.type === boundaryType && (!event.course || event.course === course))
    .flatMap((event) => [event.start, event.end])
    .sort();

  return {
    start: boundaryDates[0] || null,
    end: boundaryDates[boundaryDates.length - 1] || null,
  };
}

function maxDate(firstDate, secondDate) {
  if (!firstDate) return secondDate;
  if (!secondDate) return firstDate;
  return firstDate > secondDate ? firstDate : secondDate;
}

function minDate(firstDate, secondDate) {
  if (!firstDate) return secondDate;
  if (!secondDate) return firstDate;
  return firstDate < secondDate ? firstDate : secondDate;
}

function formatDate(date) {
  return date.split("-").reverse().join("/");
}

function renderApproval() {
  document.getElementById("approvalRows").innerHTML = campuses
    .map((campus) => {
      const item = state.campusStatus[campus];
      return `<tr>
        <td>${campus}</td>
        <td>2027/2028</td>
        <td><span class="tag ${statusClass(item.status)}">${item.status}</span></td>
        <td>${item.submittedAt || "-"}</td>
        <td><button data-action="select-campus" data-campus="${campus}">Selecionar</button></td>
      </tr>`;
    })
    .join("");
}

function renderAudit() {
  document.getElementById("auditRows").innerHTML = state.audit
    .map((entry) => `<tr><td>${entry.user}</td><td>${entry.at}</td><td>${entry.action}</td><td>${entry.oldValue}</td><td>${entry.newValue}</td></tr>`)
    .join("");
}

function statusClass(status) {
  if (status === "Aprovado") return "approved";
  if (status === "Rejeitado") return "rejected";
  if (status === "Base publicada") return "approved";
  return "pending";
}

function openEventDialog(scope) {
  const dialog = document.getElementById("eventDialog");
  const typeSelect = document.getElementById("eventType");
  const allowedTypes = Object.entries(eventTypes).filter(([, config]) => config.scope === scope);
  typeSelect.innerHTML = allowedTypes.map(([type]) => `<option value="${type}">${type}</option>`).join("");
  document.getElementById("editingEventId").value = "";
  document.getElementById("eventScope").value = scope;
  document.getElementById("eventDialogTitle").textContent = scope === "REITORIA" ? "Incluir evento da Reitoria" : "Novo evento local";
  document.getElementById("eventTitle").value = "";
  document.getElementById("eventStart").value = "2027-02-01";
  document.getElementById("eventEnd").value = "2027-02-01";
  document.querySelector('input[name="eventDateMode"][value="single"]').checked = true;
  updateDateMode();
  document.getElementById("eventCourse").value = "";
  document.getElementById("eventAffectsSchoolDay").checked = false;
  updateSchoolDayCheckbox();
  dialog.showModal();
}

function openEditEventDialog(eventId) {
  const event = state.events.find((item) => item.id === eventId);
  if (!event) return;
  const dialog = document.getElementById("eventDialog");
  const typeSelect = document.getElementById("eventType");
  const allowedTypes = Object.entries(eventTypes).filter(([, config]) => config.scope === event.scope);
  typeSelect.innerHTML = allowedTypes.map(([type]) => `<option value="${type}">${type}</option>`).join("");
  document.getElementById("editingEventId").value = event.id;
  document.getElementById("eventScope").value = event.scope;
  document.getElementById("eventDialogTitle").textContent = "Editar evento";
  document.getElementById("eventType").value = event.type;
  document.getElementById("eventTitle").value = event.title;
  document.getElementById("eventStart").value = event.start;
  document.getElementById("eventEnd").value = event.end;
  document.querySelector(`input[name="eventDateMode"][value="${event.start === event.end ? "single" : "range"}"]`).checked = true;
  updateDateMode();
  document.getElementById("eventCourse").value = event.course;
  document.getElementById("eventAffectsSchoolDay").checked = event.affectsSchoolDay;
  updateSchoolDayCheckbox();
  dialog.showModal();
}

function addEventFromForm(event) {
  event.preventDefault();
  const scope = document.getElementById("eventScope").value;
  const editingEventId = document.getElementById("editingEventId").value;
  const type = document.getElementById("eventType").value;
  const title = document.getElementById("eventTitle").value.trim();
  const start = document.getElementById("eventStart").value;
  const dateMode = document.querySelector('input[name="eventDateMode"]:checked').value;
  const end = dateMode === "single" ? start : document.getElementById("eventEnd").value;
  if (end < start || !isInAcademicPeriod(start) || !isInAcademicPeriod(end)) {
    showToast("Verifique as datas dentro do período acadêmico.");
    return;
  }
  const affectsSchoolDay = eventTypes[type].alwaysNonSchoolDay ? false : document.getElementById("eventAffectsSchoolDay").checked;
  const campus = scope === "CAMPUS" && state.selectedCampus !== "Todos os campi" ? state.selectedCampus : "";
  if (editingEventId) {
    const existingEvent = state.events.find((item) => item.id === editingEventId);
    if (!existingEvent) return;
    const oldValue = `${existingEvent.title} (${existingEvent.start} a ${existingEvent.end})`;
    Object.assign(existingEvent, makeEvent(
      type,
      title,
      start,
      end,
      scope,
      document.getElementById("eventCourse").value,
      affectsSchoolDay,
      existingEvent.campus || campus,
    ));
    existingEvent.id = editingEventId;
    logAudit("Evento editado pela Reitoria", oldValue, `${existingEvent.title} (${existingEvent.start} a ${existingEvent.end})`);
    saveState();
    document.getElementById("eventDialog").close();
    render();
    showToast("Evento atualizado e contagem recalculada.");
    return;
  }
  const newEvent = makeEvent(
    type,
    title,
    start,
    end,
    scope,
    document.getElementById("eventCourse").value,
    affectsSchoolDay,
    campus,
  );
  state.events.push(newEvent);
  logAudit("Evento incluído", "-", `${newEvent.title} (${newEvent.start})`);
  saveState();
  document.getElementById("eventDialog").close();
  render();
  showToast("Evento incluído e contagem recalculada.");
}

function removeEvent(eventId) {
  const eventIndex = state.events.findIndex((item) => item.id === eventId);
  if (eventIndex === -1) return;
  const event = state.events[eventIndex];
  state.events.splice(eventIndex, 1);
  logAudit("Evento removido pela Reitoria", `${event.title} (${event.start})`, "-");
  saveState();
  render();
  showToast("Evento removido e contagem recalculada.");
}

function moveEvent(eventId, newDate) {
  const event = state.events.find((item) => item.id === eventId);
  if (!event) return;
  if (!event.editableByCampus) {
    showToast("Eventos da Reitoria não podem ser movidos pelo campus.");
    return;
  }
  const oldDate = event.start;
  const duration = dateRange(event.start, event.end).length - 1;
  const nextEnd = new Date(`${newDate}T00:00:00`);
  nextEnd.setDate(nextEnd.getDate() + duration);
  event.start = newDate;
  event.end = nextEnd.toISOString().slice(0, 10);
  logAudit("Evento movido", oldDate, event.start);
  saveState();
  render();
  showToast("Evento movido e contagem recalculada.");
}

function validateBeforeSubmit() {
  const counts = countSchoolDays();
  return counts.tecnicoFirst.total === 100 && counts.graduacaoFirst.total === 100;
}

document.addEventListener("click", (event) => {
  const action = event.target.dataset.action;
  if (!action) return;
  if (action === "remove-event") {
    removeEvent(event.target.dataset.eventId);
    return;
  }
  if (action === "edit-event") {
    openEditEventDialog(event.target.dataset.eventId);
    return;
  }

  if (action === "open-reitoria-event") openEventDialog("REITORIA");
  if (action === "open-campus-event") openEventDialog("CAMPUS");
  if (action === "close-dialog") document.getElementById("eventDialog").close();
  if (action === "publish-base") {
    state.basePublished = true;
    logAudit("Calendário base publicado", "Em edição", "Base publicada");
    render();
    showToast("Calendário base publicado.");
  }
  if (action === "submit") {
    if (!validateBeforeSubmit()) {
      showToast("Publicação bloqueada: regras acadêmicas ainda não foram atendidas.");
      return;
    }
    const campus = state.selectedCampus === "Todos os campi" ? "Aquidauana" : state.selectedCampus;
    state.campusStatus[campus].status = "Pendente";
    state.campusStatus[campus].submittedAt = new Date().toLocaleDateString("pt-BR");
    logAudit("Calendário enviado para aprovação", "-", campus);
    saveState();
    render();
  }
  if (action === "select-campus") {
    state.selectedCampus = event.target.dataset.campus;
    saveState();
    render();
    showToast(`${state.selectedCampus} selecionado.`);
  }
  if (action === "approve" || action === "reject") {
    const campus = state.selectedCampus === "Todos os campi" ? "Aquidauana" : state.selectedCampus;
    const status = action === "approve" ? "Aprovado" : "Rejeitado";
    const old = state.campusStatus[campus].status;
    state.campusStatus[campus].status = status;
    logAudit("Status alterado", old, `${campus}: ${status}`);
    saveState();
    render();
  }
  if (action === "duplicate") {
    logAudit("Calendário duplicado", "2026/2027", "2027/2028");
    showToast("Calendário anterior duplicado para simulação.");
    render();
  }
  if (action === "simulate" || action === "validate") {
    renderValidation();
    showToast("Validações recalculadas.");
  }
  if (action === "print") window.print();
  if (action === "excel") {
    document.getElementById("reportOutput").textContent = ["Campus,Tipo,Título,Início,Fim,Escopo"]
      .concat(state.events.map((item) => `${item.campus || "Todos"},${item.type},${item.title},${item.start},${item.end},${item.scope}`))
      .join("\n");
  }
  if (action === "compare") {
    document.getElementById("reportOutput").textContent = campuses
      .map((campus) => `${campus}: ${state.campusStatus[campus].status}`)
      .join("\n");
  }
});

document.getElementById("eventForm").addEventListener("submit", addEventFromForm);
document.getElementById("campusFilter").addEventListener("change", (event) => {
  state.selectedCampus = event.target.value;
  saveState();
  render();
});
document.getElementById("eventFilter").addEventListener("change", (event) => {
  state.eventFilter = event.target.value;
  saveState();
  render();
});
document.getElementById("monthSelector").addEventListener("change", (event) => {
  state.selectedMonthIndex = Number(event.target.value);
  saveState();
  render();
});
document.querySelectorAll('input[name="eventDateMode"]').forEach((input) => {
  input.addEventListener("change", updateDateMode);
});
document.getElementById("eventType").addEventListener("change", updateSchoolDayCheckbox);
document.getElementById("eventStart").addEventListener("change", () => {
  if (document.querySelector('input[name="eventDateMode"]:checked').value === "single") {
    document.getElementById("eventEnd").value = document.getElementById("eventStart").value;
  }
});
document.querySelectorAll("nav button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
    button.classList.add("active");
    document.getElementById(button.dataset.view).classList.add("active");
  });
});
document.addEventListener("dragstart", (event) => {
  if (event.target.closest("button")) {
    event.preventDefault();
    return;
  }
  if (event.target.dataset.eventId) event.dataTransfer.setData("text/plain", event.target.dataset.eventId);
});
document.addEventListener("dragover", (event) => {
  if (event.target.closest(".day[data-date]")) event.preventDefault();
});
document.addEventListener("drop", (event) => {
  const day = event.target.closest(".day[data-date]");
  if (!day) return;
  event.preventDefault();
  moveEvent(event.dataTransfer.getData("text/plain"), day.dataset.date);
});

render();

function updateDateMode() {
  const mode = document.querySelector('input[name="eventDateMode"]:checked').value;
  const endField = document.getElementById("eventEndField");
  const endInput = document.getElementById("eventEnd");
  const startInput = document.getElementById("eventStart");
  document.getElementById("eventStartLabel").textContent = mode === "single" ? "Data" : "Início";
  endField.hidden = mode === "single";
  endInput.required = mode === "range";
  if (mode === "single") endInput.value = startInput.value;
}

function updateSchoolDayCheckbox() {
  const type = document.getElementById("eventType").value;
  const checkbox = document.getElementById("eventAffectsSchoolDay");
  const disabled = Boolean(eventTypes[type]?.alwaysNonSchoolDay);
  checkbox.disabled = disabled;
  if (disabled) checkbox.checked = false;
}
