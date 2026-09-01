const DB_NAME = "tankbuch-db";
const DB_VERSION = 1;

const STORE_VEHICLES = "vehicles";
const STORE_PRICES   = "pricePeriods";
const STORE_FILLUPS  = "fillups";

function reqToPromise(req){
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx){
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function openDb(){
  const request = indexedDB.open(DB_NAME, DB_VERSION);

  request.onupgradeneeded = (event) => {
    const db = request.result;

    // vehicles
    if (!db.objectStoreNames.contains(STORE_VEHICLES)) {
      const s = db.createObjectStore(STORE_VEHICLES, { keyPath: "id" });
      s.createIndex("name", "name", { unique: false });
    }

    // price periods
    if (!db.objectStoreNames.contains(STORE_PRICES)) {
      const s = db.createObjectStore(STORE_PRICES, { keyPath: "id" });
      s.createIndex("fuelType", "fuelType", { unique: false });
      s.createIndex("fuelType_validFromDate", ["fuelType", "validFromDate"], { unique: true });
      s.createIndex("validFromDate", "validFromDate", { unique: false });
    }

    // fillups
    if (!db.objectStoreNames.contains(STORE_FILLUPS)) {
      const s = db.createObjectStore(STORE_FILLUPS, { keyPath: "id" });
      s.createIndex("vehicleId", "vehicleId", { unique: false });
      s.createIndex("dateTime", "dateTime", { unique: false });
      s.createIndex("vehicleId_dateTime", ["vehicleId", "dateTime"], { unique: false });
      s.createIndex("fuelType_dateTime", ["fuelType", "dateTime"], { unique: false });
    }
  };

  return reqToPromise(request);
}

export function uuid(){
  return crypto.randomUUID();
}

/* Vehicles */
export async function listVehicles(db){
  const tx = db.transaction(STORE_VEHICLES, "readonly");
  const store = tx.objectStore(STORE_VEHICLES);
  const res = await reqToPromise(store.getAll());
  await txDone(tx);
  // sort by name
  res.sort((a,b) => (a.name || "").localeCompare(b.name || ""));
  return res;
}

export async function addVehicle(db, { name, licensePlate }){
  const tx = db.transaction(STORE_VEHICLES, "readwrite");
  const store = tx.objectStore(STORE_VEHICLES);
  const v = { id: uuid(), name: name.trim(), licensePlate: (licensePlate ?? "").trim() };
  await reqToPromise(store.add(v));
  await txDone(tx);
  return v;
}

export async function deleteVehicle(db, id){
  const tx = db.transaction([STORE_VEHICLES, STORE_FILLUPS], "readwrite");
  await reqToPromise(tx.objectStore(STORE_VEHICLES).delete(id));

  // delete related fillups
  const idx = tx.objectStore(STORE_FILLUPS).index("vehicleId");
  const cursorReq = idx.openCursor(IDBKeyRange.only(id));
  cursorReq.onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
  await txDone(tx);
}

/* Prices */
export async function listPricePeriods(db){
  const tx = db.transaction(STORE_PRICES, "readonly");
  const store = tx.objectStore(STORE_PRICES);
  const res = await reqToPromise(store.getAll());
  await txDone(tx);
  // newest first
  res.sort((a,b) => (b.validFromDate || "").localeCompare(a.validFromDate || ""));
  return res;
}

export async function upsertPricePeriod(db, { fuelType, validFromDate, pricePerLiter, note }){
  const tx = db.transaction(STORE_PRICES, "readwrite");
  const store = tx.objectStore(STORE_PRICES);

  // unique by (fuelType, validFromDate): overwrite if exists
  const idx = store.index("fuelType_validFromDate");
  const existing = await reqToPromise(idx.get([fuelType, validFromDate]));

  const item = {
    id: existing?.id ?? uuid(),
    fuelType,
    validFromDate, // "YYYY-MM-DD"
    pricePerLiter: Number(pricePerLiter),
    note: (note ?? "").trim()
  };

  await reqToPromise(store.put(item));
  await txDone(tx);
  return item;
}

export async function deletePricePeriod(db, id){
  const tx = db.transaction(STORE_PRICES, "readwrite");
  await reqToPromise(tx.objectStore(STORE_PRICES).delete(id));
  await txDone(tx);
}

export async function getPriceForDateTime(db, fuelType, dateTimeISO){
  const day = dateTimeISO.slice(0, 10); // "YYYY-MM-DD"
  const tx = db.transaction(STORE_PRICES, "readonly");
  const store = tx.objectStore(STORE_PRICES);
  const idx = store.index("fuelType_validFromDate");

  // Range: [fuelType, ""] .. [fuelType, day]
  const range = IDBKeyRange.bound([fuelType, ""], [fuelType, day]);
  // Open cursor descending to get last valid quickly
  const cursorReq = idx.openCursor(range, "prev");

  const result = await new Promise((resolve, reject) => {
    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) resolve(cursor.value);
      else resolve(null);
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });

  await txDone(tx);
  return result?.pricePerLiter ?? null;
}

