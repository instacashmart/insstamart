import {
  GoogleAuthProvider,
  linkWithPopup,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "./firebase.js";
import "./profile-auth.css";

const profileStorageKey = "instacashmart.profile";
const nativeSetItem = Storage.prototype.setItem;
const googleProvider = new GoogleAuthProvider();
let activeUser;
let profileCard;
let profileStatus;
let profileButton;
let profileStatusState = "";
let applyingRemoteProfile = false;
let saveQueue = Promise.resolve();

function isProfileRoute() {
  return window.location.pathname.replace(/\/+$/, "") === "/profile";
}

function readLocalProfile() {
  const raw = localStorage.getItem(profileStorageKey);
  if (!raw) {
    return { name: "", phone: "", address: "" };
  }

  const profile = JSON.parse(raw);
  return {
    name: typeof profile.name === "string" ? profile.name : "",
    phone: typeof profile.phone === "string" ? profile.phone : "",
    address: typeof profile.address === "string" ? profile.address : "",
  };
}

function announce(state, message = "") {
  window.dispatchEvent(
    new CustomEvent("cashnova:profile-status", {
      detail: { state, message },
    }),
  );
}

function updateProfileStatus(state, message = "") {
  if (!profileStatus) {
    return;
  }
  profileStatusState = state;
  if (profileStatus.textContent !== message) {
    profileStatus.textContent = message;
  }
  if (profileStatus.dataset.state !== state) {
    profileStatus.dataset.state = state;
  }
}

function googleSignInError(error) {
  const code = error?.code;
  if (code === "auth/unauthorized-domain") {
    return `Google sign-in is blocked for ${window.location.hostname}. Add this domain to Firebase Authentication → Settings → Authorized domains, then try again.`;
  }
  if (code === "auth/operation-not-allowed") {
    return "Google sign-in is disabled for this Firebase project. Enable the Google provider in Firebase Authentication → Sign-in method.";
  }
  if (code === "auth/popup-blocked") {
    return "Your browser blocked the Google sign-in popup. Allow popups for this site and try again.";
  }
  if (code === "auth/popup-closed-by-user") {
    return "The Google sign-in window was closed before sign-in completed.";
  }
  if (
    code === "auth/credential-already-in-use" ||
    code === "auth/email-already-in-use"
  ) {
    return "This Google account already has an account. Sign in again to continue with that account.";
  }
  if (code === "auth/account-exists-with-different-credential") {
    return "An account already exists for this email with another sign-in method. Sign in with that method first.";
  }
  return error instanceof Error
    ? error.message
    : "Google sign-in failed. Please try again.";
}

async function saveProfile(user, profile) {
  if (!user || user.isAnonymous) {
    return;
  }

  await setDoc(
    doc(db, "userProfiles", user.uid),
    {
      uid: user.uid,
      email: user.email || "",
      name: profile.name || user.displayName || "",
      phone: profile.phone || "",
      address: profile.address || "",
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

function scheduleProfileSave(user, profile) {
  saveQueue = saveQueue
    .catch(() => {})
    .then(() => saveProfile(user, profile));
  announce("saving", "Saving profile to Firestore...");

  saveQueue.then(
    () => announce("saved", "Profile saved to Firestore."),
    (error) => {
      console.error("Unable to save the profile to Firestore.", error);
      announce(
        "error",
        "Could not save your profile to Firestore. Check the userProfiles rule and your connection.",
      );
    },
  );
}

function restoreRemoteProfile(user) {
  if (!user || user.isAnonymous) {
    return;
  }

  getDoc(doc(db, "userProfiles", user.uid)).then(async (snapshot) => {
    if (auth.currentUser?.uid !== user.uid) {
      return;
    }

    if (snapshot.exists()) {
      const saved = snapshot.data();
      const profile = {
        name: typeof saved.name === "string" ? saved.name : user.displayName || "",
        phone: typeof saved.phone === "string" ? saved.phone : "",
        address: typeof saved.address === "string" ? saved.address : "",
      };
      if (JSON.stringify(readLocalProfile()) !== JSON.stringify(profile)) {
        applyingRemoteProfile = true;
        try {
          nativeSetItem.call(localStorage, profileStorageKey, JSON.stringify(profile));
        } finally {
          applyingRemoteProfile = false;
        }
        if (isProfileRoute()) {
          window.location.reload();
        }
      }
      return;
    }

    const localProfile = readLocalProfile();
    const profile = {
      ...localProfile,
      name: localProfile.name || user.displayName || "",
    };
    applyingRemoteProfile = true;
    try {
      nativeSetItem.call(localStorage, profileStorageKey, JSON.stringify(profile));
    } finally {
      applyingRemoteProfile = false;
    }
    await saveProfile(user, profile);
    if (isProfileRoute()) {
      window.location.reload();
    }
  }).catch((error) => {
    console.error("Unable to load the profile from Firestore.", error);
    announce(
      "error",
      "Could not load your profile from Firestore. Check the userProfiles rule and your connection.",
    );
  });
}

function renderProfileCard() {
  if (!isProfileRoute()) {
    profileCard?.remove();
    return;
  }

  const heading = [...document.querySelectorAll("main h1")].find(
    (element) => element.textContent.trim() === "Your Profile",
  );
  const profileSection = heading?.closest("section");
  if (!profileSection) {
    return;
  }

  if (!profileCard) {
    profileCard = document.createElement("section");
    profileCard.className = "profile-google-card";

    const content = document.createElement("div");
    content.className = "profile-google-content";

    const title = document.createElement("h2");
    title.textContent = "Google account";

    profileStatus = document.createElement("p");
    profileStatus.className = "profile-google-status";
    profileStatus.setAttribute("role", "status");
    profileStatus.setAttribute("aria-live", "polite");

    profileButton = document.createElement("button");
    profileButton.type = "button";
    profileButton.className = "profile-google-button";
    profileButton.addEventListener("click", async () => {
      profileButton.disabled = true;
      if (activeUser && !activeUser.isAnonymous) {
        try {
          await signOut(auth);
          updateProfileStatus("success", "Signed out of your Google account.");
        } catch (error) {
          console.error("Google profile sign-out failed.", error);
          updateProfileStatus("error", "Could not sign out. Please try again.");
        } finally {
          profileButton.disabled = false;
        }
        return;
      }

      updateProfileStatus("loading", "Connecting to Google...");
      try {
        let result;
        if (auth.currentUser?.isAnonymous) {
          try {
            result = await linkWithPopup(auth.currentUser, googleProvider);
          } catch (error) {
            if (
              error?.code !== "auth/credential-already-in-use" &&
              error?.code !== "auth/email-already-in-use"
            ) {
              throw error;
            }
            result = await signInWithPopup(auth, googleProvider);
          }
        } else {
          result = await signInWithPopup(auth, googleProvider);
        }
        const profile = readLocalProfile();
        const updatedProfile = {
          ...profile,
          name: profile.name || result.user.displayName || "",
        };
        applyingRemoteProfile = true;
        try {
          nativeSetItem.call(
            localStorage,
            profileStorageKey,
            JSON.stringify(updatedProfile),
          );
        } finally {
          applyingRemoteProfile = false;
        }
        await saveProfile(result.user, updatedProfile);
        updateProfileStatus(
          "success",
          `Signed in as ${result.user.email || "your Google account"}. Profile saved to Firestore.`,
        );
        if (isProfileRoute()) {
          window.location.reload();
        }
      } catch (error) {
        console.error("Google profile sign-in failed.", error);
        updateProfileStatus(
          "error",
          googleSignInError(error),
        );
      } finally {
        if (profileButton?.isConnected) {
          profileButton.disabled = false;
        }
      }
    });

    content.append(title, profileStatus, profileButton);
    profileCard.append(content);
  }

  const buttonLabel = activeUser && !activeUser.isAnonymous
    ? "Sign out of Google"
    : "Continue with Google";
  if (profileButton.textContent !== buttonLabel) {
    profileButton.textContent = buttonLabel;
  }

  if (profileCard.parentElement !== profileSection.parentElement) {
    profileSection.parentElement.insertBefore(profileCard, profileSection);
  }

  if (!["error", "loading", "saving"].includes(profileStatusState)) {
    if (!activeUser) {
      updateProfileStatus("info", "Sign in to sync your profile across devices.");
    } else if (activeUser.isAnonymous) {
      updateProfileStatus("info", "Your profile is not linked to Google yet.");
    } else {
      updateProfileStatus(
        "success",
        `Signed in as ${activeUser.email || "your Google account"}.`,
      );
    }
  }
}

const previousSetItem = Storage.prototype.setItem;
Storage.prototype.setItem = function (key, value) {
  previousSetItem.call(this, key, value);

  if (
    this !== localStorage ||
    String(key) !== profileStorageKey ||
    applyingRemoteProfile ||
    !auth.currentUser ||
    auth.currentUser.isAnonymous
  ) {
    return;
  }

  try {
    scheduleProfileSave(auth.currentUser, JSON.parse(String(value)));
  } catch (error) {
    console.error("Unable to prepare profile data for Firestore.", error);
    announce("error", "Could not read the profile data for Firestore.");
  }
};

window.addEventListener("cashnova:profile-status", (event) => {
  updateProfileStatus(event.detail?.state || "", event.detail?.message || "");
});

onAuthStateChanged(auth, (user) => {
  activeUser = user;
  profileStatusState = "";
  renderProfileCard();
  if (user && !user.isAnonymous) {
    restoreRemoteProfile(user);
  }
});

const observer = new MutationObserver(renderProfileCard);
observer.observe(document.body, { childList: true, subtree: true });

window.addEventListener("popstate", renderProfileCard);
for (const method of ["pushState", "replaceState"]) {
  const original = window.history[method].bind(window.history);
  window.history[method] = (...args) => {
    const result = original(...args);
    renderProfileCard();
    return result;
  };
}
