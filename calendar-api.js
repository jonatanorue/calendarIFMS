// API do calendário: anos letivos, eventos, fluxo de aprovação e auditoria.
// Todas as regras de permissão são conferidas aqui; o navegador só esconde botões.
const campuses = require("./public/campuses.js");
const rules = require("./public/rules.js");
const db = require("./db");

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const courses = ["", ...Object.keys(rules.courseRules)];

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isReitoria = (user) => user.role === "REITORIA" || user.role === "ADMIN";

function requireReitoria(user) {
  if (!isReitoria(user)) throw new ApiError(403, "Ação restrita à Reitoria.");
}

function formatDate(isoDate) {
  return isoDate.split("-").reverse().join("/");
}

function yearLabel(year) {
  const startYear = year.start.slice(0, 4);
  const endYear = year.end.slice(0, 4);
  return startYear === endYear ? startYear : `${startYear}/${endYear}`;
}

function eventLabel(event) {
  return `${event.title} (${formatDate(event.start)} a ${formatDate(event.end)} · ${event.campus || rules.allCampusesLabel})`;
}

function isValidDate(value) {
  return isoDatePattern.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

// Mesmo dia e mês, deslocado em anos; 29/02 vira 28/02 em ano não bissexto.
function shiftDate(isoDate, years) {
  const [yearPart, month, day] = isoDate.split("-").map(Number);
  const targetYear = yearPart + years;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return `${targetYear}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function loadYear(id) {
  const year = db.getYear(id);
  if (!year) throw new ApiError(404, "Ano letivo não encontrado.");
  return year;
}

// O que cada perfil enxerga: o campus vê só os eventos e o status dele.
function yearPayload(yearId, user) {
  const year = loadYear(yearId);
  let events = db.listEvents(yearId);
  let campusStatus = db.getCampusStatuses(yearId);
  if (user.role === "CAMPUS") {
    events = rules.eventsForCampus(events, user.campus);
    campusStatus = { [user.campus]: campusStatus[user.campus] };
  }
  return {
    id: year.id,
    calendar: { start: year.start, end: year.end },
    basePublished: year.basePublished,
    finalPublished: year.finalPublished,
    events,
    campusStatus,
  };
}

function audit(user, year, action, oldValue, newValue) {
  db.addAudit({ user: user.email, yearId: year?.id ?? null, action, oldValue, newValue });
}

function validateEventInput(body, year, user) {
  const type = String(body.type || "");
  const config = rules.eventTypes[type];
  if (!config) throw new ApiError(400, "Tipo de evento inválido.");
  const title = String(body.title || "").trim();
  if (!title || title.length > 80) throw new ApiError(400, "Informe um título com até 80 caracteres.");
  const start = String(body.start || "");
  const end = String(body.end || "");
  if (!isValidDate(start) || !isValidDate(end) || end < start) throw new ApiError(400, "Datas inválidas.");
  if (start < year.start || end > year.end) throw new ApiError(400, "As datas devem estar dentro do período do ano letivo.");
  const course = String(body.course || "");
  if (!courses.includes(course)) throw new ApiError(400, "Curso inválido.");

  let campus = String(body.campus || "");
  if (config.scope === "CAMPUS") {
    if (user.role === "CAMPUS") campus = user.campus;
    if (!campuses.includes(campus)) throw new ApiError(400, "Selecione o campus do evento.");
  } else if (campus && !campuses.includes(campus)) {
    throw new ApiError(400, "Campus inválido.");
  }

  return {
    type,
    title,
    start,
    end,
    scope: config.scope,
    course,
    semester: rules.boundaryTypes.includes(type) ? (Number(body.semester) === 2 ? 2 : 1) : null,
    affectsSchoolDay: config.alwaysNonSchoolDay ? false : Boolean(body.affectsSchoolDay),
    campus,
  };
}

// Regras de quem pode incluir, alterar ou remover um evento.
function assertCanWriteEvent(user, year, event, { isNew }) {
  if (year.finalPublished) throw new ApiError(409, "O calendário final está publicado. Reabra-o para fazer alterações.");
  if (event.scope === "REITORIA") {
    if (!isReitoria(user)) throw new ApiError(403, "Somente a Reitoria altera os eventos do calendário base.");
    if (year.basePublished) throw new ApiError(409, "O calendário base já foi publicado e não pode mais ser alterado.");
    return;
  }
  if (user.role === "CAMPUS") {
    if (event.campus !== user.campus) throw new ApiError(403, "Você só pode alterar eventos do seu campus.");
    if (!year.basePublished) throw new ApiError(409, "Aguarde a Reitoria publicar o calendário base.");
    const { status } = db.getCampusStatuses(year.id)[user.campus];
    if (!rules.editableStatuses.includes(status)) throw new ApiError(409, "O calendário do campus foi enviado ou aprovado e não pode ser alterado.");
    return;
  }
  if (user.role === "REITORIA" && isNew && !rules.eventTypes[event.type].addableByReitoria) {
    throw new ApiError(403, "No calendário do campus, a Reitoria inclui apenas feriados municipais.");
  }
}

function createYear(body, user) {
  requireReitoria(user);
  const start = String(body.start || "");
  const end = String(body.end || "");
  if (!isValidDate(start) || !isValidDate(end) || end <= start) throw new ApiError(400, "A data de fim deve ser posterior à data de início.");
  const overlapping = db.listYears().find((year) => start <= year.end && end >= year.start);
  if (overlapping) throw new ApiError(409, `O período se sobrepõe ao ano letivo ${yearLabel(overlapping)}.`);

  let events = [];
  let skipped = 0;
  const source = body.copyFrom ? loadYear(String(body.copyFrom)) : null;
  if (source) {
    const offset = Number(start.slice(0, 4)) - Number(source.start.slice(0, 4));
    const candidates = db.listEvents(source.id).filter((event) => body.includeCampusEvents || event.scope === "REITORIA");
    events = candidates
      .map((event) => ({ ...event, start: shiftDate(event.start, offset), end: shiftDate(event.end, offset) }))
      .filter((event) => event.start >= start && event.end <= end);
    skipped = candidates.length - events.length;
  }
  const year = db.createYear({ start, end }, events, campuses, user.email);
  audit(user, year, "Ano letivo criado", source ? `Cópia de ${yearLabel(source)}` : "-", `${formatDate(start)} a ${formatDate(end)} · ${events.length} evento(s)`);
  return { status: 201, body: { year: yearPayload(year.id, user), copied: events.length, skipped } };
}

function publishBase(year, user) {
  requireReitoria(user);
  if (year.basePublished) throw new ApiError(409, "O calendário base já está publicado.");
  db.setYearFlags(year.id, { basePublished: true });
  audit(user, year, "Calendário base publicado", "Em edição", "Publicado (não pode mais ser alterado)");
}

function setFinalPublication(year, user, published) {
  requireReitoria(user);
  if (published) {
    if (year.finalPublished) throw new ApiError(409, "O calendário final já está publicado.");
    const statuses = db.getCampusStatuses(year.id);
    if (!year.basePublished || !campuses.every((campus) => statuses[campus]?.status === "Aprovado")) {
      throw new ApiError(409, "Publique a base e aprove todos os campi antes de publicar o calendário final.");
    }
  } else if (!year.finalPublished) {
    throw new ApiError(409, "O calendário final não está publicado.");
  }
  db.setYearFlags(year.id, { finalPublished: published });
  audit(user, year, published ? "Calendário final publicado" : "Calendário final reaberto", published ? "Em ajustes" : "Publicado", published ? "Publicado" : "Em ajustes");
}

function submitCampus(year, user, campus) {
  if (!(user.role === "ADMIN" || (user.role === "CAMPUS" && user.campus === campus))) {
    throw new ApiError(403, "Você só pode enviar o calendário do seu campus.");
  }
  if (year.finalPublished) throw new ApiError(409, "O calendário final está publicado.");
  if (!year.basePublished) throw new ApiError(409, "Aguarde a Reitoria publicar o calendário base.");
  const current = db.getCampusStatuses(year.id)[campus];
  if (!rules.editableStatuses.includes(current.status)) throw new ApiError(409, "Este calendário já foi enviado ou aprovado.");
  const events = rules.eventsForCampus(db.listEvents(year.id), campus);
  if (!rules.meetsSchoolDayRules(events)) {
    throw new ApiError(409, "Envio bloqueado: cada semestre precisa ter exatamente 100 dias letivos em cada curso.");
  }
  db.setCampusStatus(year.id, campus, { status: "Pendente" }, user.email);
  audit(user, year, "Calendário enviado para aprovação", `${campus}: ${current.status}`, `${campus}: Pendente`);
}

function reviewCampus(year, user, campus, body) {
  requireReitoria(user);
  if (year.finalPublished) throw new ApiError(409, "O calendário final está publicado.");
  const current = db.getCampusStatuses(year.id)[campus];
  const action = String(body.action || "");
  let next;
  let reason = "";
  if (action === "approve" || action === "reject") {
    if (current.status !== "Pendente") throw new ApiError(409, `${campus} não está pendente de aprovação.`);
    next = action === "approve" ? "Aprovado" : "Rejeitado";
    if (action === "reject") {
      reason = String(body.reason || "").trim().slice(0, 500);
      if (!reason) throw new ApiError(400, "Informe o motivo da rejeição.");
    }
  } else if (action === "reopen") {
    if (current.status !== "Aprovado") throw new ApiError(409, `${campus} não está aprovado.`);
    next = "Em edição";
    reason = "Reaberto para ajustes pela Reitoria.";
  } else {
    throw new ApiError(400, "Ação inválida.");
  }
  db.setCampusStatus(year.id, campus, { status: next, reason }, user.email);
  audit(user, year, "Status alterado", `${campus}: ${current.status}`, `${campus}: ${next}${reason ? ` (${reason})` : ""}`);
}

function writeEvent(year, user, method, eventId, body) {
  if (method === "POST") {
    const event = validateEventInput(body, year, user);
    assertCanWriteEvent(user, year, event, { isNew: true });
    const created = db.createEvent(year.id, event, user.email);
    audit(user, year, event.scope === "CAMPUS" ? "Evento do campus incluído" : "Evento da base incluído", "-", eventLabel(created));
    return;
  }
  const existing = db.getEvent(year.id, eventId);
  if (!existing) throw new ApiError(404, "Evento não encontrado.");
  if (user.role === "CAMPUS" && existing.campus && existing.campus !== user.campus) throw new ApiError(404, "Evento não encontrado.");
  assertCanWriteEvent(user, year, existing, { isNew: false });
  if (method === "DELETE") {
    db.deleteEvent(year.id, eventId);
    audit(user, year, "Evento removido", eventLabel(existing), "-");
    return;
  }
  const event = validateEventInput(body, year, user);
  if (event.scope !== existing.scope) throw new ApiError(400, "Não é possível trocar um evento entre a base e o calendário do campus.");
  assertCanWriteEvent(user, year, event, { isNew: false });
  const updated = db.updateEvent(year.id, eventId, event, user.email);
  audit(user, year, "Evento alterado", eventLabel(existing), eventLabel(updated));
}

// Rotas: /api/years, /api/years/:id, /api/years/:id/{publish-base,final,events[/:eventId],campus/:campus/{submit,review}}, /api/audit
async function handleCalendarApi(req, res, url, user, { sendJson, readJson }) {
  const parts = url.pathname.split("/").slice(2).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      throw new ApiError(400, "Endereço inválido.");
    }
  });
  const method = req.method;
  // Corpo lido uma vez, antes das transações (que são síncronas).
  const body = method === "GET" ? {} : await readJson(req);

  if (parts[0] === "audit" && parts.length === 1 && method === "GET") {
    requireReitoria(user);
    return sendJson(res, 200, db.listAudit());
  }
  if (parts[0] !== "years") throw new ApiError(404, "Rota não encontrada.");

  if (parts.length === 1) {
    if (method === "GET") return sendJson(res, 200, db.listYears().map(({ id, start, end, basePublished, finalPublished }) => ({ id, calendar: { start, end }, basePublished, finalPublished })));
    if (method === "POST") {
      const result = createYear(body, user);
      return sendJson(res, result.status, result.body);
    }
  }

  const year = loadYear(parts[1]);
  const [, , resource, resourceId, subAction] = parts;
  const respond = () => sendJson(res, 200, { year: yearPayload(year.id, user) });

  if (!resource && method === "GET") return respond();
  if (resource === "publish-base" && method === "POST" && parts.length === 3) {
    db.transaction(() => publishBase(year, user));
    return respond();
  }
  if (resource === "final" && method === "POST" && parts.length === 3) {
    db.transaction(() => setFinalPublication(year, user, Boolean(body.published)));
    return respond();
  }
  if (resource === "events" && ((parts.length === 3 && method === "POST") || (parts.length === 4 && ["PUT", "DELETE"].includes(method)))) {
    db.transaction(() => writeEvent(year, user, method, resourceId, body));
    return respond();
  }
  if (resource === "campus" && parts.length === 5 && method === "POST" && campuses.includes(resourceId)) {
    if (subAction === "submit") {
      submitCampus(year, user, resourceId);
      return respond();
    }
    if (subAction === "review") {
      reviewCampus(year, user, resourceId, body);
      return respond();
    }
  }
  throw new ApiError(404, "Rota não encontrada.");
}

module.exports = { handleCalendarApi, ApiError, audit };
