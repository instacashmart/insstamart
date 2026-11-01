import { onAuthStateChanged } from "firebase/auth";
import "./admin-auth.js";
import { auth } from "./firebase.js";
import {
  startFirestoreDataSync,
  stopFirestoreDataSync,
} from "./firestore-data.js";

let appStartPromise;
let syncingUser = null;

function startApp() {
  if (!appStartPromise) {
    appStartPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.type = "module";
      script.src = "/app.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Unable to load the application bundle."));
      document.body.append(script);
    }).catch((error) => {
      appStartPromise = null;
      throw error;
    });
  }
  return appStartPromise;
}

onAuthStateChanged(auth, async (user) => {
  const adminUid = import.meta.env.VITE_FIREBASE_ADMIN_UID;
  if (!user || user.uid !== adminUid) {
    stopFirestoreDataSync();
    emitFirestoreStatus("signed-out");
    await startApp();
    return;
  }

  if (syncingUser === user.uid) {
    return;
  }

  syncingUser = user.uid;
  try {
    await startFirestoreDataSync();
    emitFirestoreStatus("ready");
  } catch (error) {
    console.error("Unable to load application data from Firestore.", error);
    emitFirestoreStatus(
      "error",
      "Could not load Firestore data. Check your internet connection and Firestore rules, then reload the page.",
    );
  } finally {
    syncingUser = null;
    await startApp();
  }
});

function emitFirestoreStatus(state, message = "") {
  window.dispatchEvent(
    new CustomEvent("cashnova:firestore-status", {
      detail: { state, message },
    }),
  );
}
