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

// Tipos de evento, cursos e contagem de dias letivos vêm de /rules.js, compartilhado com o servidor.
const { eventTypes, courseRules, semesters, boundaryTypes, editableStatuses } = calendarRules;

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

// No navegador ficam só preferências de tela; os dados do calendário vêm do servidor.
const storageKey = "calendar-ifms-ui-v1";

let state = loadState();
let currentUser = null;
let users = [];
let academicYears = [];
let currentYear = null;
let auditEntries = [];
let adminStatus = null;

function nowLabel() {
  return new Date().toLocaleString("pt-BR");
}

function loadState() {
  const defaults = { role: "REITORIA", userCampus: campuses[0], activeYearId: "", selectedCampus: allCampuses, selectedMonthIndex: 0, eventFilter: "Todos" };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(storageKey) || "{}") };
  } catch {
    return defaults;
  }
}

function saveState() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Preferências de tela são opcionais.
  }
}

function year() {
  return currentYear;
}

function sortedYears() {
  return academicYears;
}

function isFinalPublished() {
  return Boolean(year()?.finalPublished);
}

// A cor do evento vem do tipo, para não depender do que está gravado.
function decorateYear(data) {
  data.events = data.events.map((event) => ({ ...event, color: eventTypes[event.type]?.color || "#e5e7eb" }));
  return data;
}

// Todo texto digitado por usuários passa por aqui antes de entrar no HTML (evita XSS).
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
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
  return Boolean(year()?.basePublished) && !isFinalPublished() && editableStatuses.includes(year().campusStatus[campus]?.status);
}

// Espelha as regras do servidor, que é quem decide de fato.
function canEditEvent(event) {
  if (isFinalPublished()) return false;
  if (event.scope === "REITORIA") return can("reitoria-events") && !year().basePublished;
  if (can("edit-any-event")) return true;
  return event.campus === state.userCampus && campusCanEdit(state.userCampus);
}

function selectedCampusEvents() {
  return scopedCampusEvents(true);
}

function scopedCampusEvents(applyEventFilter, campus = currentCampus()) {
  return year().events.filter((event) => {
    const campusMatches = campus === allCampuses || event.campus === "" || event.campus === campus;
    const typeMatches = !applyEventFilter || state.eventFilter === "Todos" || event.type === state.eventFilter;
    return campusMatches && typeMatches;
  });
}

function getAcademicMonths() {
  const months = [];
  const current = new Date(`${year().calendar.start.slice(0, 7)}-01T00:00:00`);
  const last = new Date(`${year().calendar.end.slice(0, 7)}-01T00:00:00`);
  while (current <= last) {
    const label = monthNames[current.getMonth()];
    months.push({ label, short: label.slice(0, 3), year: current.getFullYear(), month: current.getMonth() });
    current.setMonth(current.getMonth() + 1);
  }
  return months;
}

function academicYearLabel(calendar = year().calendar) {
  const startYear = calendar.start.slice(0, 4);
  const endYear = calendar.end.slice(0, 4);
  return startYear === endYear ? startYear : `${startYear}/${endYear}`;
}

function isInAcademicPeriod(date) {
  return date >= year().calendar.start && date <= year().calendar.end;
}

function dateRange(start, end) {
  return calendarRules.dateRange(start, end);
}

function render() {
  applyPermissions();
  if (!year()) {
    renderEmptyState();
    return;
  }
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
  renderNotice();
  renderReportScope();
  renderEvents();
  renderReviewWarnings();
  document.querySelector('[data-action="open-holidays"]').hidden = !can("reitoria-events") || year().basePublished;
  document.getElementById("publicLinkNotice").hidden = !isFinalPublished();
  document.getElementById("publicLink").href = `/publico?ano=${encodeURIComponent(year().id)}`;
  const publishButton = document.querySelector('[data-action="publish-base"]');
  publishButton.disabled = year().basePublished;
  publishButton.textContent = year().basePublished ? "Base publicada" : "Publicar base";
  document.querySelector('[data-action="open-reitoria-event"]').textContent = year().basePublished ? "Incluir feriado municipal" : "Incluir evento da Reitoria";
  const calendarStatus = document.getElementById("calendarStatus");
  calendarStatus.textContent = isFinalPublished() ? "Calendário final publicado" : year().basePublished ? "Base publicada" : "Base em edição";
  calendarStatus.className = `tag ${year().basePublished ? "approved" : "pending"}`;
}

// Sem ano letivo cadastrado: só o cabeçalho, a auditoria e os usuários fazem sentido.
function renderEmptyState() {
  document.getElementById("roleLabel").textContent = state.role === "CAMPUS" ? `Campus ${state.userCampus}` : roles[state.role].label;
  document.getElementById("userBadge").textContent = currentUser.email;
  document.getElementById("periodLabel").textContent = "Nenhum ano letivo cadastrado.";
  document.getElementById("annualTitle").textContent = "Calendário acadêmico";
  document.getElementById("yearFilter").innerHTML = "<option>Nenhum ano letivo</option>";
  ["metrics", "campusStatus", "validationSummary", "legend", "months", "monthGrid", "monthTotals", "approvalRows", "reportOutput", "eventRows", "reviewWarnings"].forEach((id) => {
    document.getElementById(id).innerHTML = "";
  });
  const notice = document.getElementById("calendarNotice");
  notice.hidden = false;
  notice.className = "notice";
  notice.textContent = can("init-calendar")
    ? "Nenhum ano letivo cadastrado. Clique em “Novo ano letivo”, no topo, para começar."
    : "Nenhum ano letivo cadastrado ainda. Aguarde a Reitoria criar o calendário.";
  renderAudit();
  renderUsers();
}

function renderNotice() {
  const notice = document.getElementById("calendarNotice");
  const item = state.role === "CAMPUS" ? year().campusStatus[state.userCampus] : null;
  let text = "";
  let tone = "";
  if (isFinalPublished()) {
    text = `Calendário final ${academicYearLabel()} publicado. Os eventos estão travados para edição.`;
    tone = "success";
  } else if (item?.status === "Rejeitado") {
    text = `Calendário rejeitado pela Reitoria: "${item.reason}". Faça os ajustes e envie novamente.`;
    tone = "warning";
  } else if (item && !year().basePublished) {
    text = "Aguardando a Reitoria publicar o calendário base para incluir os eventos do campus.";
  } else if (item?.status === "Pendente") {
    text = `Calendário enviado em ${item.submittedAt}. Aguardando a análise da Reitoria.`;
  } else if (item?.status === "Aprovado") {
    text = "Calendário do campus aprovado pela Reitoria.";
    tone = "success";
  } else if (item?.reason) {
    text = item.reason;
  } else if (!item && year().basePublished) {
    text = "Calendário base publicado: os eventos da Reitoria não podem mais ser alterados. Feriados municipais ainda podem ser incluídos para cada campus.";
  } else if (!item && can("publish-base")) {
    text = "Calendário base em edição. Confira todos os eventos antes de publicar: depois de publicada, a base não pode mais ser alterada.";
    tone = "warning";
  }
  notice.hidden = !text;
  notice.textContent = text;
  notice.className = `notice ${tone}`;
}

function scopeLabel() {
  const campus = currentCampus();
  return campus === allCampuses ? "Todos os campi" : `Campus ${campus}`;
}

function renderReportScope() {
  document.getElementById("reportScope").textContent =
    `Ano letivo ${academicYearLabel()} · ${scopeLabel()}. Para outro ano ou campus, troque nos seletores do topo.`;
}

