// A lista de campi vem de /campuses.js, compartilhada com o servidor.
const allCampuses = "Todos os campi";

const monthNames = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
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

const roles = {
  REITORIA: {
    label: "Reitoria",
    permissions: ["init-calendar", "publish-base", "reitoria-events", "edit-any-event", "approve-calendar", "view-all-campi", "view-audit"],
  },
  CAMPUS: {
    label: "Campus",
    permissions: ["campus-events", "submit-calendar"],
  },
  ADMIN: {
    label: "Administrador (TI)",
    permissions: [
      "init-calendar",
      "publish-base",
      "reitoria-events",
      "campus-events",
      "submit-calendar",
      "edit-any-event",
      "approve-calendar",
      "view-all-campi",
      "view-audit",
      "manage-admin",
    ],
  },
};

const storageKey = "calendar-ifms-state-v4";
const today = new Date().toLocaleString("pt-BR");

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
  role: "REITORIA",
  userCampus: campuses[0],
  calendar: { start: "2027-02-01", end: "2028-01-31" },
  selectedCampus: allCampuses,
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
    auditEntry("Sistema", "Calendário inicial criado", "-", "01/02/2027 a 31/01/2028"),
  ],
};

let state = loadState();
let currentUser = null;
let users = [];

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
  return saved ? { ...structuredClone(initialState), ...JSON.parse(saved) } : structuredClone(initialState);
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function logAudit(action, oldValue, newValue) {
  state.audit.unshift(auditEntry(currentUser.email, action, oldValue, newValue));
  saveState();
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 2600);
}

function can(permission) {
  return roles[state.role].permissions.includes(permission);
}

function currentCampus() {
  return state.role === "CAMPUS" ? state.userCampus : state.selectedCampus;
}

function visibleCampuses() {
  return state.role === "CAMPUS" ? [state.userCampus] : campuses;
}

function campusCanEdit(campus) {
  return state.basePublished && ["Em edição", "Rejeitado"].includes(state.campusStatus[campus].status);
}

function canEditEvent(event) {
  if (can("edit-any-event")) return true;
  return event.scope === "CAMPUS" && event.campus === state.userCampus && campusCanEdit(state.userCampus);
}

function selectedCampusEvents() {
  return scopedCampusEvents(true);
}

function scopedCampusEvents(applyEventFilter) {
  const campus = currentCampus();
  return state.events.filter((event) => {
    const campusMatches = campus === allCampuses || event.campus === "" || event.campus === campus;
    const typeMatches = !applyEventFilter || state.eventFilter === "Todos" || event.type === state.eventFilter;
    return campusMatches && typeMatches;
  });
}

function getAcademicMonths() {
  const months = [];
  const current = new Date(`${state.calendar.start.slice(0, 7)}-01T00:00:00`);
  const last = new Date(`${state.calendar.end.slice(0, 7)}-01T00:00:00`);
  while (current <= last) {
    const label = monthNames[current.getMonth()];
    months.push({ label, short: label.slice(0, 3), year: current.getFullYear(), month: current.getMonth() });
    current.setMonth(current.getMonth() + 1);
  }
  return months;
}

function academicYearLabel() {
  const startYear = state.calendar.start.slice(0, 4);
  const endYear = state.calendar.end.slice(0, 4);
  return startYear === endYear ? startYear : `${startYear}/${endYear}`;
}

function firstSemesterLimits() {
  const { start, end } = state.calendar;
  const julyEnd = `${start.slice(0, 4)}-07-31`;
  return { start, end: julyEnd >= start ? minDate(julyEnd, end) : end };
}

function isInAcademicPeriod(date) {
  return date >= state.calendar.start && date <= state.calendar.end;
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
  if (state.selectedMonthIndex >= getAcademicMonths().length) state.selectedMonthIndex = 0;
  renderHeader();
  applyPermissions();
  renderFilters();
  renderMetrics();
  renderCampusStatus();
  renderValidation();
  renderLegend();
  renderAnnual();
  renderMonthly();
  renderApproval();
  renderAudit();
  renderUsers();
  const calendarStatus = document.getElementById("calendarStatus");
  calendarStatus.textContent = state.basePublished ? "Base publicada" : "Base em edição";
  calendarStatus.className = `tag ${state.basePublished ? "approved" : "pending"}`;
}

