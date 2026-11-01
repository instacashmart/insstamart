import assert from "node:assert/strict";
import test from "node:test";
import { defaultAdminConfig, defaultFirebaseConfig } from "../src/firebase-config.js";

test("Firebase configuration defaults support builds without Vercel environment variables", () => {
  for (const key of [
    "apiKey",
    "authDomain",
    "projectId",
    "storageBucket",
    "messagingSenderId",
    "appId",
  ]) {
    assert.ok(defaultFirebaseConfig[key], `Firebase ${key} is configured`);
  }
});

test("admin defaults identify the configured Firebase administrator", () => {
  assert.equal(defaultAdminConfig.email, "instacashmart@gmail.com");
  assert.equal(defaultAdminConfig.uid, "1BMeS4vGMDPBXRmYBVNSNvR3ByM2");
});
