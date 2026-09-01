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

function setStatus(text){
  el("status").textContent = text;
}

function euro(n){
  if (n == null || Number.isNaN(n)) return "";
  return new Intl.NumberFormat("de-DE", { style:"currency", currency:"EUR" }).format(n);
}
function num(n, digits=2){
  if (n == null || Number.isNaN(n)) return "";
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits:digits, maximumFractionDigits:digits }).format(n);
}

function localNowForDateTimeLocal(){
  // returns "YYYY-MM-DDTHH:mm" in local time for <input type=datetime-local>
  const d = new Date();
  const pad = (x) => String(x).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function refreshAll(){
  const [vehicles, prices, fillups] = await Promise.all([
    listVehicles(db),
    listPricePeriods(db),
    listFillups(db)
  ]);
  renderVehicles(vehicles);
  renderVehicleSelect(vehicles);
  renderPrices(prices);
  renderFillups(vehicles, fillups);
}

function renderVehicles(vehicles){
  const tb = el("tblVehicles");
  tb.innerHTML = "";
  for (const v of vehicles){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(v.name)}</td>
      <td>${escapeHtml(v.licensePlate || "")}</td>
      <td><button class="btn btn-danger" data-del-vehicle="${v.id}">Löschen</button></td>
    `;
    tb.appendChild(tr);
  }
}

function renderVehicleSelect(vehicles){
  const sel = el("fillVehicleId");
  sel.innerHTML = "";
  for (const v of vehicles){
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.licensePlate ? `${v.name} (${v.licensePlate})` : v.name;
    sel.appendChild(opt);
  }
}

function renderPrices(prices){
  const tb = el("tblPrices");
  tb.innerHTML = "";
  for (const p of prices){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(p.validFromDate)}</td>
      <td>${escapeHtml(fmtFuel(p.fuelType))}</td>
      <td>${num(p.pricePerLiter, 3)}</td>
      <td>${escapeHtml(p.note || "")}</td>
      <td><button class="btn btn-danger" data-del-price="${p.id}">Löschen</button></td>
    `;
    tb.appendChild(tr);
  }
}

