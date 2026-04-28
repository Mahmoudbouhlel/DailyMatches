# Flashscore Prediction Studio

Modern React + TypeScript dashboard for the `flashscore_scraper` MariaDB database.

## Run

```bash
npm install
npm run dev
```

The web app runs on `http://localhost:5173` and the API runs on `http://localhost:4000`.

## Database

The app is configured for:

```env
DB_HOST=127.0.0.1
DB_USER=root
DB_PASSWORD=
DB_NAME=flashscore_scraper
```

Import `C:/Users/mahmoud/Downloads/flashscore_scraper.sql` into MariaDB or phpMyAdmin using the database name `flashscore_scraper`.

Main API routes:

- `GET /api/summary`
- `GET /api/picks`
- `GET /api/matches`
- `GET /api/league-performance`
- `GET /api/timeline`
- `GET /api/filters`
- `GET /api/history`
- `GET /api/history-summary`
