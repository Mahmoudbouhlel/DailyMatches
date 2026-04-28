# Flashscore Prediction Studio

Modern React + TypeScript dashboard for the Aiven MySQL Flashscore database.

## Run

```bash
npm install
npm run dev
```

The web app runs on `http://localhost:5173` and the API runs on `http://localhost:4000`.

## Database

For Aiven MySQL, configure these variables locally and in Vercel:

```env
DB_HOST=mysql-22471e8b-episousse-2832.a.aivencloud.com
DB_PORT=25465
DB_USER=avnadmin
DB_PASSWORD=your_revealed_aiven_password
DB_NAME=defaultdb
DB_SSL=required
```

In Vercel, add them in **Project Settings -> Environment Variables**, then redeploy.

Aiven requires SSL. The API enables SSL when `DB_SSL=required`.
If your deployment reports certificate verification errors, copy the Aiven **CA certificate** and add:

```env
DB_CA_CERT=-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----
```

Import your SQL tables into Aiven's `defaultdb` database before deploying.

Main API routes:

- `GET /api/summary`
- `GET /api/picks`
- `GET /api/matches`
- `GET /api/league-performance`
- `GET /api/timeline`
- `GET /api/filters`
- `GET /api/history`
- `GET /api/history-summary`
