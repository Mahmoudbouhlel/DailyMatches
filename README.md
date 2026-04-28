# Flashscore Prediction Studio

Modern React + TypeScript dashboard for the Flashscore prediction tables in Supabase.

## Run

```bash
npm install
npm run dev
```

The web app runs on `http://localhost:5173` and the API runs on `http://localhost:4000`.

## Database

The app is configured for Supabase:

```env
NEXT_PUBLIC_SUPABASE_URL=https://kbmpqjogsspbnygbhnbq.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
```

Create or import these tables in Supabase:

- `prediction_daily_betslip`
- `history_daily_d`
- `matches`

Main API routes:

- `GET /api/summary`
- `GET /api/picks`
- `GET /api/matches`
- `GET /api/league-performance`
- `GET /api/timeline`
- `GET /api/filters`
- `GET /api/history`
- `GET /api/history-summary`