function renderHeader() {
  document.getElementById("roleLabel").textContent =
    state.role === "CAMPUS" ? `Campus ${state.userCampus}` : roles[state.role].label;
  document.getElementById("periodLabel").textContent =
    `Período letivo: ${formatDate(state.calendar.start)} a ${formatDate(state.calendar.end)}`;
  document.getElementById("annualTitle").textContent = `Calendário acadêmico ${academicYearLabel()}`;
  document.getElementById("userBadge").textContent = currentUser.email;
  document.getElementById("monthHint").textContent =
    state.role === "CAMPUS"
      ? "Eventos da Reitoria são bloqueados. Seus eventos locais podem ser editados e arrastados enquanto o calendário do campus estiver em edição ou rejeitado. Dê dois cliques em um dia para incluir um evento ou em um evento para editá-lo."
      : "Você pode editar, remover e arrastar eventos da Reitoria e dos campi. Dê dois cliques em um dia para incluir um evento ou em um evento para editá-lo.";
}

function applyPermissions() {
  document.querySelectorAll("[data-permission]").forEach((element) => {
    element.hidden = !can(element.dataset.permission);
  });
  const activeNav = document.querySelector("nav button.active");
  if (activeNav?.hidden) showView("dashboard");
}

function showView(viewId) {
  document.querySelectorAll("nav button").forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
}

function renderFilters() {
  const campusFilter = document.getElementById("campusFilter");
  const campusOptions = state.role === "CAMPUS" ? [state.userCampus] : [allCampuses, ...campuses];
  campusFilter.innerHTML = campusOptions.map((campus) => `<option>${campus}</option>`).join("");
  campusFilter.value = currentCampus();
  campusFilter.disabled = state.role === "CAMPUS";

  const eventFilter = document.getElementById("eventFilter");
  eventFilter.innerHTML =
    '<option value="Todos">Todos os eventos</option>' +
    Object.keys(eventTypes).map((type) => `<option value="${type}">${type}</option>`).join("");
  eventFilter.value = state.eventFilter;

  const monthSelector = document.getElementById("monthSelector");
  monthSelector.innerHTML = getAcademicMonths()
    .map((month, index) => `<option value="${index}">${month.label} ${month.year}</option>`)
    .join("");
  monthSelector.value = String(state.selectedMonthIndex);
}

function renderMetrics() {
  const shown = visibleCampuses();
  const statuses = shown.map((campus) => state.campusStatus[campus]);
  const approved = statuses.filter((item) => item.status === "Aprovado").length;
  const pending = statuses.filter((item) => item.status === "Pendente").length;
  const rejected = statuses.filter((item) => item.status === "Rejeitado").length;
  document.getElementById("metrics").innerHTML = `
    <article><span>${shown.length}</span><small>Campi monitorados</small></article>
    <article><span>${approved}</span><small>Calendários aprovados</small></article>
    <article><span>${pending}</span><small>Pendentes</small></article>
    <article><span>${rejected}</span><small>Com ajustes</small></article>
  `;
}

function renderCampusStatus() {
  document.getElementById("campusStatus").innerHTML = visibleCampuses()
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
  document.getElementById("months").innerHTML = getAcademicMonths()
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
  const month = getAcademicMonths()[state.selectedMonthIndex];
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
    if (!isInAcademicPeriod(iso)) {
      cells.push(`<div class="day muted"><div class="day-head"><strong>${day}</strong><span class="day-kind">Fora do período</span></div></div>`);
      continue;
    }
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
  const editable = canEditEvent(event);
  const draggable = editable ? 'draggable="true"' : "";
  const actionButtons = editable
    ? `<div class="event-actions">
    <button class="event-edit" type="button" data-action="edit-event" data-event-id="${event.id}" title="Editar evento">✎</button>
    <button class="event-remove" type="button" data-action="remove-event" data-event-id="${event.id}" title="Remover evento">×</button>
  </div>`
    : "";
  const origin = event.scope === "REITORIA" ? `Reitoria${event.campus ? ` · ${event.campus}` : ""}` : event.campus || "Campus";
  return `<div class="event ${event.scope.toLowerCase()}" ${draggable} data-event-id="${event.id}" style="background:${event.color}">
    <span>${event.title}</span>${actionButtons}<small>${origin}</small>
  </div>`;
}

