# InstaCashMart

This Vite project runs the React application contained in the supplied standalone HTML export. The export included a compiled React bundle rather than the original JSX source; `public/app.js` preserves that bundle, and `src/styles.css` contains its extracted styles.

## Run locally

```sh
npm install
npm run dev
```

Create a production build with `npm run build`.

## Pages and hosting

Every page has its own URL, for example `/faqs`, `/why-us`, `/gadgets`, `/trending-devices`, `/popular-accessories` and `/admin`. Each admin section is a page too: `/admin/sell`, `/admin/buy`, `/admin/products`, `/admin/models`, `/admin/popular`, `/admin/trending`, `/admin/feedback`, `/admin/reviews`, `/admin/bikes`, `/admin/cars`, `/admin/vehicles` and `/admin/vehicle-leads`. Old `/#/page` links redirect to the new URLs.

`npm run dev` and `npm run preview` handle these URLs automatically. The production host must serve `index.html` for any path that is not a real file, otherwise opening `/admin` directly returns a 404:

- **Firebase Hosting**: in `firebase.json`, set `"rewrites": [{ "source": "**", "destination": "/index.html" }]`
- **Netlify**: create `public/_redirects` containing `/* /index.html 200`
- **Vercel**: in `vercel.json`, set `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`

## Firebase

Firebase configuration is loaded from `.env`. Copy `.env.example` to `.env` and fill in the Firebase web app values. These `VITE_` variables are included in the client bundle, so Firebase API keys should be restricted to your deployed domains and Firebase security rules must protect your data.

Firebase configuration is loaded from `.env` when provided and falls back to the Firebase web app configuration in `src/firebase-config.js`, so Vercel builds work without environment variables. Set `VITE_FIREBASE_*` variables in Vercel to override these defaults if needed.

The `/admin` and `/admin/*` pages require Firebase email/password sign-in with `instacashmart@gmail.com` and the configured admin UID. Enable Email/Password in Firebase Authentication and ensure this account's UID is `1BMeS4vGMDPBXRmYBVNSNvR3ByM2`.

The app stores admin-managed catalog data and public submissions in Firestore under `appData/{dataset}/items/{documentId}`. Public submissions use Firebase Authentication; enable the Anonymous provider for guest submissions. The Profile page also supports Google sign-in and syncs contact details to `userProfiles/{uid}`. Enable the Google provider and add your Vercel domain to Firebase Authentication's authorized domains. Publish the current `firestore.rules` in Firebase Console under **Firestore Database → Rules**; users can only read or update their own profile, while only the admin UID can read private submissions or edit/delete dataset records. If rules or authentication are not enabled, the app displays a Firestore error instead of silently reporting a successful cloud save.

For Google sign-in, Firebase Authentication → Settings → Authorized domains must include each deployed hostname you use, such as `insstamart.vercel.app` and `insstamart-bx5p.vercel.app`. Firebase blocks Google OAuth for unlisted domains; this allowlist is configured in the Firebase Console and cannot be changed by Vercel deployment settings.
