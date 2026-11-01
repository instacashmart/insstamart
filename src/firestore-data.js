import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { defaultAdminConfig } from "./firebase-config.js";
import { auth, db } from "./firebase.js";

const datasets = {
  sell: "cashnova.sellOrders",
  buy: "cashnova.buyOrders",
  products: "cashnova.products",
  trending: "cashnova.trendingDevices",
  popular: "cashnova.popularAccessories",
  feedback: "cashnova.feedback",
  reviews: "cashnova.reviews",
  sellModels: "cashnova.sellModels",
  vehicles: "cashnova.vehicles",
  vehicleLeads: "cashnova.vehicleLeads",
  vehicleProducts: "cashnova.vehicleProducts",
};
const datasetForStorageKey = new Map(
  Object.entries(datasets).map(([dataset, storageKey]) => [storageKey, dataset]),
);
const publicSubmissionDatasets = new Set([
  "sell",
  "buy",
  "feedback",
  "reviews",
  "vehicles",
  "vehicleLeads",
]);
const publicCatalogDatasets = new Set([
  "products",
  "trending",
  "popular",
  "sellModels",
  "vehicleProducts",
]);
const adminUid =
  import.meta.env.VITE_FIREBASE_ADMIN_UID || defaultAdminConfig.uid;
const originalSetItem = Storage.prototype.setItem;
const pendingWrites = new Map();
const subscriptions = [];
let remoteSnapshot = false;
let persistenceReady = false;
let storageSyncInstalled = false;
let notice;
let noticeTimer;

function emitStatus(state, message = "") {
  window.dispatchEvent(
    new CustomEvent("cashnova:firestore-status", {
      detail: { state, message },
    }),
  );
  renderNotice(state, message);
}

function renderNotice(state, message) {
  if (state === "signed-out" || (state === "ready" && !pendingWrites.size)) {
    if (state === "ready" && pendingWrites.size) {
      return;
    }
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = undefined;
    }
    notice?.remove();
    return;
  }

  if (!notice) {
    notice = document.createElement("p");
    notice.className = "firestore-sync-notice";
    notice.setAttribute("role", state === "error" ? "alert" : "status");
    notice.setAttribute("aria-live", "polite");
  }

  notice.textContent =
    state === "error"
      ? message
      : state === "saving"
        ? "Saving data to Firestore..."
        : state === "saved"
          ? "Data saved to Firestore."
          : "Connecting to Firestore...";
  if (!notice.isConnected) {
    document.body.append(notice);
  }

  if (state === "saved") {
    noticeTimer = setTimeout(() => notice?.remove(), 3000);
  } else if (noticeTimer) {
    clearTimeout(noticeTimer);
    noticeTimer = undefined;
  }
}

function notifyStorageChanged() {
  window.dispatchEvent(new Event("cashnova:change"));
}

function readLocalItems(storageKey) {
  const raw = localStorage.getItem(storageKey);
  if (raw === null) {
    return null;
  }

  const items = JSON.parse(raw);
  if (!Array.isArray(items)) {
    throw new Error(`Local data for ${storageKey} is not an array.`);
  }
  return items;
}

function itemsFromSnapshot(snapshot) {
  return snapshot.docs
    .map((item) => item.data())
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
    .map((item) => item.value);
}

function itemDocumentId(item, index) {
  const id = typeof item?.id === "string" ? item.id.trim() : "";
  return id && !id.includes("/") && id.length < 1200
    ? encodeURIComponent(id)
    : `item-${index}`;
}

function localSyncedIdsKey(dataset) {
  return `cashnova.firestore.synced.${dataset}`;
}

function getLocalSyncedIds(dataset) {
  try {
    const parsed = JSON.parse(localStorage.getItem(localSyncedIdsKey(dataset)) || "[]");
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (error) {
    console.error(`Unable to read Firestore sync state for ${dataset}.`, error);
    return new Set();
  }
}

function saveLocalSyncedIds(dataset, ids) {
  originalSetItem.call(
    localStorage,
    localSyncedIdsKey(dataset),
    JSON.stringify([...ids]),
  );
}

async function writeAdminDataset(dataset, values) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Sign in as the administrator before saving Firestore data.");
  }

  const target = collection(db, "appData", dataset, "items");
  const existing = await getDocs(target);
  const existingById = new Map(existing.docs.map((item) => [item.id, item]));
  const seen = new Set();
  const operations = [];

  values.forEach((value, position) => {
    const id = itemDocumentId(value, position);
    if (seen.has(id)) {
      throw new Error(`The ${dataset} data contains duplicate item IDs.`);
    }
    seen.add(id);
    operations.push({
      ref: doc(target, id),
      value: {
        position,
        value,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      },
    });
  });

  for (const [id, item] of existingById) {
    if (!seen.has(id)) {
      operations.push({ ref: item.ref, value: null });
    }
  }

  for (let offset = 0; offset < operations.length; offset += 450) {
    const batch = writeBatch(db);
    for (const operation of operations.slice(offset, offset + 450)) {
      if (operation.value) {
        batch.set(operation.ref, operation.value);
      } else {
        batch.delete(operation.ref);
      }
    }
    await batch.commit();
  }
}

