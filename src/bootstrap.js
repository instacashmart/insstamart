import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { defaultAdminConfig } from "./firebase-config.js";
import { auth } from "./firebase.js";
import {
  startAdminFirestoreSync,
  startPublicFirestoreSync,
  stopFirestoreSync,
} from "./firestore-data.js";
import "./admin-auth.js";

const adminUid =
  import.meta.env.VITE_FIREBASE_ADMIN_UID || defaultAdminConfig.uid;
const adminPath = "/admin";
let activeUserId;
let appStartPromise;

function isAdminRoute() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path === adminPath || path.startsWith(`${adminPath}/`);
}

function emitStatus(state, message = "") {
  window.dispatchEvent(
    new CustomEvent("cashnova:firestore-status", {
      detail: { state, message },
    }),
  );
}

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
      appStartPromise = undefined;
      throw error;
    });
  }
  return appStartPromise;
}

void startApp().catch((error) => {
  console.error("Unable to load the application.", error);
  emitStatus("error", "Unable to load the application. Refresh the page and try again.");
});

async function loadAppAfterSync(sync) {
  try {
    await sync();
  } catch (error) {
    console.error("Unable to sync application data with Firestore.", error);
    emitStatus(
      "error",
      "Firestore sync failed. Check Firebase Authentication, Firestore rules, and your connection. New data may not be saved.",
    );
  }
  await startApp();
}

onAuthStateChanged(auth, async (user) => {
  const nextUserId = user?.uid || null;
  if (activeUserId === nextUserId) {
    return;
  }
  activeUserId = nextUserId;

  if (user?.uid === adminUid) {
    await loadAppAfterSync(startAdminFirestoreSync);
    return;
  }

  stopFirestoreSync();
  if (isAdminRoute()) {
    emitStatus("signed-out");
    await startApp();
    return;
  }

  if (user) {
    await loadAppAfterSync(startPublicFirestoreSync);
    return;
  }

  try {
    await signInAnonymously(auth);
  } catch (error) {
    console.error("Unable to create an anonymous Firebase session.", error);
    emitStatus(
      "error",
      "Could not connect to Firebase. Enable Anonymous sign-in in Firebase Authentication; form data may not be saved.",
    );
    await startApp();
  }
});
