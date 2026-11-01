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

Firebase configuration is available in `.env` for future integrations. The current compiled application does not initialize Firebase Authentication or sync application data to Firestore.