async function writePublicSubmissions(dataset, values, previousValues) {
  const user = auth.currentUser;
  if (!user || user.uid === adminUid) {
    throw new Error("Sign in to submit data to Firestore.");
  }

  const previousIds = new Set(
    previousValues.map((item) => (typeof item?.id === "string" ? item.id : "")),
  );
  const syncedIds = getLocalSyncedIds(dataset);
  const newItems = values.filter(
    (item) =>
      typeof item?.id === "string" &&
      !previousIds.has(item.id) &&
      !syncedIds.has(item.id),
  );

  if (!newItems.length) {
    return;
  }

  const target = collection(db, "appData", dataset, "items");
  for (let index = 0; index < newItems.length; index += 1) {
    const item = newItems[index];
    const record = await addDoc(target, {
      position: -Date.now() - index,
      value: item,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    });
    syncedIds.add(item.id);
    saveLocalSyncedIds(dataset, syncedIds);
    if (!record.id) {
      throw new Error(`Firestore did not confirm the ${dataset} submission.`);
    }
  }
}

function queueDatasetWrite(dataset, values, previousValues) {
  const previous = pendingWrites.get(dataset) || Promise.resolve();
  const isAdmin = auth.currentUser?.uid === adminUid;
  const next = previous
    .catch(() => {})
    .then(() =>
      isAdmin
        ? writeAdminDataset(dataset, values)
        : publicSubmissionDatasets.has(dataset)
          ? writePublicSubmissions(dataset, values, previousValues)
          : Promise.reject(
              new Error("Only the administrator can change this Firestore data."),
            ),
    );
  pendingWrites.set(dataset, next);
  emitStatus("saving");

  next.then(
    () => {
      if (pendingWrites.get(dataset) === next) {
        pendingWrites.delete(dataset);
      }
      if (!pendingWrites.size) {
        emitStatus("saved");
      }
    },
    (error) => {
      if (pendingWrites.get(dataset) === next) {
        pendingWrites.delete(dataset);
      }
      console.error(`Unable to save ${dataset} data to Firestore.`, error);
      emitStatus(
        "error",
        `Could not save ${dataset} data to Firestore. Check Firebase Authentication, Firestore rules, and your connection, then try again.`,
      );
    },
  );
}

function applySnapshot(dataset, snapshot, preserveLocalWhenEmpty = false) {
  if (preserveLocalWhenEmpty && snapshot.empty) {
    return;
  }

  const storageKey = datasets[dataset];
  const serialized = JSON.stringify(itemsFromSnapshot(snapshot));
  if (localStorage.getItem(storageKey) === serialized) {
    return;
  }

  remoteSnapshot = true;
  try {
    originalSetItem.call(localStorage, storageKey, serialized);
  } finally {
    remoteSnapshot = false;
  }
  notifyStorageChanged();
}

function installStorageSync() {
  if (storageSyncInstalled) {
    return;
  }
  storageSyncInstalled = true;

  Storage.prototype.setItem = function (key, value) {
    const storageKey = String(key);
    const previousValue =
      this === localStorage ? this.getItem(storageKey) : null;
    originalSetItem.call(this, key, value);

    if (this !== localStorage || remoteSnapshot || !persistenceReady) {
      return;
    }

    const dataset = datasetForStorageKey.get(storageKey);
    if (!dataset) {
      return;
    }

    try {
      const items = JSON.parse(String(value));
      const previousItems = previousValue ? JSON.parse(previousValue) : [];
      if (!Array.isArray(items) || !Array.isArray(previousItems)) {
        throw new Error(`Local data for ${storageKey} is not an array.`);
      }
      queueDatasetWrite(dataset, items, previousItems);
    } catch (error) {
      console.error(`Unable to prepare ${dataset} data for Firestore.`, error);
      emitStatus(
        "error",
        `Could not save ${dataset} data to Firestore. The saved data is invalid.`,
      );
    }
  };
}

function watchDataset(dataset, preserveLocalWhenEmpty = false) {
  const target = collection(db, "appData", dataset, "items");
  subscriptions.push(
    onSnapshot(
      target,
      (snapshot) => applySnapshot(dataset, snapshot, preserveLocalWhenEmpty),
      (error) => {
        console.error(`Firestore stopped syncing ${dataset} data.`, error);
        emitStatus(
          "error",
          `Firestore stopped syncing ${dataset} data. Check your connection and Firestore rules.`,
        );
      },
    ),
  );
}

export async function startAdminFirestoreSync() {
  emitStatus("connecting");

  for (const [dataset, storageKey] of Object.entries(datasets)) {
    const target = collection(db, "appData", dataset, "items");
    const snapshot = await getDocs(target);

    if (snapshot.empty) {
      const localItems = readLocalItems(storageKey);
      if (localItems?.length) {
        await writeAdminDataset(dataset, localItems);
      }
    } else {
      applySnapshot(dataset, snapshot);
    }
  }

  for (const dataset of Object.keys(datasets)) {
    watchDataset(dataset);
  }

  installStorageSync();
  persistenceReady = true;
  emitStatus("ready");
}

export async function startPublicFirestoreSync() {
  installStorageSync();
  persistenceReady = true;

  for (const dataset of publicCatalogDatasets) {
    const target = collection(db, "appData", dataset, "items");
    const snapshot = await getDocs(target);
    if (!snapshot.empty) {
      applySnapshot(dataset, snapshot);
    }
    watchDataset(dataset, true);
  }

  for (const dataset of publicSubmissionDatasets) {
    const localItems = readLocalItems(datasets[dataset]) || [];
    if (localItems.length) {
      await writePublicSubmissions(dataset, localItems, []);
    }
  }

  emitStatus("ready");
}

export function stopFirestoreSync() {
  persistenceReady = false;
  for (const unsubscribe of subscriptions.splice(0)) {
    unsubscribe();
  }
  emitStatus("signed-out");
}