function renderMonthTotals(monthEvents) {
  const month = getAcademicMonths()[state.selectedMonthIndex];
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
  const semester = firstSemesterLimits();
  const tecnicoFirst = countCourseSchoolDays("Técnico", semester.start, semester.end);
  const graduacaoFirst = countCourseSchoolDays("Graduação", semester.start, semester.end);
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
  const canSelect = can("approve-calendar");
  document.getElementById("approvalRows").innerHTML = visibleCampuses()
    .map((campus) => {
      const item = state.campusStatus[campus];
      return `<tr>
        <td>${campus}</td>
        <td>${academicYearLabel()}</td>
        <td><span class="tag ${statusClass(item.status)}">${item.status}</span></td>
        <td>${item.submittedAt || "-"}</td>
        <td>${canSelect ? `<button data-action="select-campus" data-campus="${campus}">Selecionar</button>` : "-"}</td>
      </tr>`;
    })
    .join("");
}

function renderAudit() {
  document.getElementById("auditRows").innerHTML = state.audit
    .map((entry) => `<tr><td>${entry.user}</td><td>${entry.at}</td><td>${entry.action}</td><td>${entry.oldValue}</td><td>${entry.newValue}</td></tr>`)
    .join("");
}

function renderUsers() {
  const userCampus = document.getElementById("userCampus");
  if (!userCampus.options.length) {
    userCampus.innerHTML = '<option value="">Selecione o campus</option>' + campuses.map((campus) => `<option>${campus}</option>`).join("");
  }
  document.getElementById("userRows").innerHTML = users
    .map((user) => `<tr>
      <td>${user.email}</td>
      <td>${roles[user.role].label}</td>
      <td>${user.campus || "-"}</td>
      <td>${formatDateTime(user.createdAt)}</td>
      <td>${user.createdBy}</td>
      <td><div class="actions">
        <button data-action="edit-user" data-email="${user.email}">Editar</button>
        <button data-action="remove-user" data-email="${user.email}">Remover</button>
      </div></td>
    </tr>`)
    .join("") || '<tr><td colspan="6" class="empty">Nenhum usuário cadastrado.</td></tr>';
}

function formatDateTime(sqliteDate) {
  return new Date(`${sqliteDate.replace(" ", "T")}Z`).toLocaleString("pt-BR");
}

async function loadUsers() {
  try {
    users = await api("/api/users");
    renderUsers();
  } catch (error) {
    showToast(error.message);
  }
}

function updateUserCampusField() {
  const isCampus = document.getElementById("userRole").value === "CAMPUS";
  const select = document.getElementById("userCampus");
  document.getElementById("userCampusField").hidden = !isCampus;
  select.required = isCampus;
  if (!isCampus) select.value = "";
}

function resetUserForm() {
  document.getElementById("userForm").reset();
  document.getElementById("editingUserEmail").value = "";
  document.getElementById("saveUserButton").textContent = "Adicionar usuário";
  document.getElementById("cancelUserEdit").hidden = true;
  updateUserCampusField();
}

function editUser(email) {
  const user = users.find((item) => item.email === email);
  if (!user) return;
  document.getElementById("editingUserEmail").value = user.email;
  document.getElementById("userEmail").value = user.email;
  document.getElementById("userRole").value = user.role;
  updateUserCampusField();
  document.getElementById("userCampus").value = user.campus || "";
  document.getElementById("saveUserButton").textContent = "Salvar alterações";
  document.getElementById("cancelUserEdit").hidden = false;
  document.getElementById("userEmail").focus();
}

function userLabel(user) {
  return `${user.email} · ${roles[user.role].label}${user.campus ? ` (${user.campus})` : ""}`;
}