function renderFillups(vehicles, fillups){
  const vehicleById = new Map(vehicles.map(v => [v.id, v]));
  const tb = el("tblFillups");
  tb.innerHTML = "";
  for (const f of fillups){
    const v = vehicleById.get(f.vehicleId);
    const vName = v ? (v.licensePlate ? `${v.name} (${v.licensePlate})` : v.name) : "(unbekannt)";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(f.dateTime.replace("T"," "))}</td>
      <td>${escapeHtml(vName)}</td>
      <td>${escapeHtml(fmtFuel(f.fuelType))}</td>
      <td>${num(f.odometerKm, 0)}</td>
      <td>${num(f.liters, 2)}</td>
      <td>${num(f.pricePerLiter, 3)}</td>
      <td>${euro(f.totalCost)}</td>
      <td><button class="btn btn-danger" data-del-fillup="${f.id}">Löschen</button></td>
    `;
    tb.appendChild(tr);
  }
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* Events */

async function onAddVehicle(e){
  e.preventDefault();
  const name = el("vehicleName").value.trim();
  const licensePlate = el("vehiclePlate").value.trim();
  if (!name) return;

  await addVehicle(db, { name, licensePlate });
  el("vehicleName").value = "";
  el("vehiclePlate").value = "";
  await refreshAll();
}

async function onSeedVehicles(){
  const vehicles = await listVehicles(db);
  if (vehicles.length > 0 && !confirm("Es sind bereits Fahrzeuge vorhanden. Trotzdem 2 Standard-Fahrzeuge anlegen?")) {
    return;
  }
  await addVehicle(db, { name: "Fahrzeug 1", licensePlate: "" });
  await addVehicle(db, { name: "Fahrzeug 2", licensePlate: "" });
  await refreshAll();
}

async function onAddPrice(e){
  e.preventDefault();
  const fuelType = el("priceFuelType").value;
  const validFromDate = el("priceValidFromDate").value; // YYYY-MM-DD
  const pricePerLiter = el("pricePerLiter").value;
  const note = el("priceNote").value;

  if (!validFromDate) return;

  await upsertPricePeriod(db, { fuelType, validFromDate, pricePerLiter, note });
  el("pricePerLiter").value = "";
  el("priceNote").value = "";
  await refreshAll();
}

async function updateFillupPriceInfo(){
  const fuelType = el("fillFuelType").value;
  const dateTime = el("fillDateTime").value;
  if (!dateTime){
    el("fillupPriceInfo").textContent = "";
    return;
  }
  const price = await getPriceForDateTime(db, fuelType, dateTime);
  el("fillupPriceInfo").textContent = price == null
    ? `Kein Preis für ${fmtFuel(fuelType)} hinterlegt`
    : `Preis wird automatisch gesetzt: ${num(price,3)} €/L`;
}

async function onAddFillup(e){
  e.preventDefault();
  const vehicleId = el("fillVehicleId").value;
  const fuelType = el("fillFuelType").value;
  const dateTime = el("fillDateTime").value; // "YYYY-MM-DDTHH:mm"
  const odometerKm = Number(el("fillOdo").value);
  const liters = Number(el("fillLiters").value);
  const note = el("fillNote").value;

  if (!vehicleId) throw new Error("Bitte Fahrzeug wählen.");
  if (!dateTime) throw new Error("Bitte Datum/Uhrzeit wählen.");
  if (!Number.isFinite(odometerKm) || odometerKm < 0) throw new Error("KM-Stand ungültig.");
  if (!Number.isFinite(liters) || liters <= 0) throw new Error("Liter ungültig.");

  const pricePerLiter = await getPriceForDateTime(db, fuelType, dateTime);
  if (pricePerLiter == null) {
    alert(`Für ${fmtFuel(fuelType)} ist noch keine Preisphase hinterlegt. Bitte zuerst unter "Preisphasen" eintragen.`);
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
    pricePerLiter, // Snapshot
    totalCost,
    note: (note ?? "").trim()
  });

  // keep last vehicle/fuel, reset others
  el("fillOdo").value = "";
  el("fillLiters").value = "";
  el("fillNote").value = "";
  el("fillDateTime").value = localNowForDateTimeLocal();
  await updateFillupPriceInfo();
  await refreshAll();
}

async function onExport(){
  const data = await exportAll(db);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const fileName = `tankbuch-backup-${new Date().toISOString().slice(0,10)}.json`;

  // Download
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
  setStatus("Import abgeschlossen.");
}

async function onHardReset(){
  if (!confirm("Wirklich alle lokalen Daten löschen?")) return;
  await wipeAll(db);
  await refreshAll();
  setStatus("Alle lokalen Daten gelöscht.");
}

async function onClick(e){
  const t = e.target;

  const delVehicleId = t?.getAttribute?.("data-del-vehicle");
  if (delVehicleId){
    if (!confirm("Fahrzeug löschen? Alle zugehörigen Tankvorgänge werden mit gelöscht.")) return;
    await deleteVehicle(db, delVehicleId);
    await refreshAll();
    return;
  }

  const delPriceId = t?.getAttribute?.("data-del-price");
  if (delPriceId){
    if (!confirm("Preisphase löschen?")) return;
    await deletePricePeriod(db, delPriceId);
    await refreshAll();
    return;
  }

  const delFillupId = t?.getAttribute?.("data-del-fillup");
  if (delFillupId){
    if (!confirm("Tankvorgang löschen?")) return;
    await deleteFillup(db, delFillupId);
    await refreshAll();
    return;
  }
}

/* Service Worker */
async function registerSw(){
  if (!("serviceWorker" in navigator)) return;
  try{
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    setStatus("Offline bereit (Service Worker aktiv).");
  } catch(err){
    console.warn("SW registration failed:", err);
    setStatus("Offline-Modus nicht aktiv (SW Fehler).");
  }
}

/* Init */
(async function init(){
  db = await openDb();

  // defaults
  el("fillDateTime").value = localNowForDateTimeLocal();
  el("priceValidFromDate").value = new Date().toISOString().slice(0,10);

  el("formVehicle").addEventListener("submit", onAddVehicle);
  el("btnSeedVehicles").addEventListener("click", onSeedVehicles);

  el("formPrice").addEventListener("submit", onAddPrice);

  el("fillFuelType").addEventListener("change", updateFillupPriceInfo);
  el("fillDateTime").addEventListener("change", updateFillupPriceInfo);
  el("formFillup").addEventListener("submit", onAddFillup);

  el("btnExport").addEventListener("click", onExport);
  el("fileImport").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await onImportFile(file);
  });

  el("btnHardReset").addEventListener("click", onHardReset);

  document.addEventListener("click", onClick);

  await refreshAll();
  await updateFillupPriceInfo();
  await registerSw();
})();