function renderHeader() {
  document.getElementById("roleLabel").textContent =
    state.role === "CAMPUS" ? `Campus ${state.userCampus}` : roles[state.role].label;
  document.getElementById("periodLabel").textContent =
    `Período letivo: ${formatDate(year().calendar.start)} a ${formatDate(year().calendar.end)}`;
  document.getElementById("annualTitle").textContent = `Calendário acadêmico ${academicYearLabel()}`;
  document.getElementById("userBadge").textContent = currentUser.email;
  document.getElementById("monthHint").textContent =
    state.role === "CAMPUS"
      ? "Eventos da Reitoria são bloqueados. Seus eventos locais podem ser editados e arrastados enquanto o calendário do campus estiver em edição ou rejeitado. Dê dois cliques em um dia para incluir um evento ou em um evento para editá-lo."
      : year().basePublished
        ? "A base está publicada e não pode mais ser alterada. Você pode incluir feriados municipais e ajustar os eventos dos campi. Dê dois cliques em um dia para incluir um feriado municipal."
        : "Você pode editar, remover e arrastar os eventos da base até publicá-la. Dê dois cliques em um dia para incluir um evento ou em um evento para editá-lo.";
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
  const yearFilter = document.getElementById("yearFilter");
  yearFilter.innerHTML = sortedYears()
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(`Ano letivo ${academicYearLabel(item.calendar)}`)}</option>`)
    .join("");
  yearFilter.value = state.activeYearId;

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
  const statuses = shown.map((campus) => year().campusStatus[campus]);
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
      const status = year().campusStatus[campus]?.status;
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
        .map((event) => `<div class="event ${escapeHtml(event.scope.toLowerCase())}" style="background:${escapeHtml(event.color)}">${escapeHtml(eventTitle(event))}<small>${escapeHtml(event.type)}</small></div>`)
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
  const tecnicoDates = courseSchoolDates("Técnico");
  const graduationDates = courseSchoolDates("Graduação");
  const monthStart = `${month.year}-${String(month.month + 1).padStart(2, "0")}-01`;
  const monthEnd = `${month.year}-${String(month.month + 1).padStart(2, "0")}-${String(totalDays).padStart(2, "0")}`;
  const inMonth = (date) => date >= monthStart && date <= monthEnd;
  // Eventos que tocam o mês, inclusive os que começaram antes, e trocas com reposição no mês.
  const monthEvents = selectedCampusEvents().filter(
    (event) => (event.start <= monthEnd && event.end >= monthStart) || (event.swapDate && inMonth(event.swapDate)),
  );

  ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].forEach((day) => cells.push(`<div class="weekday">${day}</div>`));
  for (let i = 0; i < offset; i += 1) cells.push('<div class="day muted"></div>');
  for (let day = 1; day <= totalDays; day += 1) {
    const iso = `${month.year}-${String(month.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!isInAcademicPeriod(iso)) {
      cells.push(`<div class="day muted"><div class="day-head"><strong>${day}</strong><span class="day-kind">Fora do período</span></div></div>`);
      continue;
    }
    const eventsHtml = [
      ...monthEvents.filter((event) => iso >= event.start && iso <= event.end).map((event) => eventMarkup(event)),
      ...monthEvents.filter((event) => event.swapDate === iso).map((event) => eventMarkup(event, { replacement: true })),
    ].join("");
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

function eventTitle(event, { replacement = false } = {}) {
  if (!event.swapDate) return event.title;
  return replacement ? `${event.title} (reposição de ${formatDate(event.start)})` : `${event.title} → ${formatDate(event.swapDate)}`;
}

function eventMarkup(event, { replacement = false } = {}) {
  const editable = canEditEvent(event);
  const draggable = editable ? 'draggable="true"' : "";
  const actionButtons = editable
    ? `<div class="event-actions">
    <button class="event-edit" type="button" data-action="edit-event" data-event-id="${escapeHtml(event.id)}" title="Editar evento">✎</button>
    <button class="event-remove" type="button" data-action="remove-event" data-event-id="${escapeHtml(event.id)}" title="Remover evento">×</button>
  </div>`
    : "";
  const origin = event.scope === "REITORIA" ? `Reitoria${event.campus ? ` · ${event.campus}` : ""}` : event.campus || "Campus";
  return `<div class="event ${escapeHtml(event.scope.toLowerCase())}" ${draggable} data-event-id="${escapeHtml(event.id)}" style="background:${escapeHtml(event.color)}">
    <span>${escapeHtml(eventTitle(event, { replacement }))}</span>${actionButtons}<small>${escapeHtml(origin)}</small>
  </div>`;
}

function renderMonthTotals(monthEvents) {
  const month = getAcademicMonths()[state.selectedMonthIndex];
  const monthStart = `${month.year}-${String(month.month + 1).padStart(2, "0")}-01`;
  const monthEnd = `${month.year}-${String(month.month + 1).padStart(2, "0")}-${String(new Date(month.year, month.month + 1, 0).getDate()).padStart(2, "0")}`;
  const inMonth = (date) => date >= monthStart && date <= monthEnd;
  const tecnicoDays = [...courseSchoolDates("Técnico")].filter(inMonth).length;
  const graduationDays = [...courseSchoolDates("Graduação")].filter(inMonth).length;
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
  const semesterCards = Object.entries(counts.byCourse).flatMap(([course, results]) =>
    results.map((result, index) =>
      validationCard(`${course} - ${semesters[index]}º semestre`, result.total, courseRules[course].requiredDaysPerSemester, result.periodLabel, { course, semester: semesters[index] }),
    ),
  );
  document.getElementById("validationSummary").innerHTML = [...semesterCards, weekdayCard("Distribuição semanal", counts.weekdays)].join("");
}

function validationCard(title, actual, required, detail = "", target = null) {
  const diff = actual - required;
  const width = Math.min(100, Math.round((actual / required) * 100));
  const text = diff === 0 ? "Regra atendida." : diff < 0 ? `Faltam ${Math.abs(diff)} dias.` : `Excede ${diff} dias.`;
  return `<div class="validation-card">
    <strong>${title}</strong>
    <div class="bar ${diff === 0 ? "" : "warning"}"><span style="width:${width}%"></span></div>
    <p>${actual}/${required} dias letivos. ${text}</p>
    ${detail ? `<p>${detail}</p>` : ""}
    ${target ? `<button type="button" class="link-button" data-action="count-detail" data-course="${target.course}" data-semester="${target.semester}">Ver dias</button>` : ""}
  </div>`;
}

function weekdayCard(title, weekdays) {
  return `<div class="validation-card">
    <strong>${title}</strong>
    <p>Seg ${weekdays[1]} · Ter ${weekdays[2]} · Qua ${weekdays[3]} · Qui ${weekdays[4]} · Sex ${weekdays[5]} · Sáb ${weekdays[6]}</p>
  </div>`;
}

function countSchoolDays() {
  const byCourse = Object.fromEntries(
    Object.keys(courseRules).map((course) => [course, semesters.map((semester) => countCourseSchoolDays(course, semester))]),
  );
  const weekdays = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const weekdayDates = new Set(Object.keys(courseRules).flatMap((course) => [...courseSchoolDates(course)]));
  weekdayDates.forEach((date) => {
    const weekday = new Date(`${date}T00:00:00`).getDay();
    if (weekday >= 1 && weekday <= 6) weekdays[weekday] += 1;
  });
  return { byCourse, weekdays };
}

// Eventos que entram na contagem: os do campus escolhido, ou só a base quando "Todos os campi".
function countingEvents(campus = currentCampus()) {
  if (campus === allCampuses) return year().events.filter((event) => !event.campus);
  return scopedCampusEvents(false, campus);
}

function countCourseSchoolDays(course, semester, campus = currentCampus()) {
  const result = calendarRules.countCourseSchoolDays(countingEvents(campus), course, semester);
  return {
    ...result,
    periodLabel: result.start
      ? `Período analisado: ${formatDate(result.start)} a ${formatDate(result.end)}.`
      : `Cadastre início e fim das aulas de ${course.toLowerCase()} do ${semester}º semestre.`,
  };
}

function courseSchoolDates(course) {
  return calendarRules.courseSchoolDates(countingEvents(), course);
}

function getSemesterBoundaries(course, semester, campus = currentCampus()) {
  return calendarRules.semesterBoundaries(countingEvents(campus), course, semester);
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
  const reviewer = can("approve-calendar");
  const locked = isFinalPublished();
  document.getElementById("approvalTitle").textContent = `Fluxo de aprovação ${academicYearLabel()}`;
  document.getElementById("approvalRows").innerHTML = visibleCampuses()
    .map((campus) => {
      const item = year().campusStatus[campus];
      const actions = [];
      if (reviewer && !locked && item.status === "Pendente") {
        actions.push(`<button class="primary" data-action="approve" data-campus="${campus}">Aprovar</button>`);
        actions.push(`<button data-action="reject" data-campus="${campus}">Rejeitar</button>`);
      }
      if (reviewer && !locked && item.status === "Aprovado") {
        actions.push(`<button data-action="reopen-campus" data-campus="${campus}">Reabrir</button>`);
      }
      if (reviewer) actions.push(`<button data-action="select-campus" data-campus="${campus}">Ver calendário</button>`);
      actions.push(`<button data-action="history" data-campus="${campus}">Histórico</button>`);
      return `<tr>
        <td>${campus}</td>
        <td><span class="tag ${statusClass(item.status)}">${item.status}</span></td>
        <td>${escapeHtml(item.submittedAt || "-")}</td>
        <td>${escapeHtml(item.reason || "-")}</td>
        <td><div class="actions">${actions.join("") || "-"}</div></td>
      </tr>`;
    })
    .join("");

  const approved = campuses.filter((campus) => year().campusStatus[campus]?.status === "Aprovado").length;
  const finalButton = document.getElementById("finalButton");
  finalButton.textContent = locked ? "Reabrir calendário" : "Publicar calendário final";
  finalButton.disabled = !locked && !(year().basePublished && allCampusesApproved());
  document.getElementById("finalHint").textContent = locked
    ? "Calendário final publicado: ninguém edita eventos. Reabra para fazer ajustes."
    : !year().basePublished
      ? "Publique o calendário base para que os campi possam montar e enviar os calendários."
      : `${approved} de ${campuses.length} campi aprovados. O calendário final pode ser publicado quando todos estiverem aprovados.`;
}

function csvCell(value) {
  let text = String(value ?? "");
  // Impede que o Excel interprete o texto como fórmula (injeção de CSV).
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv() {
  const label = academicYearLabel();
  const rows = [["Ano letivo", "Campus", "Tipo", "Título", "Início", "Fim", "Dia de reposição", "Curso", "Semestre", "Conta como dia letivo", "Origem"]];
  scopedCampusEvents(false)
    .slice()
    .sort((first, second) => first.start.localeCompare(second.start))
    .forEach((item) => {
      rows.push([
        label,
        item.campus || allCampuses,
        item.type,
        item.title,
        formatDate(item.start),
        formatDate(item.end),
        item.swapDate ? formatDate(item.swapDate) : "",
        item.course || "Todos",
        item.semester ? `${item.semester}º` : "",
        item.affectsSchoolDay ? "Sim" : "Não",
        item.scope === "REITORIA" ? "Reitoria" : "Campus",
      ]);
    });
  // BOM + ponto e vírgula: formato que o Excel em português abre direto.
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
  const campus = currentCampus();
  const suffix = campus === allCampuses ? "" : `-${campus.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "-").toLowerCase()}`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = `calendario-${label.replace("/", "-")}${suffix}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  document.getElementById("reportOutput").innerHTML = `<p class="hint">Planilha <strong>${escapeHtml(link.download)}</strong> gerada com ${rows.length - 1} evento(s).</p>`;
}

function renderComparison() {
  const columns = Object.keys(courseRules).flatMap((course) => semesters.map((semester) => ({ course, semester })));
  const header = ["Campus", "Status", ...columns.map(({ course, semester }) => `${course} ${semester}º`), "Eventos do campus"];
  const rows = campuses.map((campus) => {
    const status = year().campusStatus[campus]?.status;
    const counts = columns.map(({ course, semester }) => {
      const total = countCourseSchoolDays(course, semester, campus).total;
      const required = courseRules[course].requiredDaysPerSemester;
      return `<td class="${total === required ? "count-ok" : "count-off"}" title="Exigido: ${required}">${total}</td>`;
    });
    const localEvents = year().events.filter((item) => item.campus === campus).length;
    return `<tr><td>${campus}</td><td><span class="tag ${statusClass(status)}">${status}</span></td>${counts.join("")}<td>${localEvents}</td></tr>`;
  });
  document.getElementById("reportOutput").innerHTML = `
    <p class="hint">Dias letivos por semestre em ${academicYearLabel()}. Em vermelho, os valores diferentes de ${courseRules.Técnico.requiredDaysPerSemester}.</p>
    <div class="table-scroll">
      <table class="compare-table">
        <thead><tr>${header.map((title) => `<th>${title}</th>`).join("")}</tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>`;
}

// Calendário no formato oficial do IFMS, numa aba própria pronta para salvar em PDF.
function openOfficialPrint() {
  const campus = currentCampus();
  const query = new URLSearchParams({ ano: year().id });
  if (campus !== allCampuses) query.set("campus", campus);
  window.open(`/impressao?${query}`, "_blank", "noopener");
}

function printAnnual() {
  document.getElementById("printSubtitle").textContent =
    `${scopeLabel()} · Período letivo ${formatDate(year().calendar.start)} a ${formatDate(year().calendar.end)} · Gerado em ${nowLabel()} por ${currentUser.email}`;
  showView("annual");
  window.print();
}

function renderAudit() {
  document.getElementById("auditRows").innerHTML =
    auditEntries
      .map((entry) => {
        const yearText = entry.yearStart ? ` [${academicYearLabel({ start: entry.yearStart, end: entry.yearEnd })}]` : "";
        const cells = [entry.user, formatDateTime(entry.at), `${entry.action}${yearText}`, entry.oldValue, entry.newValue];
        return `<tr>${cells.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`;
      })
      .join("") || '<tr><td colspan="5" class="empty">Nenhum registro.</td></tr>';
}

function renderUsers() {
  const userCampus = document.getElementById("userCampus");
  if (!userCampus.options.length) {
    userCampus.innerHTML = '<option value="">Selecione o campus</option>' + campuses.map((campus) => `<option>${campus}</option>`).join("");
  }
  document.getElementById("userRows").innerHTML = users
    .map((user) => `<tr>
      <td>${escapeHtml(user.email)}</td>
      <td>${escapeHtml(roles[user.role]?.label ?? user.role)}</td>
      <td>${escapeHtml(user.campus || "-")}</td>
      <td>${escapeHtml(formatDateTime(user.createdAt))}</td>
      <td>${escapeHtml(user.createdBy)}</td>
      <td><div class="actions">
        <button data-action="edit-user" data-email="${escapeHtml(user.email)}">Editar</button>
        <button data-action="remove-user" data-email="${escapeHtml(user.email)}">Remover</button>
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
      await api(`/api/users/${encodeURIComponent(editingEmail)}`, { method: "PUT", body });
      showToast("Usuário atualizado.");
    } else {
      await api("/api/users", { method: "POST", body });
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
  await loadAudit();
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
  if (document.getElementById("editingUserEmail").value === email) resetUserForm();
  if (email === currentUser.email) {
    showLogin("Seu acesso foi removido.");
    return;
  }
  await loadUsers();
  await loadAudit();
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
  ["eventStart", "eventEnd", "eventSwapDate"].forEach((id) => {
    const input = document.getElementById(id);
    input.min = year().calendar.start;
    input.max = year().calendar.end;
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

const weekdayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function withWeekday(isoDate) {
  return `${formatDate(isoDate)} (${weekdayNames[calendarRules.weekday(isoDate)]})`;
}

function eventDates(event) {
  if (event.swapDate) return `${withWeekday(event.start)} → ${withWeekday(event.swapDate)}`;
  return event.start === event.end ? withWeekday(event.start) : `${withWeekday(event.start)} a ${withWeekday(event.end)}`;
}

function normalizeText(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Tela "Eventos": todos os eventos do ano em tabela, com busca e filtro.
function renderEvents() {
  const typeSelect = document.getElementById("eventListType");
  const selectedType = typeSelect.value || "Todos";
  typeSelect.innerHTML = '<option value="Todos">Todos os tipos</option>' + Object.keys(eventTypes).map((type) => `<option>${type}</option>`).join("");
  typeSelect.value = selectedType;
  const search = normalizeText(document.getElementById("eventSearch").value.trim());
  const all = scopedCampusEvents(false);
  const list = all
    .filter((event) => (selectedType === "Todos" || event.type === selectedType) && (!search || normalizeText(event.title).includes(search)))
    .sort((first, second) => first.start.localeCompare(second.start) || first.title.localeCompare(second.title));
  document.getElementById("eventsTitle").textContent = `Eventos ${academicYearLabel()}`;
  document.getElementById("eventsCount").textContent = `${list.length} de ${all.length} evento(s) · ${scopeLabel()}`;
  document.getElementById("eventRows").innerHTML =
    list
      .map((event) => {
        const actions = canEditEvent(event)
          ? `<button data-action="edit-event" data-event-id="${escapeHtml(event.id)}">Editar</button><button data-action="remove-event" data-event-id="${escapeHtml(event.id)}">Remover</button>`
          : "-";
        return `<tr>
          <td>${escapeHtml(eventDates(event))}</td>
          <td><span class="swatch" style="background:${escapeHtml(event.color)}"></span> ${escapeHtml(event.type)}${event.semester ? ` (${event.semester}º sem.)` : ""}</td>
          <td>${escapeHtml(event.title)}</td>
          <td>${escapeHtml(event.campus || allCampuses)}</td>
          <td>${escapeHtml(event.course || "Todos")}</td>
          <td>${event.scope === "REITORIA" ? "Reitoria" : "Campus"}</td>
          <td><div class="actions">${actions}</div></td>
        </tr>`;
      })
      .join("") || '<tr><td colspan="7" class="empty">Nenhum evento encontrado.</td></tr>';
}

// Avisos de conferência. Em "Todos os campi", confere só a base.
function reviewEvents() {
  return currentCampus() === allCampuses ? year().events.filter((event) => !event.campus) : scopedCampusEvents(false);
}

function warningItems(warnings) {
  return warnings.length
    ? warnings.map((text) => `<li>${escapeHtml(text)}</li>`).join("")
    : '<li class="ok">Nenhum ponto de atenção encontrado.</li>';
}

function renderReviewWarnings() {
  document.getElementById("reviewWarningsHint").textContent =
    currentCampus() === allCampuses
      ? "Conferindo a base (eventos para todos os campi). Selecione um campus no topo para conferir o calendário dele."
      : `Conferindo o calendário de ${currentCampus()}.`;
  document.getElementById("reviewWarnings").innerHTML = warningItems(calendarRules.reviewWarnings(reviewEvents()));
}

function openHistory(campus) {
  const item = year().campusStatus[campus];
  if (!item) return;
  document.getElementById("historyTitle").textContent = `Histórico de ${campus} · ${academicYearLabel()}`;
  document.getElementById("historyRows").innerHTML =
    [...item.history]
      .reverse()
      .map((entry) => `<tr>
        <td>${escapeHtml(formatDateTime(entry.at))}</td>
        <td><span class="tag ${statusClass(entry.status)}">${escapeHtml(entry.status)}</span></td>
        <td>${escapeHtml(entry.by)}</td>
        <td>${escapeHtml(entry.reason || "-")}</td>
      </tr>`)
      .join("") || '<tr><td colspan="4" class="empty">Nenhuma mudança de status registrada ainda.</td></tr>';
  document.getElementById("historyDialog").showModal();
}

function dayList(entries, emptyText) {
  if (!entries.length) return `<p class="hint">${emptyText}</p>`;
  return `<div class="table-scroll"><table><thead><tr><th>Data</th><th>Motivo</th></tr></thead><tbody>${entries
    .slice()
    .sort((first, second) => first.date.localeCompare(second.date))
    .map(({ date, event }) => `<tr><td>${escapeHtml(withWeekday(date))}</td><td>${escapeHtml(event.title)} <small>(${escapeHtml(event.type)}${event.campus ? ` · ${escapeHtml(event.campus)}` : ""})</small></td></tr>`)
    .join("")}</tbody></table></div>`;
}

// Mostra de onde vem o total: dias do período, o que foi descontado e o que foi acrescentado.
function openCountDetail(course, semester) {
  const result = countCourseSchoolDays(course, semester);
  const required = courseRules[course].requiredDaysPerSemester;
  document.getElementById("countTitle").textContent = `${course} · ${semester}º semestre · ${scopeLabel()}`;
  if (!result.start) {
    document.getElementById("countBody").innerHTML = `<p class="hint">${escapeHtml(result.periodLabel)}</p>`;
    document.getElementById("countDialog").showModal();
    return;
  }
  const allowed = courseRules[course].allowedWeekdays.map((day) => weekdayNames[day]).join(", ");
  const byMonth = {};
  [...result.dates].forEach((date) => (byMonth[date.slice(0, 7)] = (byMonth[date.slice(0, 7)] || 0) + 1));
  const monthRows = Object.entries(byMonth)
    .sort()
    .map(([key, total]) => `<tr><td>${monthNames[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}</td><td>${total}</td></tr>`)
    .join("");
  const diff = result.total - required;
  document.getElementById("countBody").innerHTML = `
    <dl class="count-summary">
      <dt>Período das aulas</dt><dd>${formatDate(result.start)} a ${formatDate(result.end)}</dd>
      <dt>Dias da semana que contam</dt><dd>${allowed}</dd>
      <dt>Dias no período</dt><dd>${result.base}</dd>
      <dt>Descontados</dt><dd>− ${result.removed.length}</dd>
      <dt>Acrescentados</dt><dd>+ ${result.added.length}</dd>
      <dt>Total</dt><dd class="${diff === 0 ? "count-ok" : "count-off"}">${result.total} de ${required}${diff ? ` (${diff > 0 ? "sobram" : "faltam"} ${Math.abs(diff)})` : ""}</dd>
    </dl>
    <h3>Dias descontados</h3>
    ${dayList(result.removed, "Nenhum dia descontado.")}
    <h3>Dias acrescentados</h3>
    ${dayList(result.added, "Nenhum dia acrescentado.")}
    <h3>Dias letivos por mês</h3>
    <div class="table-scroll"><table><thead><tr><th>Mês</th><th>Dias letivos</th></tr></thead><tbody>${monthRows}</tbody></table></div>`;
  document.getElementById("countDialog").showModal();
}

let holidaySuggestions = [];

function openHolidayDialog() {
  if (year().basePublished) {
    showToast("A base já foi publicada: os feriados nacionais precisavam ser incluídos antes.");
    return;
  }
  holidaySuggestions = calendarRules.holidaysInPeriod(year().calendar.start, year().calendar.end);
  const exists = (holiday) => year().events.some((event) => !event.campus && event.start === holiday.date && event.type === holiday.type);
  document.getElementById("holidayRows").innerHTML = holidaySuggestions
    .map((holiday, index) => {
      const already = exists(holiday);
      return `<tr class="${already ? "muted-row" : ""}">
        <td><input type="checkbox" data-holiday="${index}" ${already ? "" : "checked"} aria-label="Incluir ${escapeHtml(holiday.title)}" /></td>
        <td>${formatDate(holiday.date)}</td>
        <td>${weekdayNames[calendarRules.weekday(holiday.date)]}</td>
        <td>${escapeHtml(holiday.title)}${already ? ' <small>(já cadastrado)</small>' : ""}</td>
        <td>${escapeHtml(holiday.type)}</td>
      </tr>`;
    })
    .join("");
  document.getElementById("holidayDialog").showModal();
}

async function addHolidays(event) {
  event.preventDefault();
  const selected = [...document.querySelectorAll("#holidayRows input[data-holiday]:checked")].map((input) => holidaySuggestions[Number(input.dataset.holiday)]);
  if (!selected.length) {
    showToast("Selecione ao menos um feriado.");
    return;
  }
  const events = selected.map((holiday) => ({ type: holiday.type, title: holiday.title, start: holiday.date, end: holiday.date, course: "", campus: "" }));
  if (!(await mutate("events/batch", { body: { events } }))) return;
  document.getElementById("holidayDialog").close();
  showToast(`${events.length} feriado(s) incluído(s) na base.`);
}

// Tipos oferecidos no diálogo: "CAMPUS" para o calendário do campus; "REITORIA" para a base
// (só enquanto não publicada) mais os tipos do campus que a Reitoria também inclui (feriado municipal).
function dialogTypes(mode) {
  return Object.entries(eventTypes)
    .filter(([, config]) => {
      if (mode === "CAMPUS") return config.scope === "CAMPUS";
      if (config.scope === "REITORIA") return !year().basePublished;
      return Boolean(config.addableByReitoria);
    })
    .map(([type]) => type);
}

function fallbackCampus(scope) {
  const campus = currentCampus();
  if (campus !== allCampuses) return campus;
  return scope === "REITORIA" ? "" : campuses[0];
}

// O campo Campus depende do tipo: eventos da base podem valer para todos os campi.
function syncEventCampusField(value) {
  const scope = eventTypes[document.getElementById("eventType").value]?.scope || "REITORIA";
  document.getElementById("eventScope").value = scope;
  const select = document.getElementById("eventCampus");
  const wanted = value ?? select.value;
  fillEventCampusField(scope, wanted);
  if (state.role !== "CAMPUS" && select.value !== wanted) select.value = fallbackCampus(scope);
}

function openEventDialog(mode, date = year().calendar.start) {
  if (isFinalPublished()) {
    showToast("O calendário final está publicado. Reabra-o na tela Aprovação para editar.");
    return;
  }
  if (mode === "CAMPUS" && state.role === "CAMPUS" && !campusCanEdit(state.userCampus)) {
    showToast(year().basePublished ? "O calendário do campus não está em edição." : "Aguarde a Reitoria publicar o calendário base.");
    return;
  }
  const types = dialogTypes(mode);
  document.getElementById("eventType").innerHTML = types.map((type) => `<option value="${type}">${type}</option>`).join("");
  document.getElementById("editingEventId").value = "";
  const onlyMunicipal = mode === "REITORIA" && year().basePublished;
  document.getElementById("eventDialogTitle").textContent =
    mode === "CAMPUS" ? "Novo evento do campus" : onlyMunicipal ? "Incluir feriado municipal" : "Incluir evento da Reitoria";
  syncEventCampusField(fallbackCampus(eventTypes[types[0]].scope));
  document.getElementById("eventTitle").value = "";
  document.getElementById("eventSwapDate").value = "";
  setEventDateBounds();
  document.getElementById("eventStart").value = date;
  document.getElementById("eventEnd").value = date;
  document.querySelector('input[name="eventDateMode"][value="single"]').checked = true;
  updateDateMode();
  document.getElementById("eventCourse").value = "";
  document.getElementById("eventAffectsSchoolDay").checked = false;
  document.getElementById("eventSemester").value = String(guessSemester(date));
  updateSchoolDayCheckbox();
  updateReopenHint();
  document.getElementById("eventDialog").showModal();
}

function openEditEventDialog(eventId) {
  const event = year().events.find((item) => item.id === eventId);
  if (!event || !canEditEvent(event)) return;
  const types = Object.entries(eventTypes).filter(([, config]) => config.scope === event.scope).map(([type]) => type);
  document.getElementById("eventType").innerHTML = types.map((type) => `<option value="${type}">${type}</option>`).join("");
  document.getElementById("editingEventId").value = event.id;
  document.getElementById("eventDialogTitle").textContent = "Editar evento";
  document.getElementById("eventType").value = event.type;
  syncEventCampusField(event.campus);
  document.getElementById("eventTitle").value = event.title;
  document.getElementById("eventSwapDate").value = event.swapDate || "";
  setEventDateBounds();
  document.getElementById("eventStart").value = event.start;
  document.getElementById("eventEnd").value = event.end;
  document.querySelector(`input[name="eventDateMode"][value="${event.start === event.end ? "single" : "range"}"]`).checked = true;
  updateDateMode();
  document.getElementById("eventCourse").value = event.course;
  document.getElementById("eventAffectsSchoolDay").checked = event.affectsSchoolDay;
  document.getElementById("eventSemester").value = String(event.semester || 1);
  updateSchoolDayCheckbox();
  updateReopenHint();
  document.getElementById("eventDialog").showModal();
}

// Envia uma alteração do ano letivo ao servidor e redesenha com a resposta dele.
async function mutate(path, options = {}) {
  try {
    const data = await api(`/api/years/${encodeURIComponent(year().id)}/${path}`, { method: "POST", body: {}, ...options });
    if (data.year) currentYear = decorateYear(data.year);
    await loadAudit();
    render();
    return data;
  } catch (error) {
    showToast(error.message);
    await refreshYear().catch(() => {});
    render();
    return null;
  }
}

function eventBody(event, overrides = {}) {
  const { type, title, start, end, course, semester, affectsSchoolDay, campus, swapDate } = { ...event, ...overrides };
  return { type, title, start, end, course, semester, affectsSchoolDay, campus, swapDate };
}

function withReopenNotice(result, message) {
  const reopened = result?.reopened || [];
  return reopened.length ? `${message} ${reopened.join(", ")} voltou para "Em edição" para revisar a mudança.` : message;
}

async function addEventFromForm(event) {
  event.preventDefault();
  if (isFinalPublished()) return;
  const editingEventId = document.getElementById("editingEventId").value;
  const start = document.getElementById("eventStart").value;
  const dateMode = document.querySelector('input[name="eventDateMode"]:checked').value;
  const end = dateMode === "single" ? start : document.getElementById("eventEnd").value;
  if (end < start || !isInAcademicPeriod(start) || !isInAcademicPeriod(end)) {
    showToast("Verifique as datas dentro do período acadêmico.");
    return;
  }
  const isSwap = Boolean(eventTypes[document.getElementById("eventType").value]?.swap);
  const swapDate = isSwap ? document.getElementById("eventSwapDate").value : null;
  if (isSwap && (!swapDate || swapDate === start || !isInAcademicPeriod(swapDate))) {
    showToast("Na troca, informe um dia de reposição diferente e dentro do período acadêmico.");
    return;
  }
  const body = {
    swapDate,
    type: document.getElementById("eventType").value,
    title: document.getElementById("eventTitle").value.trim(),
    start,
    end,
    course: document.getElementById("eventCourse").value,
    semester: Number(document.getElementById("eventSemester").value),
    affectsSchoolDay: document.getElementById("eventAffectsSchoolDay").checked,
    campus: state.role === "CAMPUS" ? state.userCampus : document.getElementById("eventCampus").value,
  };
  const saved = editingEventId
    ? await mutate(`events/${encodeURIComponent(editingEventId)}`, { method: "PUT", body })
    : await mutate("events", { body });
  if (!saved) return;
  document.getElementById("eventDialog").close();
  showToast(withReopenNotice(saved, editingEventId ? "Evento atualizado e contagem recalculada." : "Evento incluído e contagem recalculada."));
}

async function removeEvent(eventId) {
  const event = year().events.find((item) => item.id === eventId);
  if (!event || !canEditEvent(event)) return;
  const removed = await mutate(`events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  if (removed) showToast(withReopenNotice(removed, "Evento removido e contagem recalculada."));
}

async function moveEvent(eventId, newDate) {
  const event = year().events.find((item) => item.id === eventId);
  if (!event) return;
  if (!canEditEvent(event)) {
    showToast("Você não tem permissão para mover este evento.");
    return;
  }
  const newEnd = calendarRules.addDays(newDate, dateRange(event.start, event.end).length - 1);
  if (!isInAcademicPeriod(newEnd)) {
    showToast("O evento ficaria fora do período acadêmico.");
    return;
  }
  const body = eventBody(event, { start: newDate, end: newEnd });
  const moved = await mutate(`events/${encodeURIComponent(eventId)}`, { method: "PUT", body });
  if (moved) showToast(withReopenNotice(moved, "Evento movido e contagem recalculada."));
}

function validateBeforeSubmit() {
  return calendarRules.meetsSchoolDayRules(scopedCampusEvents(false));
}

// Mesmo dia e mês, deslocado em anos; 29/02 vira 28/02 em ano não bissexto.
function shiftDate(isoDate, years) {
  const [yearPart, month, day] = isoDate.split("-").map(Number);
  const targetYear = yearPart + years;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return `${targetYear}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function openInitDialog(copyFromId = "") {
  const reference = sortedYears().find((item) => item.id === copyFromId) || sortedYears()[0];
  const nextYear = new Date().getFullYear() + 1;
  document.getElementById("initStart").value = reference ? shiftDate(reference.calendar.start, 1) : `${nextYear}-02-01`;
  document.getElementById("initEnd").value = reference ? shiftDate(reference.calendar.end, 1) : `${nextYear + 1}-01-31`;
  document.getElementById("initCopyFrom").innerHTML =
    '<option value="">Não copiar (começar vazio)</option>' +
    sortedYears().map((item) => `<option value="${escapeHtml(item.id)}">Ano letivo ${academicYearLabel(item.calendar)}</option>`).join("");
  document.getElementById("initCopyFrom").value = copyFromId;
  document.getElementById("initCopyCampus").checked = false;
  updateInitCopyField();
  document.getElementById("initDialog").showModal();
}

function updateInitCopyField() {
  document.getElementById("initCopyCampusField").hidden = !document.getElementById("initCopyFrom").value;
}

async function initializeCalendar(event) {
  event.preventDefault();
  const start = document.getElementById("initStart").value;
  const end = document.getElementById("initEnd").value;
  if (end <= start) {
    showToast("A data de fim deve ser posterior à data de início.");
    return;
  }
  try {
    const data = await api("/api/years", {
      method: "POST",
      body: {
        start,
        end,
        copyFrom: document.getElementById("initCopyFrom").value,
        includeCampusEvents: document.getElementById("initCopyCampus").checked,
      },
    });
    state.activeYearId = data.year.id;
    state.selectedMonthIndex = 0;
    await loadYears();
    await loadAudit();
    document.getElementById("initDialog").close();
    document.getElementById("reportOutput").innerHTML = "";
    render();
    const skippedText = data.skipped ? ` ${data.skipped} evento(s) ficaram fora do novo período e não foram copiados.` : "";
    showToast(`Ano letivo ${academicYearLabel()} criado com ${data.copied} evento(s).${skippedText}`);
  } catch (error) {
    showToast(error.message);
  }
}

async function submitCalendar() {
  const campus = currentCampus();
  if (campus === allCampuses) {
    showToast("Selecione um campus para enviar.");
    return;
  }
  if (!campusCanEdit(campus)) {
    showToast(year().basePublished ? "Este calendário já foi enviado ou aprovado." : "Aguarde a Reitoria publicar o calendário base.");
    return;
  }
  if (!validateBeforeSubmit()) {
    showToast("Envio bloqueado: cada semestre precisa ter exatamente 100 dias letivos em cada curso.");
    return;
  }
  if (await mutate(`campus/${encodeURIComponent(campus)}/submit`)) showToast("Calendário enviado para aprovação.");
}

async function reviewCalendar(action, campus) {
  if (isFinalPublished()) return;
  if (year().campusStatus[campus]?.status !== "Pendente") {
    showToast(`${campus} não está pendente de aprovação.`);
    return;
  }
  if (action === "approve") {
    if (await mutate(`campus/${encodeURIComponent(campus)}/review`, { body: { action: "approve" } })) showToast(`${campus}: aprovado.`);
    return;
  }
  document.getElementById("reviewCampus").value = campus;
  document.getElementById("reviewTitle").textContent = `Rejeitar calendário de ${campus}`;
  document.getElementById("reviewReason").value = "";
  document.getElementById("reviewDialog").showModal();
}

async function rejectFromForm(event) {
  event.preventDefault();
  const campus = document.getElementById("reviewCampus").value;
  const reason = document.getElementById("reviewReason").value.trim();
  if (!reason) {
    showToast("Informe o motivo da rejeição.");
    return;
  }
  if (!(await mutate(`campus/${encodeURIComponent(campus)}/review`, { body: { action: "reject", reason } }))) return;
  document.getElementById("reviewDialog").close();
  showToast(`${campus}: rejeitado. O campus verá o motivo.`);
}

async function reopenCampus(campus) {
  if (isFinalPublished() || year().campusStatus[campus]?.status !== "Aprovado") return;
  if (await mutate(`campus/${encodeURIComponent(campus)}/review`, { body: { action: "reopen" } })) showToast(`${campus} reaberto para ajustes.`);
}

function allCampusesApproved() {
  return campuses.every((campus) => year().campusStatus[campus]?.status === "Aprovado");
}

async function toggleFinalPublication() {
  const publish = !isFinalPublished();
  if (publish && (!year().basePublished || !allCampusesApproved())) {
    showToast("Publique a base e aprove todos os campi antes de publicar o calendário final.");
    return;
  }
  if (!(await mutate("final", { body: { published: publish } }))) return;
  showToast(publish ? `Calendário final ${academicYearLabel()} publicado.` : "Calendário reaberto. Os eventos voltam a ser editáveis.");
}

let yearDeleteArmed = false;

function canDeleteYear() {
  if (isFinalPublished()) return false;
  return !year().basePublished || state.role === "ADMIN";
}

function openYearDialog() {
  const locked = year().basePublished;
  document.getElementById("yearDialogTitle").textContent = `Editar ano letivo ${academicYearLabel()}`;
  document.getElementById("yearStart").value = year().calendar.start;
  document.getElementById("yearEnd").value = year().calendar.end;
  ["yearStart", "yearEnd", "yearSaveButton"].forEach((id) => (document.getElementById(id).disabled = locked));
  document.getElementById("yearPeriodHint").textContent = locked
    ? "A base já foi publicada: o período não pode mais ser alterado."
    : "O período só pode ser corrigido antes de publicar a base, e todos os eventos precisam continuar dentro dele.";
  document.getElementById("yearDeleteZone").hidden = !canDeleteYear();
  yearDeleteArmed = false;
  document.getElementById("yearDeleteButton").textContent = "Excluir ano letivo";
  document.getElementById("yearDialog").showModal();
}

async function saveYearPeriod(event) {
  event.preventDefault();
  const body = { start: document.getElementById("yearStart").value, end: document.getElementById("yearEnd").value };
  if (body.end <= body.start) {
    showToast("A data de fim deve ser posterior à data de início.");
    return;
  }
  try {
    await api(`/api/years/${encodeURIComponent(year().id)}`, { method: "PUT", body });
    await loadYears();
    await loadAudit();
    document.getElementById("yearDialog").close();
    render();
    showToast(`Período atualizado: ${formatDate(body.start)} a ${formatDate(body.end)}.`);
  } catch (error) {
    showToast(error.message);
  }
}

// Exclusão em dois cliques, para não apagar um ano por engano.
async function deleteYear() {
  if (!yearDeleteArmed) {
    yearDeleteArmed = true;
    document.getElementById("yearDeleteButton").textContent = `Confirmar exclusão de ${academicYearLabel()}`;
    return;
  }
  const label = academicYearLabel();
  try {
    await api(`/api/years/${encodeURIComponent(year().id)}`, { method: "DELETE", body: {} });
    state.activeYearId = "";
    await loadYears();
    await loadAudit();
    document.getElementById("yearDialog").close();
    render();
    showToast(`Ano letivo ${label} excluído.`);
  } catch (error) {
    showToast(error.message);
  }
}

function openPublishDialog() {
  if (year().basePublished) {
    showToast("O calendário base já está publicado.");
    return;
  }
  const warnings = calendarRules.reviewWarnings(year().events.filter((event) => !event.campus));
  document.getElementById("publishWarningsBox").hidden = !warnings.length;
  document.getElementById("publishWarnings").innerHTML = warningItems(warnings);
  document.getElementById("publishDialog").showModal();
}

async function publishBase(event) {
  event.preventDefault();
  if (!(await mutate("publish-base"))) return;
  document.getElementById("publishDialog").close();
  showToast("Calendário base publicado. Os campi já podem montar os calendários.");
}

// Ações que dependem de um ano letivo já criado.
const actionsWithoutYear = ["open-init", "close-init", "close-year", "close-history", "close-count", "close-holidays", "logout", "manage-users", "edit-user", "remove-user", "cancel-user-edit", "close-dialog", "close-review", "close-publish"];

document.addEventListener("click", (event) => {
  const action = event.target.dataset.action;
  if (!action) return;
  if (!year() && !actionsWithoutYear.includes(action)) {
    showToast(can("init-calendar") ? "Crie um ano letivo primeiro." : "Nenhum ano letivo cadastrado ainda.");
    return;
  }
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
  if (action === "open-year" && can("init-calendar")) openYearDialog();
  if (action === "history") openHistory(event.target.dataset.campus);
  if (action === "close-history") document.getElementById("historyDialog").close();
  if (action === "count-detail") openCountDetail(event.target.dataset.course, Number(event.target.dataset.semester));
  if (action === "close-count") document.getElementById("countDialog").close();
  if (action === "open-holidays" && can("reitoria-events")) openHolidayDialog();
  if (action === "close-holidays") document.getElementById("holidayDialog").close();
  if (action === "close-year") document.getElementById("yearDialog").close();
  if (action === "delete-year" && can("init-calendar")) deleteYear();
  if (action === "close-init") document.getElementById("initDialog").close();
  if (action === "publish-base" && can("publish-base")) openPublishDialog();
  if (action === "close-publish") document.getElementById("publishDialog").close();
  if (action === "submit" && can("submit-calendar")) submitCalendar();
  if (action === "toggle-final" && can("publish-base")) toggleFinalPublication();
  if (action === "reopen-campus" && can("approve-calendar")) reopenCampus(event.target.dataset.campus);
  if (action === "close-review") document.getElementById("reviewDialog").close();
  if (action === "select-campus") {
    state.selectedCampus = event.target.dataset.campus;
    saveState();
    render();
    showView("annual");
    showToast(`Mostrando o calendário de ${state.selectedCampus}.`);
  }
  if ((action === "approve" || action === "reject") && can("approve-calendar")) reviewCalendar(action, event.target.dataset.campus);
  if (action === "duplicate" && can("init-calendar")) openInitDialog(state.activeYearId);
  if (action === "simulate" || action === "validate") {
    renderValidation();
    showToast("Validações recalculadas.");
  }
  if (action === "print") printAnnual();
  if (action === "official-pdf") openOfficialPrint();
  if (action === "excel") downloadCsv();
  if (action === "compare" && can("view-all-campi")) renderComparison();
  if (action === "logout") logout();
  if (action === "manage-users" && can("manage-admin")) showView("users");
  if (action === "edit-user" && can("manage-admin")) editUser(event.target.dataset.email);
  if (action === "remove-user" && can("manage-admin")) removeUser(event.target.dataset.email);
  if (action === "cancel-user-edit") resetUserForm();
  if (action === "manage-campi" && can("manage-admin")) {
    document.getElementById("adminOutput").textContent = campuses
      .map((campus) => {
        const localEvents = year().events.filter((item) => item.campus === campus).length;
        return `${campus}: ${year().campusStatus[campus]?.status} · ${localEvents} evento(s) específico(s)`;
      })
      .join("\n");
  }
});

document.getElementById("eventForm").addEventListener("submit", addEventFromForm);
document.getElementById("initForm").addEventListener("submit", initializeCalendar);
document.getElementById("initCopyFrom").addEventListener("change", updateInitCopyField);
document.getElementById("reviewForm").addEventListener("submit", rejectFromForm);
document.getElementById("publishForm").addEventListener("submit", publishBase);
document.getElementById("yearForm").addEventListener("submit", saveYearPeriod);
document.getElementById("holidayForm").addEventListener("submit", addHolidays);
document.getElementById("eventSearch").addEventListener("input", () => year() && renderEvents());
document.getElementById("eventListType").addEventListener("change", () => year() && renderEvents());
document.getElementById("eventCampus").addEventListener("change", updateReopenHint);
document.getElementById("yearFilter").addEventListener("change", async (event) => {
  state.activeYearId = event.target.value;
  state.selectedMonthIndex = 0;
  document.getElementById("reportOutput").innerHTML = "";
  saveState();
  try {
    await refreshYear();
  } catch (error) {
    showToast(error.message);
  }
  render();
});
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
document.getElementById("eventType").addEventListener("change", () => {
  updateSchoolDayCheckbox();
  syncEventCampusField();
  updateReopenHint();
});
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
  if (isFinalPublished()) {
    showToast("O calendário final está publicado. Reabra-o na tela Aprovação para editar.");
    return;
  }
  const eventElement = event.target.closest("[data-event-id]");
  if (eventElement) {
    const calendarEvent = year().events.find((item) => item.id === eventElement.dataset.eventId);
    if (calendarEvent && canEditEvent(calendarEvent)) openEditEventDialog(calendarEvent.id);
    else if (calendarEvent?.scope === "REITORIA" && year().basePublished) showToast("O calendário base foi publicado e não pode mais ser alterado.");
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
  let response;
  try {
    response = await fetch(path, {
      method: options.method || "GET",
      headers: { "Content-Type": "application/json" },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error(`Sem conexão com o servidor (${path}). Verifique a internet ou a VPN e tente de novo.`);
  }
  const data = await response.json().catch(() => null);
  if (response.status === 401 && currentUser) showLogin("Sua sessão expirou. Entre novamente.");
  if (!response.ok) {
    if (data?.error) throw new Error(data.error);
    // Resposta que não veio do sistema (proxy, firewall ou servidor fora do ar): mostra o código para a TI.
    const hint = response.status >= 500 ? " O servidor ou o proxy está indisponível." : " A resposta não veio do sistema (proxy ou firewall).";
    throw new Error(`Erro ${response.status} ao acessar ${path}.${hint} Informe este código à TI.`);
  }
  if (data === null) throw new Error(`Resposta inesperada de ${path}: não veio do sistema. Informe à TI.`);
  return data;
}

async function refreshYear() {
  currentYear = state.activeYearId ? decorateYear((await api(`/api/years/${encodeURIComponent(state.activeYearId)}`)).year) : null;
}

async function loadYears() {
  academicYears = await api("/api/years");
  if (!academicYears.some((item) => item.id === state.activeYearId)) state.activeYearId = academicYears[0]?.id || "";
  saveState();
  await refreshYear();
  if (state.selectedMonthIndex >= (year() ? getAcademicMonths().length : 1)) state.selectedMonthIndex = 0;
}

async function loadAdminStatus() {
  adminStatus = can("manage-admin") ? await api("/api/admin/status").catch(() => null) : null;
  renderAdminStatus();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Situação do banco para o Administrador, com aviso em destaque se ele não sobreviver a um deploy.
function renderAdminStatus() {
  const warning = document.getElementById("storageWarning");
  const list = document.getElementById("databaseStatus");
  if (!adminStatus) {
    warning.hidden = true;
    list.innerHTML = "";
    return;
  }
  const { database, storage } = adminStatus;
  warning.hidden = storage.persistent !== false;
  warning.textContent = storage.persistent === false
    ? `Atenção, Administrador: o banco de dados não está num disco persistente. ${storage.reason} Peça à TI para montar um volume em ${database.path.replace(/\/[^/]+$/, "")} e baixe uma cópia do banco agora.`
    : "";
  const persistence = storage.persistent === true ? "Sim" : storage.persistent === false ? "Não — será apagado no próximo deploy" : "Não verificado";
  list.innerHTML = [
    ["Arquivo", database.path],
    ["Tamanho", formatBytes(database.sizeBytes)],
    ["Criado em", database.createdAt ? formatDateTime(database.createdAt) : "-"],
    ["Disco persistente", persistence],
    ["Detalhe", storage.reason],
    ["Conteúdo", `${database.counts.users} usuário(s), ${database.counts.years} ano(s) letivo(s), ${database.counts.events} evento(s), ${database.counts.audit} registro(s) de auditoria`],
  ]
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd class="${label === "Disco persistente" && storage.persistent === false ? "count-off" : ""}">${escapeHtml(value)}</dd>`)
    .join("");
}

async function loadAudit() {
  auditEntries = can("view-audit") ? await api("/api/audit").catch(() => []) : [];
}

function applyUser(user) {
  currentUser = user;
  state.role = user.role;
  if (user.campus) state.userCampus = user.campus;
  saveState();
}

function showLogin(message = "") {
  currentUser = null;
  adminStatus = null;
  document.getElementById("storageWarning").hidden = true;
  users = [];
  academicYears = [];
  currentYear = null;
  auditEntries = [];
  document.body.classList.add("signed-out");
  document.getElementById("loginMessage").textContent = message;
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
}

async function onSignedIn(user) {
  applyUser(user);
  document.getElementById("loginMessage").textContent = "";
  document.body.classList.remove("signed-out");
  showView("dashboard");
  try {
    await loadYears();
    await loadAudit();
  } catch (error) {
    showToast(error.message);
  }
  render();
  if (can("manage-admin")) {
    await loadUsers();
    await loadAdminStatus();
  }
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
  let user;
  try {
    user = await api("/api/me");
  } catch {
    showLogin(document.getElementById("loginMessage").textContent);
    return;
  }
  // Um erro ao montar a tela não pode parecer "sessão expirada": mostra a mensagem.
  try {
    await onSignedIn(user);
  } catch (error) {
    console.error(error);
    showToast(`Erro ao carregar o sistema: ${error.message}`);
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

// Sugere o 2º semestre para datas posteriores ao fim do 1º semestre já cadastrado.
function guessSemester(date) {
  const firstSemesterEnds = Object.keys(courseRules)
    .map((course) => getSemesterBoundaries(course, 1).end)
    .filter(Boolean)
    .sort();
  return firstSemesterEnds.length && date > firstSemesterEnds[firstSemesterEnds.length - 1] ? 2 : 1;
}

function updateSchoolDayCheckbox() {
  const type = document.getElementById("eventType").value;
  const swap = Boolean(eventTypes[type]?.swap);
  document.getElementById("eventSemesterField").hidden = !boundaryTypes.includes(type);
  const checkbox = document.getElementById("eventAffectsSchoolDay");
  const disabled = Boolean(eventTypes[type]?.alwaysNonSchoolDay);
  checkbox.disabled = disabled;
  const informational = Boolean(eventTypes[type]?.informational);
  if (disabled || swap || informational) checkbox.checked = false;
  // Troca: um dia deixa de ser letivo e outro passa a ser; não há período nem marcação manual.
  // Tipos informativos (prazos, atividades, ajuste de horário) não mexem na contagem.
  document.getElementById("eventAffectsSchoolDayField").hidden = swap || informational;
  document.getElementById("eventDateModeField").hidden = swap;
  document.getElementById("eventSwapField").hidden = !swap;
  document.getElementById("eventSwapDate").required = swap;
  if (swap) {
    document.querySelector('input[name="eventDateMode"][value="single"]').checked = true;
    updateDateMode();
    document.getElementById("eventStartLabel").textContent = "Dia que deixa de ser letivo";
  }
}

// Avisa a Reitoria quando salvar vai devolver um campus já enviado ou aprovado para edição.
function updateReopenHint() {
  const hint = document.getElementById("eventReopenHint");
  const scope = eventTypes[document.getElementById("eventType").value]?.scope;
  const campus = document.getElementById("eventCampus").value;
  const status = year()?.campusStatus[campus]?.status;
  const willReopen = state.role !== "CAMPUS" && scope === "CAMPUS" && ["Pendente", "Aprovado"].includes(status);
  hint.hidden = !willReopen;
  hint.textContent = willReopen
    ? `O calendário de ${campus} está "${status}". Ao salvar, ele volta para "Em edição" para o campus revisar a contagem e enviar de novo.`
    : "";
}
