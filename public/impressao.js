// Monta o calendário no formato oficial do IFMS (folhas A4) a partir dos dados do sistema.
// Endereço: /impressao?ano=<id do ano>&campus=<campus>. Sem campus, imprime só a base.
const { eventTypes } = calendarRules;
const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const weekdayLetters = ["D", "S", "T", "Q", "Q", "S", "S"];
const params = new URLSearchParams(location.search);
const yearId = params.get("ano") || "";
const campus = campuses.includes(params.get("campus")) ? params.get("campus") : "";

// Cores da legenda oficial para cada tipo de evento do sistema.
const categoryByType = {
  "Feriado Nacional": "nacional",
  "Feriado Estadual": "local",
  "Feriado Municipal": "local",
  "Férias Docentes": "ferias",
  Recesso: "recesso",
  Planejamento: "planejamento",
  "Início/Fim de aulas Técnicas": "aulas",
  "Início/Fim de aulas Graduação": "aulas",
  "Fechamento de Diários": "entrega",
  "Entrega de Notas": "entrega",
  "Sábado Letivo": "sabado",
  "Ajuste de horário": "ajuste",
};
const priority = ["nacional", "local", "recesso", "ferias", "planejamento", "aulas", "entrega", "nao-letivo", "sabado", "ajuste"];
const noteCategories = new Set(["nacional", "local", "aulas", "sabado", "ajuste"]);
const legendItems = [
  ["nacional", "Feriado nacional"],
  ["local", "Feriado local/estadual"],
  ["ferias", "Férias"],
  ["recesso", "Recesso"],
  ["entrega", "Entrega notas/diários, Planos de Ensino e Relatórios"],
  ["sabado", "Sábado letivo"],
  ["planejamento", "Planejamento"],
  ["aulas", "Início / Término de aulas"],
  ["ajuste", "Ajuste de horário / reposição"],
  ["nao-letivo", "Dia não letivo (troca)"],
  ["sabado-grad", "Sábado letivo - Graduação"],
];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

