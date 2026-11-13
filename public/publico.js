// Página pública: mostra só calendários finais publicados, sem login.
const { eventTypes, allCampusesLabel } = calendarRules;
const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const params = new URLSearchParams(location.search);
let years = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function formatDate(isoDate) {
  return isoDate.split("-").reverse().join("/");
}

function yearLabel(calendar) {
  const startYear = calendar.start.slice(0, 4);
  const endYear = calendar.end.slice(0, 4);
  return startYear === endYear ? startYear : `${startYear}/${endYear}`;
}

function months(calendar) {
  const list = [];
  const current = new Date(`${calendar.start.slice(0, 7)}-01T00:00:00Z`);
  const last = new Date(`${calendar.end.slice(0, 7)}-01T00:00:00Z`);
  while (current <= last) {
    list.push({ year: current.getUTCFullYear(), month: current.getUTCMonth(), key: current.toISOString().slice(0, 7) });
    current.setUTCMonth(current.getUTCMonth() + 1);
  }
  return list;
}

function eventDates(event) {
  if (event.swapDate) return `${formatDate(event.start)} → reposição em ${formatDate(event.swapDate)}`;
  return event.start === event.end ? formatDate(event.start) : `${formatDate(event.start)} a ${formatDate(event.end)}`;
}

async function getJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Não foi possível carregar o calendário.");
  return response.json();
}

async function showYear() {
  const yearId = document.getElementById("publicYear").value;
  const campus = document.getElementById("publicCampus").value;
  const query = campus ? `?campus=${encodeURIComponent(campus)}` : "";
  const data = await getJson(`/api/public/years/${encodeURIComponent(yearId)}${query}`);
  document.getElementById("icsLink").href = `/api/public/years/${encodeURIComponent(yearId)}/calendario.ics${query}`;
  document.getElementById("pdfLink").href = `/impressao?ano=${encodeURIComponent(yearId)}${campus ? `&campus=${encodeURIComponent(campus)}` : ""}`;
  document.getElementById("publicHint").textContent =
    `Ano letivo ${yearLabel(data.calendar)} · ${campus ? `Campus ${campus}` : allCampusesLabel} · ${formatDate(data.calendar.start)} a ${formatDate(data.calendar.end)}. ` +
    "Para acompanhar no celular, baixe o arquivo .ics e importe no Google Agenda ou no calendário do seu aparelho.";
  document.getElementById("publicMonths").innerHTML = months(data.calendar)
    .map(({ year, month, key }) => {
      const monthEvents = data.events.filter((event) => event.start.slice(0, 7) <= key && event.end.slice(0, 7) >= key);
      const items = monthEvents
        .map((event) => `<div class="event" style="background:${eventTypes[event.type]?.color || "#e5e7eb"}">${escapeHtml(event.title)}<small>${escapeHtml(eventDates(event))}${event.campus ? ` · ${escapeHtml(event.campus)}` : ""}</small></div>`)
        .join("");
      return `<article class="month"><strong>${monthNames[month].slice(0, 3)} ${year}</strong>${items || '<p class="empty">Sem eventos</p>'}</article>`;
    })
    .join("");
  const url = new URL(location.href);
  url.searchParams.set("ano", yearId);
  if (campus) url.searchParams.set("campus", campus);
  else url.searchParams.delete("campus");
  history.replaceState(null, "", url);
}

function showError(error) {
  document.getElementById("publicHint").textContent = error.message;
}

async function start() {
  document.getElementById("publicLegend").innerHTML = Object.entries(eventTypes)
    .map(([name, config]) => `<span class="legend-item"><span class="swatch" style="background:${config.color}"></span>${name}</span>`)
    .join("");
  const campusSelect = document.getElementById("publicCampus");
  campusSelect.innerHTML = `<option value="">${allCampusesLabel}</option>` + campuses.map((campus) => `<option>${campus}</option>`).join("");
  campusSelect.value = campuses.includes(params.get("campus")) ? params.get("campus") : "";
  try {
    years = await getJson("/api/public/years");
  } catch (error) {
    document.getElementById("publicEmpty").textContent = error.message;
    document.getElementById("publicEmpty").hidden = false;
    return;
  }
  if (!years.length) {
    document.getElementById("publicEmpty").hidden = false;
    document.querySelector(".actions").hidden = true;
    return;
  }
  const yearSelect = document.getElementById("publicYear");
  yearSelect.innerHTML = years.map((item) => `<option value="${escapeHtml(item.id)}">Ano letivo ${yearLabel(item.calendar)}</option>`).join("");
  if (years.some((item) => item.id === params.get("ano"))) yearSelect.value = params.get("ano");
  yearSelect.addEventListener("change", () => showYear().catch(showError));
  campusSelect.addEventListener("change", () => showYear().catch(showError));
  await showYear();
}

start();