async function saveUserFromForm(event) {
  event.preventDefault();
  if (!can("manage-admin")) return;
  const editingEmail = document.getElementById("editingUserEmail").value;
  const role = document.getElementById("userRole").value;
  const body = {
    email: document.getElementById("userEmail").value,
    role,
    campus: role === "CAMPUS" ? document.getElementById("userCampus").value : null,
  };
  try {
    if (editingEmail) {
      const oldUser = users.find((item) => item.email === editingEmail);
      const user = await api(`/api/users/${encodeURIComponent(editingEmail)}`, { method: "PUT", body });
      logAudit("Usuário alterado", userLabel(oldUser), userLabel(user));
      showToast("Usuário atualizado.");
    } else {
      const user = await api("/api/users", { method: "POST", body });
      logAudit("Usuário cadastrado", "-", userLabel(user));
      showToast("Usuário cadastrado.");
    }
  } catch (error) {
    showToast(error.message);
    return;
  }
  resetUserForm();
  if (editingEmail === currentUser.email) {
    applyUser(await api("/api/me"));
    if (!can("manage-admin")) return;
  }
  await loadUsers();
  render();
}

async function removeUser(email) {
  const user = users.find((item) => item.email === email);
  if (!user) return;
  if (!confirm(`Remover o acesso de ${email}?`)) return;
  try {
    await api(`/api/users/${encodeURIComponent(email)}`, { method: "DELETE", body: {} });
  } catch (error) {
    showToast(error.message);
    return;
  }
  logAudit("Usuário removido", userLabel(user), "-");
  if (document.getElementById("editingUserEmail").value === email) resetUserForm();
  if (email === currentUser.email) {
    showLogin("Seu acesso foi removido.");
    return;
  }
  await loadUsers();
  render();
  showToast("Usuário removido.");
}

function statusClass(status) {
  if (status === "Aprovado") return "approved";
  if (status === "Rejeitado") return "rejected";
  if (status === "Base publicada") return "approved";
  return "pending";
}

function setEventDateBounds() {
  ["eventStart", "eventEnd"].forEach((id) => {
    const input = document.getElementById(id);
    input.min = state.calendar.start;
    input.max = state.calendar.end;
  });
}

function fillEventCampusField(scope, value) {
  const field = document.getElementById("eventCampusField");
  field.hidden = state.role === "CAMPUS";
  if (field.hidden) return;
  const options = scope === "REITORIA" ? [["", allCampuses], ...campuses.map((campus) => [campus, campus])] : campuses.map((campus) => [campus, campus]);
  const select = document.getElementById("eventCampus");
  select.innerHTML = options.map(([optionValue, label]) => `<option value="${optionValue}">${label}</option>`).join("");
  select.value = value;
}

function openEventDialog(scope, date = state.calendar.start) {
  if (scope === "CAMPUS" && state.role === "CAMPUS" && !campusCanEdit(state.userCampus)) {
    showToast(state.basePublished ? "O calendário do campus não está em edição." : "Aguarde a Reitoria publicar o calendário base.");
    return;
  }
  const dialog = document.getElementById("eventDialog");
  const typeSelect = document.getElementById("eventType");
  const allowedTypes = Object.entries(eventTypes).filter(([, config]) => config.scope === scope);
  typeSelect.innerHTML = allowedTypes.map(([type]) => `<option value="${type}">${type}</option>`).join("");
  document.getElementById("editingEventId").value = "";
  document.getElementById("eventScope").value = scope;
  document.getElementById("eventDialogTitle").textContent = scope === "REITORIA" ? "Incluir evento da Reitoria" : "Novo evento local";
  const campus = currentCampus();
  fillEventCampusField(scope, campus === allCampuses ? (scope === "REITORIA" ? "" : campuses[0]) : campus);
  document.getElementById("eventTitle").value = "";
  setEventDateBounds();
  document.getElementById("eventStart").value = date;
  document.getElementById("eventEnd").value = date;
  document.querySelector('input[name="eventDateMode"][value="single"]').checked = true;
  updateDateMode();
  document.getElementById("eventCourse").value = "";
  document.getElementById("eventAffectsSchoolDay").checked = false;
  updateSchoolDayCheckbox();
  dialog.showModal();
}

