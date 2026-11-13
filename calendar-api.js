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
  const dates = event.swapDate
    ? `${formatDate(event.start)} trocado por ${formatDate(event.swapDate)}`
    : `${formatDate(event.start)} a ${formatDate(event.end)}`;
  return `${event.title} (${dates} · ${event.campus || rules.allCampusesLabel})`;
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
  // A troca é sempre de um dia por outro.
  const end = config.swap ? start : String(body.end || "");
  if (!isValidDate(start) || !isValidDate(end) || end < start) throw new ApiError(400, "Datas inválidas.");
  if (start < year.start || end > year.end) throw new ApiError(400, "As datas devem estar dentro do período do ano letivo.");
  let swapDate = null;
  if (config.swap) {
    swapDate = String(body.swapDate || "");
    if (!isValidDate(swapDate)) throw new ApiError(400, "Informe o dia que passa a ser letivo na troca.");
    if (swapDate === start) throw new ApiError(400, "Na troca, o dia que passa a ser letivo deve ser diferente do dia que deixa de ser.");
    if (swapDate < year.start || swapDate > year.end) throw new ApiError(400, "O dia de reposição deve estar dentro do período do ano letivo.");
  }
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
    affectsSchoolDay: config.alwaysNonSchoolDay || config.swap ? false : Boolean(body.affectsSchoolDay),
    campus,
    swapDate,
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
      .map((event) => ({
        ...event,
        start: shiftDate(event.start, offset),
        end: shiftDate(event.end, offset),
        swapDate: event.swapDate ? shiftDate(event.swapDate, offset) : null,
      }))
      .filter((event) => event.start >= start && event.end <= end && (!event.swapDate || (event.swapDate >= start && event.swapDate <= end)));
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

// Quando a Reitoria mexe no calendário de um campus já enviado ou aprovado, o campus volta
// para "Em edição": a mudança pode alterar a contagem de dias letivos e precisa ser revista.
function reopenAfterReitoriaChange(year, user, campus, description) {
  if (user.role === "CAMPUS" || !campus) return null;
  const current = db.getCampusStatuses(year.id)[campus];
  if (!current || !["Pendente", "Aprovado"].includes(current.status)) return null;
  const reason = `Reaberto automaticamente: a Reitoria ${description}. Revise a contagem e envie novamente.`;
  db.setCampusStatus(year.id, campus, { status: "Em edição", reason }, user.email);
  audit(user, year, "Status alterado", `${campus}: ${current.status}`, `${campus}: Em edição (${reason})`);
  return campus;
}

function writeEvent(year, user, method, eventId, body) {
  const reopened = [];
  const reopen = (campus, description) => {
    const result = reopenAfterReitoriaChange(year, user, campus, description);
    if (result) reopened.push(result);
  };
  if (method === "POST") {
    const event = validateEventInput(body, year, user);
    assertCanWriteEvent(user, year, event, { isNew: true });
    const created = db.createEvent(year.id, event, user.email);
    audit(user, year, event.scope === "CAMPUS" ? "Evento do campus incluído" : "Evento da base incluído", "-", eventLabel(created));
    if (event.scope === "CAMPUS") reopen(event.campus, `incluiu "${created.title}" em ${formatDate(created.start)}`);
    return reopened;
  }
  const existing = db.getEvent(year.id, eventId);
  if (!existing) throw new ApiError(404, "Evento não encontrado.");
  if (user.role === "CAMPUS" && existing.campus && existing.campus !== user.campus) throw new ApiError(404, "Evento não encontrado.");
  assertCanWriteEvent(user, year, existing, { isNew: false });
  if (method === "DELETE") {
    db.deleteEvent(year.id, eventId);
    audit(user, year, "Evento removido", eventLabel(existing), "-");
    if (existing.scope === "CAMPUS") reopen(existing.campus, `removeu "${existing.title}"`);
    return reopened;
  }
  const event = validateEventInput(body, year, user);
  if (event.scope !== existing.scope) throw new ApiError(400, "Não é possível trocar um evento entre a base e o calendário do campus.");
  assertCanWriteEvent(user, year, event, { isNew: false });
  const updated = db.updateEvent(year.id, eventId, event, user.email);
  audit(user, year, "Evento alterado", eventLabel(existing), eventLabel(updated));
  if (event.scope === "CAMPUS") {
    reopen(existing.campus, `alterou "${existing.title}"`);
    if (event.campus !== existing.campus) reopen(event.campus, `incluiu "${updated.title}" em ${formatDate(updated.start)}`);
  }
  return reopened;
}

