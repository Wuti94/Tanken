import {
  openDb,
  listVehicles, addVehicle, deleteVehicle,
  listPricePeriods, upsertPricePeriod, deletePricePeriod,
  listFillups, addFillup, deleteFillup,
  getPriceForDateTime,
  exportAll, importAllReplace,
  wipeAll, uuid
} from "./db.js";

let db;

const el = (id) => document.getElementById(id);
const fmtFuel = (f) => f === "DIESEL" ? "Diesel" : "Super";

function setStatus(text){ el("status").textContent = text || ""; }

function num(n, digits=2){
  if (n == null || Number.isNaN(n)) return "";
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits:digits, maximumFractionDigits:digits }).format(n);
}
function euro(n){
  if (n == null || Number.isNaN(n)) return "";
  return new Intl.NumberFormat("de-DE", { style:"currency", currency:"EUR" }).format(n);
}
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function localNowForDateTimeLocal(){
  const d = new Date();
  const pad = (x) => String(x).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseLocalDateTime(dateTimeLocal){
  // dateTimeLocal like "YYYY-MM-DDTHH:mm"
  // Interpret as local time:
  const [datePart, timePart] = dateTimeLocal.split("T");
  const [y,m,d] = datePart.split("-").map(Number);
  const [hh,mm] = timePart.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function lastCalendarMonthRange(){
  // returns { start: Date, end: Date, label: "MM.YYYY" } in local time
  const now = new Date();
  const startThisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const startLastMonth = new Date(startThisMonth.getFullYear(), startThisMonth.getMonth() - 1, 1, 0, 0, 0, 0);
  const endLastMonth = new Date(startThisMonth.getTime() - 1); // last millisecond of previous month

  const label = new Intl.DateTimeFormat("de-DE", { month: "2-digit", year: "numeric" }).format(startLastMonth);
  return { start: startLastMonth, end: endLastMonth, label };
}

/* -------- Views -------- */
function showView(which){
  el("viewHome").classList.toggle("view--active", which === "home");
  el("viewSettings").classList.toggle("view--active", which === "settings");

  closeModal("modalVehicles");
  closeModal("modalPrices");

  window.scrollTo({ top: 0, behavior: "instant" });
}

/* -------- Modals -------- */
function openModal(id){
  const m = el(id);
  if (!m) {
    console.error("openModal: Element nicht gefunden:", id);
    return;
  }
  m.hidden = false;
  m.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeModal(id){
  const m = el(id);
  if (!m) return;
  m.hidden = true;
  m.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

/* -------- Render -------- */
async function refreshAll(){
  const [vehicles, prices, fillups] = await Promise.all([
    listVehicles(db),
    listPricePeriods(db),
    listFillups(db),
  ]);

  renderVehicleSelect(vehicles);
  renderFillupsList(vehicles, fillups);
  renderVehiclesList(vehicles);
  renderPricesList(prices);

  el("fillupsCount").textContent = `${fillups.length} gesamt`;

  renderLastMonthCosts(fillups);   // <-- NEU
}

function renderVehicleSelect(vehicles){
  const sel = el("fillVehicleId");
  if (!sel) return;

  const current = sel.value;
  sel.innerHTML = "";

  for (const v of vehicles){
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.licensePlate ? `${v.name} (${v.licensePlate})` : v.name;
    sel.appendChild(opt);
  }

  if (current && vehicles.some(v => v.id === current)) sel.value = current;
}

function renderFillupsList(vehicles, fillups){
  const vehicleById = new Map(vehicles.map(v => [v.id, v]));
  const list = el("listFillups");
  list.innerHTML = "";

  const recent = fillups.slice(0, 20);
  if (recent.length === 0){
    list.innerHTML = `<div class="muted">Noch keine Tankvorgänge gespeichert.</div>`;
    return;
  }

  for (const f of recent){
    const v = vehicleById.get(f.vehicleId);
    const vName = v ? (v.licensePlate ? `${v.name} (${v.licensePlate})` : v.name) : "(unbekannt)";

    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
      <div class="item__top">
        <div>
          <div class="item__title">${escapeHtml(vName)} · ${escapeHtml(fmtFuel(f.fuelType))}</div>
          <div class="item__sub">
            ${escapeHtml(f.dateTime.replace("T"," "))}<br/>
            KM: ${num(f.odometerKm,0)} · ${num(f.liters,2)} L · ${num(f.pricePerLiter,3)} €/L
            ${f.note ? `<br/>Notiz: ${escapeHtml(f.note)}` : ""}
          </div>
        </div>
        <div class="item__right">
          <div class="item__big">${euro(f.totalCost)}</div>
        </div>
      </div>
      <div class="item__actions">
        <button class="btn btn-danger" data-del-fillup="${f.id}" type="button">Löschen</button>
      </div>
    `;
    list.appendChild(item);
  }
}

function renderVehiclesList(vehicles){
  const list = el("listVehicles");
  list.innerHTML = "";

  if (vehicles.length === 0){
    list.innerHTML = `<div class="muted">Noch keine Fahrzeuge. Lege oben 2 Fahrzeuge an.</div>`;
    return;
  }

  for (const v of vehicles){
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
      <div class="item__top">
        <div>
          <div class="item__title">${escapeHtml(v.name)}</div>
          <div class="item__sub">${escapeHtml(v.licensePlate || "")}</div>
        </div>
      </div>
      <div class="item__actions">
        <button class="btn btn-danger" data-del-vehicle="${v.id}" type="button">Löschen</button>
      </div>
    `;
    list.appendChild(item);
  }
}

function renderPricesList(prices){
  const list = el("listPrices");
  list.innerHTML = "";

  if (prices.length === 0){
    list.innerHTML = `<div class="muted">Noch keine Preisphasen. Trage den aktuellen Preis ein.</div>`;
    return;
  }

  for (const p of prices){
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
      <div class="item__top">
        <div>
          <div class="item__title">${escapeHtml(p.validFromDate)} · ${escapeHtml(fmtFuel(p.fuelType))}</div>
          <div class="item__sub">
            ${num(p.pricePerLiter,3)} €/L
            ${p.note ? `<br/>Notiz: ${escapeHtml(p.note)}` : ""}
          </div>
        </div>
      </div>
      <div class="item__actions">
        <button class="btn btn-danger" data-del-price="${p.id}" type="button">Löschen</button>
      </div>
    `;
    list.appendChild(item);
  }
}

/* -------- NEW: Last month cost widget -------- */
function renderLastMonthCosts(fillups){
  const labelEl = el("lastMonthLabel");
  const costEl  = el("lastMonthCost");
  const metaEl  = el("lastMonthMeta");

  // Falls du den Block noch nicht eingefügt hast, nichts tun:
  if (!labelEl || !costEl || !metaEl) return;

  const { start, end, label } = lastCalendarMonthRange();
  labelEl.textContent = label;

  const inRange = fillups.filter(f => {
    if (!f?.dateTime) return false;
    const dt = parseLocalDateTime(f.dateTime);
    return dt >= start && dt <= end;
  });

  const sum = inRange.reduce((acc, f) => {
    const tc = (typeof f.totalCost === "number" && Number.isFinite(f.totalCost))
      ? f.totalCost
      : (Number(f.liters) * Number(f.pricePerLiter));
    return acc + (Number.isFinite(tc) ? tc : 0);
  }, 0);

  const liters = inRange.reduce((acc, f) => acc + (Number.isFinite(Number(f.liters)) ? Number(f.liters) : 0), 0);

  costEl.textContent = euro(Math.round(sum * 100) / 100);
  metaEl.textContent = inRange.length === 0
    ? "Keine Tankvorgänge im letzten Monat."
    : `${inRange.length} Tankvorgänge · ${num(liters, 2)} L`;
}

/* -------- Price info -------- */
async function updateFillupPriceInfo(){
  const fuelType = el("fillFuelType").value;
  const dateTime = el("fillDateTime").value;

  if (!dateTime){
    el("fillupPriceInfo").textContent = "";
    return;
  }

  const price = await getPriceForDateTime(db, fuelType, dateTime);
  el("fillupPriceInfo").textContent = price == null
    ? `Kein Preis für ${fmtFuel(fuelType)} hinterlegt (Einstellungen → Preisphasen).`
    : `Automatischer Preis: ${num(price,3)} €/L`;
}

/* -------- Handlers -------- */
async function onAddFillup(e){
  e.preventDefault();

  const vehicleId = el("fillVehicleId").value;
  const fuelType = el("fillFuelType").value;
  const dateTime = el("fillDateTime").value;
  const odometerKm = Number(el("fillOdo").value);
  const liters = Number(el("fillLiters").value);
  const note = el("fillNote").value;

  if (!vehicleId){
    alert("Bitte zuerst Fahrzeuge anlegen (Einstellungen → Fahrzeuge).");
    return;
  }

  const pricePerLiter = await getPriceForDateTime(db, fuelType, dateTime);
  if (pricePerLiter == null){
    alert(`Für ${fmtFuel(fuelType)} ist noch keine Preisphase hinterlegt (Einstellungen → Preisphasen).`);
    return;
  }

  const totalCost = Math.round(liters * pricePerLiter * 100) / 100;

  await addFillup(db, {
    id: uuid(),
    vehicleId,
    fuelType,
    dateTime,
    odometerKm,
    liters,
    pricePerLiter,
    totalCost,
    note: (note ?? "").trim()
  });

  el("fillOdo").value = "";
  el("fillLiters").value = "";
  el("fillNote").value = "";
  el("fillDateTime").value = localNowForDateTimeLocal();

  await updateFillupPriceInfo();
  await refreshAll();
  setStatus("Gespeichert.");
}

async function onAddVehicle(e){
  e.preventDefault();
  const name = el("vehicleName").value.trim();
  const licensePlate = el("vehiclePlate").value.trim();
  if (!name) return;

  await addVehicle(db, { name, licensePlate });
  el("vehicleName").value = "";
  el("vehiclePlate").value = "";
  await refreshAll();
  setStatus("Fahrzeug gespeichert.");
}

async function onSeedVehicles(){
  const vehicles = await listVehicles(db);
  if (vehicles.length > 0 && !confirm("Es sind bereits Fahrzeuge vorhanden. Trotzdem 2 Standard-Fahrzeuge anlegen?")) return;

  await addVehicle(db, { name: "Fahrzeug 1", licensePlate: "" });
  await addVehicle(db, { name: "Fahrzeug 2", licensePlate: "" });
  await refreshAll();
  setStatus("2 Fahrzeuge angelegt.");
}

async function onAddPrice(e){
  e.preventDefault();
  const fuelType = el("priceFuelType").value;
  const validFromDate = el("priceValidFromDate").value;
  const pricePerLiter = el("pricePerLiter").value;
  const note = el("priceNote").value;

  await upsertPricePeriod(db, { fuelType, validFromDate, pricePerLiter, note });

  el("pricePerLiter").value = "";
  el("priceNote").value = "";

  await refreshAll();
  await updateFillupPriceInfo();
  setStatus("Preisphase gespeichert.");
}

async function onExport(){
  const data = await exportAll(db);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json" });
  const fileName = `tankbuch-backup-${new Date().toISOString().slice(0,10)}.json`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);

  setStatus(`Export erstellt: ${fileName}`);
}

async function onImportFile(file){
  const text = await file.text();
  const data = JSON.parse(text);

  if (!confirm("Import ersetzt alle lokalen Daten. Fortfahren?")) return;
  await importAllReplace(db, data);
  await refreshAll();
  await updateFillupPriceInfo();
  setStatus("Import abgeschlossen.");
}

async function onHardReset(){
  if (!confirm("Wirklich alle lokalen Daten löschen?")) return;
  await wipeAll(db);
  await refreshAll();
  await updateFillupPriceInfo();
  setStatus("Alle lokalen Daten gelöscht.");
}

async function onGlobalClick(e){
  const t = e.target;

  // Backdrop click closes modal
  const closeId = t?.getAttribute?.("data-close-modal");
  if (closeId){
    closeModal(closeId);
    return;
  }

  const delFillupId = t?.getAttribute?.("data-del-fillup");
  if (delFillupId){
    if (!confirm("Tankvorgang löschen?")) return;
    await deleteFillup(db, delFillupId);
    await refreshAll();
    return;
  }

  const delVehicleId = t?.getAttribute?.("data-del-vehicle");
  if (delVehicleId){
    if (!confirm("Fahrzeug löschen? Zugehörige Tankvorgänge werden mit gelöscht.")) return;
    await deleteVehicle(db, delVehicleId);
    await refreshAll();
    return;
  }

  const delPriceId = t?.getAttribute?.("data-del-price");
  if (delPriceId){
    if (!confirm("Preisphase löschen?")) return;
    await deletePricePeriod(db, delPriceId);
    await refreshAll();
    await updateFillupPriceInfo();
    return;
  }
}

/* -------- SW -------- */
async function registerSw(){
  if (!("serviceWorker" in navigator)) return;
  try{
    await navigator.serviceWorker.register("./sw.js", { scope:"./" });
    if (!el("status").textContent) setStatus("Offline bereit.");
  } catch (err){
    console.warn("SW Fehler:", err);
    setStatus("Offline nicht aktiv (SW Fehler).");
  }
}

/* -------- Init -------- */
(async function init(){
  db = await openDb();

  // Defaults
  el("fillDateTime").value = localNowForDateTimeLocal();
  el("priceValidFromDate").value = new Date().toISOString().slice(0,10);

  // Navigation
  el("btnGoHome").addEventListener("click", () => showView("home"));
  el("btnGoSettings").addEventListener("click", () => showView("settings"));

  // Popups
  el("btnOpenVehicles").addEventListener("click", () => openModal("modalVehicles"));
  el("btnCloseVehicles").addEventListener("click", () => closeModal("modalVehicles"));

  el("btnOpenPrices").addEventListener("click", () => openModal("modalPrices"));
  el("btnClosePrices").addEventListener("click", () => closeModal("modalPrices"));

  // ESC closes
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal("modalVehicles");
      closeModal("modalPrices");
    }
  });

  // Forms
  el("formFillup").addEventListener("submit", onAddFillup);
  el("fillFuelType").addEventListener("change", updateFillupPriceInfo);
  el("fillDateTime").addEventListener("change", updateFillupPriceInfo);

  el("formVehicle").addEventListener("submit", onAddVehicle);
  el("btnSeedVehicles").addEventListener("click", onSeedVehicles);

  el("formPrice").addEventListener("submit", onAddPrice);

  // Backup
  el("btnExport").addEventListener("click", onExport);
  el("fileImport").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await onImportFile(file);
  });
  el("btnHardReset").addEventListener("click", onHardReset);

  // Global clicks (delete + backdrop close)
  document.addEventListener("click", onGlobalClick);

  await refreshAll();
  await updateFillupPriceInfo();
  await registerSw();

  const vehicles = await listVehicles(db);
  if (vehicles.length === 0) setStatus("Bitte zuerst Fahrzeuge anlegen (Einstellungen).");
})();