function openEditEventDialog(eventId) {
  const event = state.events.find((item) => item.id === eventId);
  if (!event || !canEditEvent(event)) return;
  const dialog = document.getElementById("eventDialog");
  const typeSelect = document.getElementById("eventType");
  const allowedTypes = Object.entries(eventTypes).filter(([, config]) => config.scope === event.scope);
  typeSelect.innerHTML = allowedTypes.map(([type]) => `<option value="${type}">${type}</option>`).join("");
  document.getElementById("editingEventId").value = event.id;
  document.getElementById("eventScope").value = event.scope;
  document.getElementById("eventDialogTitle").textContent = "Editar evento";
  fillEventCampusField(event.scope, event.campus);
  document.getElementById("eventType").value = event.type;
  document.getElementById("eventTitle").value = event.title;
  setEventDateBounds();
  document.getElementById("eventStart").value = event.start;
  document.getElementById("eventEnd").value = event.end;
  document.querySelector(`input[name="eventDateMode"][value="${event.start === event.end ? "single" : "range"}"]`).checked = true;
  updateDateMode();
  document.getElementById("eventCourse").value = event.course;
  document.getElementById("eventAffectsSchoolDay").checked = event.affectsSchoolDay;
  updateSchoolDayCheckbox();
  dialog.showModal();
}