// Vários eventos de uma vez (feriados sugeridos): ou todos entram, ou nenhum.
function writeEventBatch(year, user, body) {
  const list = Array.isArray(body.events) ? body.events : [];
  if (!list.length || list.length > 100) throw new ApiError(400, "Envie de 1 a 100 eventos.");
  return list.flatMap((item) => writeEvent(year, user, "POST", null, item));
}

// Corrigir o período só antes de publicar a base, e sem deixar eventos de fora.
function updateYearPeriod(year, user, body) {
  requireReitoria(user);
  if (year.basePublished) throw new ApiError(409, "O período não pode ser alterado depois de publicada a base.");
  const start = String(body.start || "");
  const end = String(body.end || "");
  if (!isValidDate(start) || !isValidDate(end) || end <= start) throw new ApiError(400, "A data de fim deve ser posterior à data de início.");
  const overlapping = db.listYears().find((item) => item.id !== year.id && start <= item.end && end >= item.start);
  if (overlapping) throw new ApiError(409, `O período se sobrepõe ao ano letivo ${yearLabel(overlapping)}.`);
  const outside = db.listEvents(year.id).filter((event) => event.start < start || event.end > end || (event.swapDate && (event.swapDate < start || event.swapDate > end)));
  if (outside.length) {
    throw new ApiError(409, `${outside.length} evento(s) ficariam fora do novo período, por exemplo "${outside[0].title}" em ${formatDate(outside[0].start)}. Ajuste ou remova esses eventos antes.`);
  }
  db.updateYearPeriod(year.id, { start, end });
  audit(user, year, "Período do ano letivo alterado", `${formatDate(year.start)} a ${formatDate(year.end)}`, `${formatDate(start)} a ${formatDate(end)}`);
}

