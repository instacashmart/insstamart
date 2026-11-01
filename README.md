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

The Firestore client is exported as `db` from `src/firebase.js`. The `firestore.rules` file restricts reads and writes to the authenticated Firebase user with the configured admin UID. Publish these rules in Firebase Console under **Firestore Database → Rules**. The app must also sign in that user with Firebase Authentication before Firestore requests will be allowed; initializing Firestore alone does not sign in or grant access.

The `/admin` route requires Firebase email/password sign-in. Set `VITE_FIREBASE_ADMIN_EMAIL` and `VITE_FIREBASE_ADMIN_UID` in `.env`, enable the Email/Password provider in Firebase Authentication, and ensure the account's UID matches the configured UID and `firestore.rules`. The UID identifies the account; the account password is entered on the admin sign-in page and is never stored in `.env`.

When the admin signs in, the app loads the admin datasets from Firestore, imports existing local browser data only when a Firestore collection is empty, and syncs subsequent admin changes to Firestore. Data is stored under `appData/{dataset}/items/{itemId}`. Publish the current `firestore.rules` before using this sync. Public visitor submissions remain local because the rules intentionally allow writes only from the admin account.
