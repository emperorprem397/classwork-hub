// Firebase + Cloudinary config — loaded via CDN, no npm install needed.
// This file is imported by other page scripts (auth.js, dashboard.js, etc.)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Cloudinary — free image storage/CDN, replaces Firebase Storage entirely.
// Uploads go browser → Cloudinary directly (unsigned preset), no backend needed.
export const CLOUDINARY_CLOUD_NAME = "mp6thjog";
export const CLOUDINARY_UPLOAD_PRESET = "classwork_hub_unsigned";

const firebaseConfig = {
  apiKey: "AIzaSyAGTm2APrJKpufnCCp3oOeL4oMmOBgntlA",
  authDomain: "classwork-hub.firebaseapp.com",
  projectId: "classwork-hub",
  storageBucket: "classwork-hub.firebasestorage.app",
  messagingSenderId: "487906365721",
  appId: "1:487906365721:web:1c5d769ab9cf43e5a33588"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);

// Ensure auth state persists across page reloads and sign-out/sign-in cycles.
// This is critical for redirect-based auth to work reliably.
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("Failed to set persistence:", err);
  // If persistence fails, auth still works, just won't survive a page reload.
  // This is rare and mostly affects older/private browsers.
});
