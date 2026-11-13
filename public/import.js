// Importação de eventos a partir de planilha CSV (a mesma que o sistema exporta, ou o modelo).
// Usado pelo navegador; os testes carregam pelo Node.
const calendarImport = (() => {
  const headerAliases = {
    type: ["tipo", "tipo de evento"],
    title: ["titulo", "título", "descricao", "descrição", "evento"],
    start: ["inicio", "início", "data", "data inicial", "data de inicio"],
    end: ["fim", "termino", "término", "data final", "data de fim"],
    campus: ["campus"],
    course: ["curso"],
    semester: ["semestre"],
    affectsSchoolDay: ["conta como dia letivo", "dia letivo", "letivo"],
    swapDate: ["dia de reposicao", "dia de reposição", "reposicao", "reposição"],
  };
  // Nomes antigos ou variações comuns de tipo.
  const typeAliases = { "feriado estadual/local": "Feriado Estadual" };

  const normalize = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

  // CSV com aspas, quebras de linha dentro de aspas, BOM e separador ";" ou ",".
  function parseCsv(text) {
    const source = String(text).replace(/^﻿/, "");
    const firstLine = source.split(/\r?\n/, 1)[0] || "";
    const delimiter = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ";" : ",";
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quoted) {
        if (char === '"' && source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
      } else if (char === '"' && field === "") {
        quoted = true;
      } else if (char === delimiter) {
        row.push(field);
        field = "";
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && source[index + 1] === "\n") index += 1;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }
    if (field !== "" || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
  }

  // "dd/mm/aaaa", "dd/mm/aa" ou "aaaa-mm-dd" para "aaaa-mm-dd"; inválida devolve null.
  function parseDate(value) {
    const text = String(value ?? "").trim();
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    let year;
    let month;
    let day;
    if (match) [, year, month, day] = match.map(Number);
    else {
      match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
      if (!match) return null;
      [, day, month, year] = match.map(Number);
      if (year < 100) year += 2000;
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date.toISOString().slice(0, 10);
  }

  function columnIndexes(header) {
    const normalized = header.map(normalize);
    const indexes = {};
    Object.entries(headerAliases).forEach(([key, aliases]) => {
      const position = normalized.findIndex((name) => aliases.includes(name));
      if (position >= 0) indexes[key] = position;
    });
    return indexes;
  }

  // Converte as linhas da planilha em eventos do sistema, com o erro de cada linha inválida.
  // options: { eventTypes, campuses, courses, calendar: {start, end}, role, userCampus, existing: [eventos] }
  function rowsToEvents(rows, options) {
    if (!rows.length) return { events: [], problems: ["A planilha está vazia."] };
    const indexes = columnIndexes(rows[0]);
    const missing = ["type", "title", "start"].filter((key) => indexes[key] === undefined);
    if (missing.length) {
      const names = { type: "Tipo", title: "Título", start: "Início" };
      return { events: [], problems: [`Faltam as colunas: ${missing.map((key) => names[key]).join(", ")}. Use o modelo de planilha.`] };
    }
    const typeByName = new Map(Object.keys(options.eventTypes).map((type) => [normalize(type), type]));
    Object.entries(typeAliases).forEach(([alias, type]) => typeByName.set(alias, type));
    const campusByName = new Map(options.campuses.map((campus) => [normalize(campus), campus]));
    const courseByName = new Map(options.courses.map((course) => [normalize(course), course]));
    const existingKeys = new Set((options.existing || []).map((event) => `${event.type}|${event.start}|${event.campus || ""}|${normalize(event.title)}`));
    const seen = new Set();
    const cell = (cells, key) => (indexes[key] === undefined ? "" : String(cells[indexes[key]] ?? "").trim());

    const events = rows.slice(1).map((cells, index) => {
      const line = index + 2;
      const errors = [];
      const type = typeByName.get(normalize(cell(cells, "type")));
      if (!type) errors.push(`tipo "${cell(cells, "type")}" não existe no sistema`);
      const config = type ? options.eventTypes[type] : {};
      // A exportação põe um apóstrofo antes de textos que o Excel leria como fórmula; aqui ele sai.
      const title = cell(cells, "title").replace(/^'(?=[=+\-@])/, "");
      if (!title) errors.push("título vazio");
      else if (title.length > 200) errors.push("título com mais de 200 caracteres");
      const start = parseDate(cell(cells, "start"));
      if (!start) errors.push(`data de início inválida ("${cell(cells, "start")}")`);
      const end = config.swap ? start : parseDate(cell(cells, "end")) || start;
      if (cell(cells, "end") && !config.swap && !parseDate(cell(cells, "end"))) errors.push(`data de fim inválida ("${cell(cells, "end")}")`);
      if (start && end && end < start) errors.push("o fim é anterior ao início");
      if (start && (start < options.calendar.start || end > options.calendar.end)) errors.push("fora do período do ano letivo");

      const campusText = normalize(cell(cells, "campus"));
      let campus = ["", "todos", "todos os campi"].includes(campusText) ? "" : campusByName.get(campusText);
      if (campus === undefined) {
        errors.push(`campus "${cell(cells, "campus")}" não existe`);
        campus = "";
      }
      if (options.role === "CAMPUS" && config.scope === "CAMPUS") campus = options.userCampus;
      if (config.scope === "CAMPUS" && !campus) errors.push("eventos do campus precisam da coluna Campus preenchida");

      const courseText = normalize(cell(cells, "course"));
      const course = ["", "todos"].includes(courseText) ? "" : courseByName.get(courseText);
      if (course === undefined) errors.push(`curso "${cell(cells, "course")}" não existe`);

      const semesterText = cell(cells, "semester").replace(/[^\d]/g, "");
      const semester = type && options.boundaryTypes.includes(type) ? (semesterText === "2" ? 2 : 1) : null;

      let swapDate = null;
      if (config.swap) {
        swapDate = parseDate(cell(cells, "swapDate"));
        if (!swapDate) errors.push("troca sem o dia de reposição");
      }
      const affectsSchoolDay = !config.alwaysNonSchoolDay && !config.swap && !config.informational && ["sim", "s", "1", "x"].includes(normalize(cell(cells, "affectsSchoolDay")));

      const event = { type, title, start, end, campus, course: course || "", semester, affectsSchoolDay, swapDate };
      const key = `${type}|${start}|${campus}|${normalize(title)}`;
      const duplicate = existingKeys.has(key);
      const repeated = !duplicate && seen.has(key);
      seen.add(key);
      return { line, event, errors, duplicate, repeated };
    });
    return { events, problems: [] };
  }

  // Modelo com o cabeçalho e exemplos de cada situação comum.
  function templateCsv() {
    const rows = [
      ["Tipo", "Título", "Início", "Fim", "Dia de reposição", "Campus", "Curso", "Semestre", "Conta como dia letivo"],
      ["Início/Fim de aulas Técnicas", "Início das aulas do 1º semestre", "08/02/2027", "", "", "Todos os campi", "Técnico", "1", ""],
      ["Feriado Nacional", "Tiradentes", "21/04/2027", "", "", "Todos os campi", "", "", ""],
      ["Recesso institucional", "Carnaval - Recesso", "10/02/2027", "", "", "Todos os campi", "", "", ""],
      ["Prazo ou atividade", "Período de matrícula", "01/02/2027", "05/02/2027", "", "Todos os campi", "", "", ""],
      ["Feriado Municipal", "Aniversário da cidade", "18/07/2027", "", "", "Ponta Porã", "", "", ""],
      ["Sábado Letivo", "Sábado letivo referente à quinta-feira", "27/03/2027", "", "", "Ponta Porã", "Técnico", "", "Sim"],
      ["Troca de Dia Letivo", "Ajuste referente à segunda-feira", "06/12/2027", "", "11/12/2027", "Ponta Porã", "Técnico", "", ""],
    ];
    return `﻿${rows.map((row) => row.map((value) => (/[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)).join(";")).join("\r\n")}`;
  }

  return { parseCsv, parseDate, rowsToEvents, templateCsv, normalize };
})();

if (typeof module !== "undefined") module.exports = calendarImport;