function eventLabel(event) {
  const target = event.campus || allCampuses;
  return `${event.title} (${formatDate(event.start)} a ${formatDate(event.end)} · ${target})`;
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
  const campus = state.role === "CAMPUS" ? state.userCampus : document.getElementById("eventCampus").value;
  if (editingEventId) {
    const existingEvent = state.events.find((item) => item.id === editingEventId);
    if (!existingEvent || !canEditEvent(existingEvent)) return;
    const oldValue = eventLabel(existingEvent);
    Object.assign(existingEvent, makeEvent(
      type,
      title,
      start,
      end,
      scope,
      document.getElementById("eventCourse").value,
      affectsSchoolDay,
      state.role === "CAMPUS" ? existingEvent.campus : campus,
    ));
    existingEvent.id = editingEventId;
    logAudit(scope === "CAMPUS" ? "Evento local editado" : "Evento da Reitoria editado", oldValue, eventLabel(existingEvent));
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
  logAudit(scope === "CAMPUS" ? "Evento local incluído" : "Evento da Reitoria incluído", "-", eventLabel(newEvent));
  saveState();
  document.getElementById("eventDialog").close();
  render();
  showToast("Evento incluído e contagem recalculada.");
}

function removeEvent(eventId) {
  const eventIndex = state.events.findIndex((item) => item.id === eventId);
  if (eventIndex === -1) return;
  const event = state.events[eventIndex];
  if (!canEditEvent(event)) return;
  state.events.splice(eventIndex, 1);
  logAudit("Evento removido", eventLabel(event), "-");
  saveState();
  render();
  showToast("Evento removido e contagem recalculada.");
}

function moveEvent(eventId, newDate) {
  const event = state.events.find((item) => item.id === eventId);
  if (!event) return;
  if (!canEditEvent(event)) {
    showToast("Você não tem permissão para mover este evento.");
    return;
  }
  const oldValue = eventLabel(event);
  const duration = dateRange(event.start, event.end).length - 1;
  const nextEnd = new Date(`${newDate}T00:00:00`);
  nextEnd.setDate(nextEnd.getDate() + duration);
  const newEnd = nextEnd.toISOString().slice(0, 10);
  if (!isInAcademicPeriod(newEnd)) {
    showToast("O evento ficaria fora do período acadêmico.");
    return;
  }
  event.start = newDate;
  event.end = newEnd;
  logAudit("Evento movido", oldValue, eventLabel(event));
  saveState();
  render();
  showToast("Evento movido e contagem recalculada.");
}

function validateBeforeSubmit() {
  const counts = countSchoolDays();
  return counts.tecnicoFirst.total === 100 && counts.graduacaoFirst.total === 100;
}

function openInitDialog() {
  document.getElementById("initStart").value = state.calendar.start;
  document.getElementById("initEnd").value = state.calendar.end;
  document.getElementById("initDialog").showModal();
}

function initializeCalendar(event) {
  event.preventDefault();
  const start = document.getElementById("initStart").value;
  const end = document.getElementById("initEnd").value;
  if (end <= start) {
    showToast("A data de fim deve ser posterior à data de início.");
    return;
  }
  const oldPeriod = `${formatDate(state.calendar.start)} a ${formatDate(state.calendar.end)}`;
  state.calendar = { start, end };
  state.events = [];
  state.basePublished = false;
  state.selectedMonthIndex = 0;
  campuses.forEach((campus) => {
    state.campusStatus[campus] = { status: "Em edição", submittedAt: "" };
  });
  logAudit("Calendário inicializado", oldPeriod, `${formatDate(start)} a ${formatDate(end)}`);
  document.getElementById("initDialog").close();
  render();
  showToast("Calendário inicializado. Cadastre os eventos da base.");
}

function submitCalendar() {
  const campus = currentCampus();
  if (campus === allCampuses) {
    showToast("Selecione um campus para enviar.");
    return;
  }
  if (!campusCanEdit(campus)) {
    showToast(state.basePublished ? "Este calendário já foi enviado ou aprovado." : "Aguarde a Reitoria publicar o calendário base.");
    return;
  }
  if (!validateBeforeSubmit()) {
    showToast("Envio bloqueado: regras acadêmicas ainda não foram atendidas.");
    return;
  }
  const old = state.campusStatus[campus].status;
  state.campusStatus[campus].status = "Pendente";
  state.campusStatus[campus].submittedAt = new Date().toLocaleDateString("pt-BR");
  logAudit("Calendário enviado para aprovação", old, `${campus}: Pendente`);
  render();
  showToast("Calendário enviado para aprovação.");
}

function reviewCalendar(action) {
  const campus = state.selectedCampus;
  if (campus === allCampuses) {
    showToast("Selecione um campus na lista.");
    return;
  }
  const old = state.campusStatus[campus].status;
  if (old !== "Pendente") {
    showToast(`${campus} não está pendente de aprovação.`);
    return;
  }
  const status = action === "approve" ? "Aprovado" : "Rejeitado";
  state.campusStatus[campus].status = status;
  logAudit("Status alterado", old, `${campus}: ${status}`);
  render();
  showToast(`${campus}: ${status}.`);
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

  if (action === "open-reitoria-event" && can("reitoria-events")) openEventDialog("REITORIA");
  if (action === "open-campus-event" && can("campus-events")) openEventDialog("CAMPUS");
  if (action === "close-dialog") document.getElementById("eventDialog").close();
  if (action === "open-init" && can("init-calendar")) openInitDialog();
  if (action === "close-init") document.getElementById("initDialog").close();
  if (action === "publish-base" && can("publish-base")) {
    if (state.basePublished) {
      showToast("O calendário base já está publicado.");
      return;
    }
    state.basePublished = true;
    logAudit("Calendário base publicado", "Em edição", "Base publicada");
    render();
    showToast("Calendário base publicado. Os campi já podem incluir eventos locais.");
  }
  if (action === "submit" && can("submit-calendar")) submitCalendar();
  if (action === "select-campus") {
    state.selectedCampus = event.target.dataset.campus;
    saveState();
    render();
    showToast(`${state.selectedCampus} selecionado.`);
  }
  if ((action === "approve" || action === "reject") && can("approve-calendar")) reviewCalendar(action);
  if (action === "duplicate") {
    logAudit("Calendário duplicado", "Ano anterior", academicYearLabel());
    showToast("Calendário anterior duplicado para simulação.");
    render();
  }
  if (action === "simulate" || action === "validate") {
    renderValidation();
    showToast("Validações recalculadas.");
  }
  if (action === "print") window.print();
  if (action === "excel") {
    const events = can("view-all-campi") ? state.events : scopedCampusEvents(false);
    document.getElementById("reportOutput").textContent = ["Campus,Tipo,Título,Início,Fim,Escopo"]
      .concat(events.map((item) => `${item.campus || "Todos"},${item.type},${item.title},${item.start},${item.end},${item.scope}`))
      .join("\n");
  }
  if (action === "compare" && can("view-all-campi")) {
    document.getElementById("reportOutput").textContent = campuses
      .map((campus) => `${campus}: ${state.campusStatus[campus].status}`)
      .join("\n");
  }
  if (action === "logout") logout();
  if (action === "manage-users" && can("manage-admin")) showView("users");
  if (action === "edit-user" && can("manage-admin")) editUser(event.target.dataset.email);
  if (action === "remove-user" && can("manage-admin")) removeUser(event.target.dataset.email);
  if (action === "cancel-user-edit") resetUserForm();
  if (action === "manage-campi" && can("manage-admin")) {
    document.getElementById("adminOutput").textContent = campuses
      .map((campus) => {
        const localEvents = state.events.filter((item) => item.campus === campus).length;
        return `${campus}: ${state.campusStatus[campus].status} · ${localEvents} evento(s) específico(s)`;
      })
      .join("\n");
  }
  if (action === "reset-demo" && can("manage-admin")) {
    if (!confirm("Restaurar os dados de demonstração? Todas as alterações locais serão perdidas.")) return;
    state = { ...structuredClone(initialState), role: state.role, userCampus: state.userCampus };
    saveState();
    document.getElementById("adminOutput").textContent = "";
    render();
    showToast("Dados de demonstração restaurados.");
  }
});

