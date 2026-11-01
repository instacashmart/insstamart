import "./admin-auth.css";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { defaultAdminConfig } from "./firebase-config.js";
import { auth } from "./firebase.js";

const adminEmail =
  import.meta.env.VITE_FIREBASE_ADMIN_EMAIL || defaultAdminConfig.email;
const adminUid =
  import.meta.env.VITE_FIREBASE_ADMIN_UID || defaultAdminConfig.uid;
const adminPath = "/admin";

let authReady = false;
let currentUser = null;
let authError = "";
let gate;

function isAdminRoute() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path === adminPath || path.startsWith(`${adminPath}/`);
}

function createGate() {
  const overlay = document.createElement("section");
  overlay.className = "admin-auth-gate";
  overlay.setAttribute("aria-label", "Admin sign-in");

  const card = document.createElement("div");
  card.className = "admin-auth-card";

  const heading = document.createElement("h1");
  heading.textContent = "Admin sign in";

  const description = document.createElement("p");
  description.textContent =
    "Sign in with your authorized administrator account to continue.";

  const status = document.createElement("p");
  status.className = "admin-auth-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const form = document.createElement("form");
  form.hidden = true;

  const emailLabel = document.createElement("label");
  emailLabel.htmlFor = "admin-auth-email";
  emailLabel.textContent = "Email";

  const email = document.createElement("input");
  email.id = "admin-auth-email";
  email.name = "email";
  email.type = "email";
  email.autocomplete = "username";
  email.required = true;
  email.value = adminEmail;

  const passwordLabel = document.createElement("label");
  passwordLabel.htmlFor = "admin-auth-password";
  passwordLabel.textContent = "Password";

  const password = document.createElement("input");
  password.id = "admin-auth-password";
  password.name = "password";
  password.type = "password";
  password.autocomplete = "current-password";
  password.required = true;

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Sign in";

  const error = document.createElement("p");
  error.className = "admin-auth-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  form.append(emailLabel, email, passwordLabel, password, submit, error);
  card.append(heading, description, status, form);
  overlay.append(card);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    submit.textContent = "Signing in...";

    try {
      const credential = await signInWithEmailAndPassword(
        auth,
        email.value.trim(),
        password.value,
      );

      if (credential.user.uid !== adminUid) {
        await signOut(auth);
        throw new Error("This account is not authorized to access the admin page.");
      }

      password.value = "";
    } catch (cause) {
      error.textContent =
        cause instanceof Error
          ? cause.message
          : "Sign-in failed. Check your connection and try again.";
      error.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = "Sign in";
    }
  });

  return { overlay, status, form, error };
}

function renderGate() {
  if (!isAdminRoute()) {
    gate?.overlay.remove();
    return;
  }

  if (currentUser?.uid === adminUid) {
    gate?.overlay.remove();
    return;
  }

  if (!gate) {
    gate = createGate();
  }

  if (!gate.overlay.isConnected) {
    document.body.append(gate.overlay);
  }

  gate.status.textContent = authReady
    ? ""
    : "Checking administrator access...";
  gate.form.hidden = !authReady;
  gate.error.hidden = !authError;
  gate.error.textContent = authError;
}

onAuthStateChanged(auth, (user) => {
  authReady = true;
  authError = "";

  if (user && user.uid !== adminUid) {
    currentUser = null;
    authError = "This account is not authorized to access the admin page.";
    signOut(auth).catch((cause) => {
      console.error("Could not sign out the unauthorized admin account.", cause);
    });
  } else {
    currentUser = user;
  }

  renderGate();
});

for (const method of ["pushState", "replaceState"]) {
  const original = window.history[method].bind(window.history);
  window.history[method] = (...args) => {
    const result = original(...args);
    renderGate();
    return result;
  };
}

window.addEventListener("popstate", renderGate);
renderGate();