/* Fillups */
export async function listFillups(db){
  const tx = db.transaction(STORE_FILLUPS, "readonly");
  const store = tx.objectStore(STORE_FILLUPS);
  const res = await reqToPromise(store.getAll());
  await txDone(tx);
  // newest first
  res.sort((a,b) => (b.dateTime || "").localeCompare(a.dateTime || ""));
  return res;
}

export async function addFillup(db, fillup){
  const tx = db.transaction(STORE_FILLUPS, "readwrite");
  await reqToPromise(tx.objectStore(STORE_FILLUPS).add(fillup));
  await txDone(tx);
  return fillup;
}

export async function deleteFillup(db, id){
  const tx = db.transaction(STORE_FILLUPS, "readwrite");
  await reqToPromise(tx.objectStore(STORE_FILLUPS).delete(id));
  await txDone(tx);
}

export async function wipeAll(db){
  const tx = db.transaction([STORE_VEHICLES, STORE_PRICES, STORE_FILLUPS], "readwrite");
  await reqToPromise(tx.objectStore(STORE_VEHICLES).clear());
  await reqToPromise(tx.objectStore(STORE_PRICES).clear());
  await reqToPromise(tx.objectStore(STORE_FILLUPS).clear());
  await txDone(tx);
}

/* Export/Import */
export async function exportAll(db){
  const [vehicles, pricePeriods, fillups] = await Promise.all([
    listVehicles(db),
    listPricePeriods(db),
    listFillups(db),
  ]);

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    vehicles,
    pricePeriods,
    fillups
  };
}

export async function importAllReplace(db, data){
  if (!data || data.schemaVersion !== 1) throw new Error("Unbekanntes Exportformat (schemaVersion).");

  // minimal validation
  const vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
  const pricePeriods = Array.isArray(data.pricePeriods) ? data.pricePeriods : [];
  const fillups = Array.isArray(data.fillups) ? data.fillups : [];

  const tx = db.transaction([STORE_VEHICLES, STORE_PRICES, STORE_FILLUPS], "readwrite");
  await reqToPromise(tx.objectStore(STORE_VEHICLES).clear());
  await reqToPromise(tx.objectStore(STORE_PRICES).clear());
  await reqToPromise(tx.objectStore(STORE_FILLUPS).clear());

  const vStore = tx.objectStore(STORE_VEHICLES);
  const pStore = tx.objectStore(STORE_PRICES);
  const fStore = tx.objectStore(STORE_FILLUPS);

  for (const v of vehicles) await reqToPromise(vStore.put(v));
  for (const p of pricePeriods) await reqToPromise(pStore.put(p));
  for (const f of fillups) await reqToPromise(fStore.put(f));

  await txDone(tx);
}
