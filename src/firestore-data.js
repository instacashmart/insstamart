import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
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
const originalSetItem = Storage.prototype.setItem;
const pendingWrites = new Map();
const subscriptions = [];
let remoteSnapshot = false;
let persistenceReady = false;

function emitStatus(state, message = "") {
  window.dispatchEvent(
    new CustomEvent("cashnova:firestore-status", {
      detail: { state, message },
    }),
  );
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
    .sort((left, right) => left.position - right.position)
    .map((item) => item.value);
}

async function writeDataset(dataset, values) {
  const target = collection(db, "appData", dataset, "items");
  const existing = await getDocs(target);
  const user = auth.currentUser;
  if (!user) {
    throw new Error("An authenticated admin is required to save Firestore data.");
  }

  const operations = values.map((value, position) => ({
    ref: doc(target, String(position).padStart(10, "0")),
    value: {
      position,
      value,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    },
  }));

  existing.docs.forEach((item) => {
    if (Number(item.id) >= values.length) {
      operations.push({ ref: item.ref, value: null });
    }
  });

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

function queueDatasetWrite(dataset, values) {
  const previous = pendingWrites.get(dataset) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => writeDataset(dataset, values));
  pendingWrites.set(dataset, next);

  next.then(
    () => {
      if (pendingWrites.get(dataset) === next) {
        pendingWrites.delete(dataset);
      }
      if (pendingWrites.size === 0) {
        emitStatus("ready");
      }
    },
    (error) => {
      if (pendingWrites.get(dataset) === next) {
        pendingWrites.delete(dataset);
      }
      console.error(`Unable to save ${dataset} data to Firestore.`, error);
      emitStatus(
        "error",
        `Could not save ${dataset} data to Firestore. Check your connection and Firestore rules, then save again.`,
      );
    },
  );
}

function applySnapshot(dataset, snapshot) {
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
  Storage.prototype.setItem = function (key, value) {
    originalSetItem.call(this, key, value);

    if (this !== localStorage || remoteSnapshot || !persistenceReady) {
      return;
    }

    const dataset = datasetForStorageKey.get(String(key));
    if (!dataset) {
      return;
    }

    try {
      const items = JSON.parse(String(value));
      if (!Array.isArray(items)) {
        throw new Error(`Local data for ${key} is not an array.`);
      }
      queueDatasetWrite(dataset, items);
    } catch (error) {
      console.error(`Unable to prepare ${dataset} data for Firestore.`, error);
      emitStatus(
        "error",
        `Could not save ${dataset} data to Firestore. The saved data is invalid.`,
      );
    }
  };
}

export async function startFirestoreDataSync() {
  emitStatus("connecting");

  for (const [dataset, storageKey] of Object.entries(datasets)) {
    const target = collection(db, "appData", dataset, "items");
    const snapshot = await getDocs(target);

    if (snapshot.empty) {
      const localItems = readLocalItems(storageKey);
      if (localItems?.length) {
        await writeDataset(dataset, localItems);
      }
    } else {
      applySnapshot(dataset, snapshot);
    }
  }

  for (const dataset of Object.keys(datasets)) {
    const target = collection(db, "appData", dataset, "items");
    subscriptions.push(
      onSnapshot(
        target,
        (snapshot) => applySnapshot(dataset, snapshot),
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

  installStorageSync();
  persistenceReady = true;
  emitStatus("ready");
}

export function stopFirestoreDataSync() {
  persistenceReady = false;
  for (const unsubscribe of subscriptions.splice(0)) {
    unsubscribe();
  }
}