const pad = (number) => String(number).padStart(2, "0");
const day = (isoDate) => isoDate.slice(8, 10);
const dayMonth = (isoDate) => `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;
const normalize = (text) => String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function loadData() {
  const query = campus ? `?campus=${encodeURIComponent(campus)}` : "";
  const own = await fetch(`/api/years/${encodeURIComponent(yearId)}`);
  if (own.ok) return { ...(await own.json()).year, source: "sistema" };
  // Sem login (ou sem acesso): só o calendário final publicado.
  const published = await fetch(`/api/public/years/${encodeURIComponent(yearId)}${query}`);
  if (!published.ok) throw new Error("Calendário não encontrado. Entre no sistema ou escolha um calendário final já publicado.");
  return { ...(await published.json()), finalPublished: true, source: "publico" };
}

// O 2º semestre começa no início das aulas do Técnico (ou da Graduação), incluindo o
// planejamento que vem logo antes, como no calendário oficial.
function semesterSplit(events) {
  for (const course of ["Técnico", "Graduação"]) {
    const start = calendarRules.semesterBoundaries(events, course, 2).start;
    if (!start) continue;
    const earliest = calendarRules.addDays(start, -14);
    const planning = events.filter((event) => event.type === "Planejamento" && event.end < start && event.end >= earliest).map((event) => event.start);
    return [start, ...planning].sort()[0];
  }
  return null;
}

function monthsOf(calendar) {
  const months = [];
  let key = calendar.start.slice(0, 7);
  while (key <= calendar.end.slice(0, 7)) {
    const [yearPart, monthPart] = key.split("-").map(Number);
    const lastDay = new Date(Date.UTC(yearPart, monthPart, 0)).getUTCDate();
    months.push({ key, year: yearPart, month: monthPart - 1, first: `${key}-01`, last: `${key}-${pad(lastDay)}` });
    key = monthPart === 12 ? `${yearPart + 1}-01` : `${yearPart}-${pad(monthPart + 1)}`;
  }
  return months;
}

function withCourse(event) {
  return event.course && !normalize(event.title).includes(normalize(event.course)) ? `${event.title} - ${event.course}` : event.title;
}

// Linhas da lista mensal, no formato "09." / "09 a 13." / "26/01 a 06/02.".
function entriesOf(events) {
  const entries = [];
  events.forEach((event) => {
    if (event.swapDate) {
      entries.push({ date: event.start, label: `${day(event.start)}.`, text: `${withCourse(event)} (reposição em ${dayMonth(event.swapDate)}).` });
      entries.push({ date: event.swapDate, label: `${day(event.swapDate)}.`, text: `Reposição: ${withCourse(event)} (aulas de ${dayMonth(event.start)}).` });
      return;
    }
    let label = `${day(event.start)}.`;
    if (event.end !== event.start) {
      label = event.start.slice(0, 7) === event.end.slice(0, 7) ? `${day(event.start)} a ${day(event.end)}.` : `${dayMonth(event.start)} a ${dayMonth(event.end)}.`;
    }
    entries.push({ date: event.start, label, text: withCourse(event) });
  });
  return entries.sort((first, second) => first.date.localeCompare(second.date) || first.label.localeCompare(second.label));
}

function countIn(dates, from, to) {
  let total = 0;
  dates.forEach((date) => {
    if (date >= from && date <= to) total += 1;
  });
  return total;
}

function daysBadge(model, from, to) {
  const tecnico = countIn(model.tecnico, from, to);
  const graduacao = countIn(model.graduacao, from, to);
  return `Dias letivos: ${pad(tecnico)}${graduacao !== tecnico ? ` · Grad.: ${pad(graduacao)}` : ""}`;
}

function monthTitle(month, model) {
  const nextYear = month.year > model.firstYear;
  return `<span class="month-name${nextYear ? " next-year" : ""}">${monthNames[month.month]}${nextYear ? `/${month.year}` : ""}</span>`;
}

// Páginas 1 e 2: listas por mês, separadas por semestre.
function listBlocks(model) {
  const { calendar } = model;
  const sections = model.split
    ? [
        { label: "1º", from: calendar.start, to: calendarRules.addDays(model.split, -1) },
        { label: "2º", from: model.split, to: calendar.end },
      ]
    : [{ label: "", from: calendar.start, to: calendar.end }];
  const blocks = [];
  sections.forEach((section) => {
    const months = model.months.filter((month) => month.last >= section.from && month.first <= section.to);
    months.forEach((month, index) => {
      const from = month.first > section.from ? month.first : section.from;
      const to = month.last < section.to ? month.last : section.to;
      const rows = model.entries.filter((entry) => entry.date >= from && entry.date <= to);
      let previousLabel = "";
      const lines = rows
        .map((entry) => {
          const label = entry.label === previousLabel ? "" : entry.label;
          previousLabel = entry.label;
          return `<span>${escapeHtml(label)}</span><span>${escapeHtml(entry.text)}</span>`;
        })
        .join("");
      const heading = index === 0 && section.label ? `<div class="semester">${section.label}<small>SEMESTRE</small></div>` : "";
      blocks.push(`<section class="block month">${heading}
        <div class="month-head">${monthTitle(month, model)}<span class="rule"></span><span class="days-badge">${daysBadge(model, from, to)}</span></div>
        <div class="entries">${lines || '<span class="empty">Sem eventos.</span>'}</div>
      </section>`);
    });
  });
  return blocks;
}

function dayCategory(isoDate, model) {
  if (isoDate < model.calendar.start || isoDate > model.calendar.end) return "";
  const found = new Set();
  model.events.forEach((event) => {
    if (event.swapDate === isoDate) found.add(calendarRules.weekday(isoDate) === 6 ? "sabado" : "ajuste");
    if (isoDate < event.start || isoDate > event.end) return;
    if (event.swapDate) found.add("nao-letivo");
    else if (categoryByType[event.type]) found.add(categoryByType[event.type]);
  });
  const category = priority.find((item) => found.has(item));
  if (category) return `c-${category}`;
  // Sábado que só é letivo para a Graduação (no Técnico, só com Sábado Letivo).
  if (calendarRules.weekday(isoDate) === 6 && model.graduacao.has(isoDate) && !model.tecnico.has(isoDate)) return "c-sabado-grad";
  return "";
}

function miniNotes(month, model) {
  return model.events
    .flatMap((event) => {
      const notes = [];
      if (event.swapDate) {
        if (event.start >= month.first && event.start <= month.last) notes.push({ date: event.start, text: `${event.title} (reposição ${dayMonth(event.swapDate)})` });
        if (event.swapDate >= month.first && event.swapDate <= month.last) notes.push({ date: event.swapDate, text: `Reposição de ${dayMonth(event.start)}` });
        return notes;
      }
      if (noteCategories.has(categoryByType[event.type]) && event.start >= month.first && event.start <= month.last) {
        notes.push({ date: event.start, text: withCourse(event) });
      }
      return notes;
    })
    .sort((first, second) => first.date.localeCompare(second.date))
    .map((note) => `<div>${day(note.date)} – ${escapeHtml(note.text)}</div>`)
    .join("");
}

// Página 3: calendário de cada mês com as cores da legenda.
function gridBlocks(model) {
  return model.months.map((month) => {
    const offset = calendarRules.weekday(month.first);
    const total = Number(month.last.slice(8, 10));
    const cells = [];
    for (let index = 0; index < offset; index += 1) cells.push('<td class="out"></td>');
    for (let dayNumber = 1; dayNumber <= total; dayNumber += 1) {
      const isoDate = `${month.key}-${pad(dayNumber)}`;
      cells.push(`<td class="${dayCategory(isoDate, model)}">${dayNumber}</td>`);
    }
    while (cells.length % 7) cells.push('<td class="out"></td>');
    const rows = [];
    for (let index = 0; index < cells.length; index += 7) rows.push(`<tr>${cells.slice(index, index + 7).join("")}</tr>`);
    // Mês dividido entre os semestres (ex.: julho) mostra as duas contagens, como "06/03".
    const parts = model.split && model.split > month.first && model.split <= month.last
      ? [[month.first, calendarRules.addDays(model.split, -1)], [model.split, month.last]]
      : [[month.first, month.last]];
    const format = (dates) => parts.map(([from, to]) => pad(countIn(dates, from, to))).join("/");
    const tecnico = format(model.tecnico);
    const graduacao = format(model.graduacao);
    const yearMark = month.month === 0 && month.year > model.firstYear ? `<div class="year-mark">${month.year}</div>` : "";
    return `<div class="block">${yearMark}<div class="mini">
      <div class="mini-name">${monthNames[month.month]}</div>
      <table class="mini-cal"><thead><tr>${weekdayLetters.map((letter) => `<th>${letter}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>
      <div class="mini-notes"><strong>${tecnico} dias letivos${graduacao !== tecnico ? ` · Grad.: ${graduacao}` : ""}</strong>${miniNotes(month, model)}</div>
    </div></div>`;
  });
}