document.getElementById("eventForm").addEventListener("submit", addEventFromForm);
document.getElementById("initForm").addEventListener("submit", initializeCalendar);
document.getElementById("userForm").addEventListener("submit", saveUserFromForm);
document.getElementById("userRole").addEventListener("change", updateUserCampusField);
document.getElementById("devLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await signIn("/api/auth/dev", { email: document.getElementById("devLoginEmail").value });
});
document.getElementById("campusFilter").addEventListener("change", (event) => {
  if (state.role === "CAMPUS") return;
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
  button.addEventListener("click", () => showView(button.dataset.view));
});
document.getElementById("monthGrid").addEventListener("dblclick", (event) => {
  if (event.target.closest("button")) return;
  const day = event.target.closest(".day[data-date]");
  if (!day) return;
  const eventElement = event.target.closest("[data-event-id]");
  if (eventElement) {
    const calendarEvent = state.events.find((item) => item.id === eventElement.dataset.eventId);
    if (calendarEvent && canEditEvent(calendarEvent)) openEditEventDialog(calendarEvent.id);
    else showToast("Você não tem permissão para editar este evento.");
    return;
  }
  const scope = can("reitoria-events") ? "REITORIA" : "CAMPUS";
  if (can(scope === "REITORIA" ? "reitoria-events" : "campus-events")) openEventDialog(scope, day.dataset.date);
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

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && currentUser) showLogin("Sua sessão expirou. Entre novamente.");
  if (!response.ok) throw new Error(data.error || "Erro ao comunicar com o servidor.");
  return data;
}

function applyUser(user) {
  currentUser = user;
  state.role = user.role;
  if (user.campus) state.userCampus = user.campus;
  saveState();
}

function showLogin(message = "") {
  currentUser = null;
  users = [];
  document.body.classList.add("signed-out");
  document.getElementById("loginMessage").textContent = message;
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
}

async function onSignedIn(user) {
  applyUser(user);
  document.getElementById("loginMessage").textContent = "";
  document.body.classList.remove("signed-out");
  showView("dashboard");
  render();
  if (can("manage-admin")) await loadUsers();
}

async function signIn(path, body) {
  try {
    await onSignedIn(await api(path, { method: "POST", body }));
  } catch (error) {
    document.getElementById("loginMessage").textContent = error.message;
  }
}

async function logout() {
  await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => {});
  window.google?.accounts.id.disableAutoSelect();
  showLogin();
}

function setupGoogleButton(clientId) {
  if (!clientId) {
    document.getElementById("loginMessage").textContent = "Login com Google não configurado no servidor (GOOGLE_CLIENT_ID).";
    return;
  }
  const script = document.createElement("script");
  script.src = "https://accounts.google.com/gsi/client";
  script.async = true;
  script.onload = () => {
    google.accounts.id.initialize({
      client_id: clientId,
      hd: "ifms.edu.br",
      callback: ({ credential }) => signIn("/api/auth/google", { credential }),
    });
    google.accounts.id.renderButton(document.getElementById("googleButton"), {
      theme: "outline",
      size: "large",
      text: "signin_with",
      locale: "pt-BR",
    });
  };
  script.onerror = () => {
    document.getElementById("loginMessage").textContent = "Não foi possível carregar o login do Google.";
  };
  document.head.append(script);
}

async function boot() {
  try {
    const config = await api("/api/config");
    document.getElementById("devLoginForm").hidden = !config.devLogin;
    setupGoogleButton(config.googleClientId);
  } catch (error) {
    document.getElementById("loginMessage").textContent = error.message;
    return;
  }
  try {
    await onSignedIn(await api("/api/me"));
  } catch {
    showLogin(document.getElementById("loginMessage").textContent);
  }
}

boot();

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