// A Reitoria exclui enquanto a base não foi publicada; o Administrador, até a publicação final.
function deleteYear(year, user) {
  requireReitoria(user);
  if (year.finalPublished) throw new ApiError(409, "Um ano com calendário final publicado não pode ser excluído.");
  if (year.basePublished && user.role !== "ADMIN") throw new ApiError(409, "Depois de publicada a base, só o Administrador pode excluir o ano letivo.");
  const total = db.listEvents(year.id).length;
  db.deleteYear(year.id);
  audit(user, year, "Ano letivo excluído", `${yearLabel(year)} · ${total} evento(s)`, "-");
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
  if (!resource && method === "PUT") {
    db.transaction(() => updateYearPeriod(year, user, body));
    return respond();
  }
  if (!resource && method === "DELETE") {
    db.transaction(() => deleteYear(year, user));
    return sendJson(res, 200, { ok: true });
  }
  if (resource === "publish-base" && method === "POST" && parts.length === 3) {
    db.transaction(() => publishBase(year, user));
    return respond();
  }
  if (resource === "final" && method === "POST" && parts.length === 3) {
    db.transaction(() => setFinalPublication(year, user, Boolean(body.published)));
    return respond();
  }
  if (resource === "events" && resourceId === "batch" && parts.length === 4 && method === "POST") {
    const reopened = db.transaction(() => writeEventBatch(year, user, body));
    return sendJson(res, 200, { year: yearPayload(year.id, user), reopened: [...new Set(reopened)] });
  }
  if (resource === "events" && ((parts.length === 3 && method === "POST") || (parts.length === 4 && ["PUT", "DELETE"].includes(method)))) {
    const reopened = db.transaction(() => writeEvent(year, user, method, resourceId, body));
    return sendJson(res, 200, { year: yearPayload(year.id, user), reopened });
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

// --- Calendário público: só anos com calendário final publicado, sem dados de quem editou. ---

const publicEventFields = ({ id, type, title, start, end, course, semester, campus, swapDate }) => ({ id, type, title, start, end, course, semester, campus, swapDate });

function publishedYear(id) {
  const year = db.getYear(id);
  if (!year || !year.finalPublished) throw new ApiError(404, "Calendário publicado não encontrado.");
  return year;
}

function icsText(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// Linhas do iCalendar têm no máximo 75 bytes; o restante continua na linha seguinte com um espaço.
function foldIcsLine(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts = [];
  let current = "";
  for (const char of line) {
    if (Buffer.byteLength(current + char, "utf8") > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
    }
    current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function buildIcs(year, events, campus) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const compact = (isoDate) => isoDate.replace(/-/g, "");
  const scope = campus ? `Campus ${campus}` : rules.allCampusesLabel;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//IFMS//Calendario Academico//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(`Calendário IFMS ${yearLabel(year)} - ${scope}`)}`,
  ];
  const vevent = (uid, date, endExclusive, summary, description) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}@calendario.ifms.edu.br`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(date)}`,
      `DTEND;VALUE=DATE:${compact(endExclusive)}`,
      `SUMMARY:${icsText(summary)}`,
      `DESCRIPTION:${icsText(description)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  };
  events.forEach((event) => {
    const where = event.campus || rules.allCampusesLabel;
    const course = event.course ? ` · ${event.course}` : "";
    if (event.swapDate) {
      vevent(`${event.id}-origem`, event.start, rules.addDays(event.start, 1), `${event.title} (sem aula; reposição em ${formatDate(event.swapDate)})`, `${event.type} · ${where}${course}`);
      vevent(`${event.id}-reposicao`, event.swapDate, rules.addDays(event.swapDate, 1), `${event.title} (reposição de ${formatDate(event.start)})`, `${event.type} · ${where}${course}`);
      return;
    }
    vevent(event.id, event.start, rules.addDays(event.end, 1), event.title, `${event.type} · ${where}${course}`);
  });
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

// Rotas sem login: /api/public/years, /api/public/years/:id, /api/public/years/:id/calendario.ics?campus=
function handlePublicApi(req, res, url, { sendJson }) {
  if (req.method !== "GET") throw new ApiError(405, "Método não permitido.");
  const parts = url.pathname.split("/").slice(3).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      throw new ApiError(400, "Endereço inválido.");
    }
  });
  if (parts[0] !== "years") throw new ApiError(404, "Rota não encontrada.");
  if (parts.length === 1) {
    return sendJson(res, 200, db.listYears().filter((year) => year.finalPublished).map(({ id, start, end }) => ({ id, calendar: { start, end } })));
  }
  const year = publishedYear(parts[1]);
  const campus = url.searchParams.get("campus") || "";
  if (campus && !campuses.includes(campus)) throw new ApiError(400, "Campus inválido.");
  const events = rules.eventsForCampus(db.listEvents(year.id), campus).map(publicEventFields);
  if (parts.length === 2) {
    return sendJson(res, 200, { id: year.id, calendar: { start: year.start, end: year.end }, events });
  }
  if (parts.length === 3 && parts[2] === "calendario.ics") {
    const fileName = `calendario-ifms-${yearLabel(year).replace("/", "-")}${campus ? `-${campus.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "-").toLowerCase()}` : ""}.ics`;
    res.writeHead(200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-cache",
    });
    res.end(buildIcs(year, events, campus));
    return;
  }
  throw new ApiError(404, "Rota não encontrada.");
}

module.exports = { handleCalendarApi, handlePublicApi, buildIcs, ApiError, audit };