function logo() {
  const cells = ["dot", "", "", "", "", "blank", "", "", "", "", "", "blank"];
  return `<span class="logo">${cells.map((kind) => `<span class="${kind}"></span>`).join("")}</span>`;
}

function newPage(model, withLegend) {
  const page = document.createElement("section");
  page.className = "page";
  const place = campus ? `Campus<br>${escapeHtml(campus)}` : "Calendário<br>base";
  const legend = withLegend
    ? `<div class="legend"><h3>Legenda</h3><div class="legend-items">${legendItems.map(([key, label]) => `<span><i class="c-${key}"></i>${escapeHtml(label)}</span>`).join("")}</div></div>`
    : "";
  page.innerHTML = `
    <header class="page-header">
      <div class="banner"><span class="title-1">Calendário</span><span class="title-2">Acadêmico <span class="year">${model.firstYear}</span></span></div>
      <div class="brand">${logo()}<div class="brand-name"><strong>INSTITUTO FEDERAL</strong><small>Mato Grosso do Sul</small></div><div class="brand-campus">${place}</div></div>
      <div class="subtitle-bar">CURSOS TÉCNICOS E GRADUAÇÃO</div>
    </header>
    <div class="page-body"><div class="columns${withLegend ? " grids" : ""}"></div>${legend}</div>
    <footer class="page-footer">
      <span class="brand-mini">${logo()}<span><strong>INSTITUTO FEDERAL</strong><small>Mato Grosso do Sul</small></span></span>
      <span class="generated">Gerado pelo Sistema de Calendário Acadêmico em ${new Date().toLocaleDateString("pt-BR")}</span>
      <span class="ministry">MINISTÉRIO DA<br><strong>EDUCAÇÃO</strong></span>
    </footer>`;
  document.getElementById("pages").append(page);
  return page.querySelector(".columns");
}

// Distribui os blocos em folhas: quando um bloco passaria para uma 3ª coluna, abre nova folha.
function paginate(blocks, model, withLegend) {
  let columns = newPage(model, withLegend);
  blocks.forEach((html) => {
    const template = document.createElement("template");
    template.innerHTML = html.trim();
    const block = template.content.firstElementChild;
    columns.append(block);
    const overflows = block.offsetLeft + 2 >= columns.clientWidth;
    if (overflows && columns.children.length > 1) {
      block.remove();
      columns = newPage(model, withLegend);
      columns.append(block);
    }
  });
}

async function start() {
  const status = document.getElementById("status");
  if (!yearId) {
    status.textContent = "Informe o ano letivo no endereço (?ano=...).";
    return;
  }
  let data;
  try {
    data = await loadData();
  } catch (error) {
    status.textContent = "";
    document.getElementById("pages").innerHTML = `<p class="load-error">${escapeHtml(error.message)}</p>`;
    return;
  }
  // Sem campus: só a base (eventos para todos os campi).
  const events = (campus ? calendarRules.eventsForCampus(data.events, campus) : data.events.filter((event) => !event.campus))
    .filter((event) => eventTypes[event.type])
    .sort((first, second) => first.start.localeCompare(second.start) || first.title.localeCompare(second.title));
  const model = {
    calendar: data.calendar,
    events,
    entries: entriesOf(events),
    months: monthsOf(data.calendar),
    split: semesterSplit(events),
    tecnico: calendarRules.courseSchoolDates(events, "Técnico"),
    graduacao: calendarRules.courseSchoolDates(events, "Graduação"),
    firstYear: Number(data.calendar.start.slice(0, 4)),
  };
  document.title = `Calendário Acadêmico ${model.firstYear} - ${campus ? `Campus ${campus}` : "Base"} - IFMS`;
  paginate(listBlocks(model), model, false);
  paginate(gridBlocks(model), model, true);
  const pages = document.querySelectorAll(".page").length;
  const draft = data.finalPublished ? "" : " Atenção: este calendário ainda não foi publicado como final.";
  status.textContent = `${campus ? `Campus ${campus}` : "Base (todos os campi)"} · ${events.length} evento(s) · ${pages} folha(s).${draft}`;
  const button = document.getElementById("printButton");
  button.disabled = false;
  button.addEventListener("click", () => window.print());
}

start();
