import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import mysql from "mysql2/promise";

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json());

const sslMode = (process.env.DB_SSL ?? "").toLowerCase();
const sslEnabled = ["true", "1", "required", "require"].includes(sslMode);
const caCertificate = process.env.DB_CA_CERT?.replace(/\\n/g, "\n");

const pool = mysql.createPool({
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "flashscore_scraper",
  ssl: sslEnabled
    ? {
        ca: caCertificate,
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false",
      }
    : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});

type QueryParams = Record<string, string | number | null>;

async function query<T>(sql: string, params: QueryParams = {}) {
  const [rows] = await pool.execute(sql, params);
  return rows as T[];
}

function getFilters(request: express.Request) {
  const country = typeof request.query.country === "string" ? request.query.country : null;
  const market = typeof request.query.market === "string" ? request.query.market : null;
  const status = typeof request.query.status === "string" ? request.query.status : null;
  const slipDate = typeof request.query.slipDate === "string" ? request.query.slipDate : null;

  return { country, market, status, slipDate };
}

function buildWhere(filters: ReturnType<typeof getFilters>, alias = "m") {
  const clauses: string[] = [];
  const params: QueryParams = {};

  if (filters.country) {
    clauses.push(`${alias}.country = :country`);
    params.country = filters.country;
  }

  if (filters.status) {
    clauses.push(`${alias}.status = :status`);
    params.status = filters.status;
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

app.get("/api/health", async (_request, response) => {
  try {
    await query("SELECT 1 AS ok");
    response.json({ ok: true, database: process.env.DB_NAME ?? "flashscore_scraper" });
  } catch (error) {
    response.status(503).json({
      ok: false,
      message: "Database connection failed",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/filters", async (_request, response, next) => {
  try {
    const countries = await query<{ country: string; count: number }>(`
      SELECT country, COUNT(*) AS count
      FROM matches
      WHERE country IS NOT NULL AND country <> ''
      GROUP BY country
      ORDER BY count DESC, country ASC
      LIMIT 60
    `);

    const markets = await query<{ market: string; count: number }>(`
      SELECT market, COUNT(*) AS count
      FROM prediction_daily_betslip
      GROUP BY market
      ORDER BY count DESC
    `);

    const historyDates = await query<{ slip_date: string; count: number }>(`
      SELECT slip_date, COUNT(*) AS count
      FROM history_daily_d
      GROUP BY slip_date
      ORDER BY slip_date DESC
    `);

    response.json({ countries, markets, historyDates });
  } catch (error) {
    next(error);
  }
});

app.get("/api/summary", async (request, response, next) => {
  try {
    const filters = getFilters(request);
    const matchWhere = buildWhere(filters);
    const marketClause = filters.market ? "WHERE market = :market" : "";
    const marketParams: QueryParams = filters.market ? { market: filters.market } : {};

    const [matches] = await query<{
      total_matches: number;
      finished_matches: number;
      scheduled_matches: number;
      avg_home_odds: number | null;
      avg_away_odds: number | null;
    }>(
      `
      SELECT
        COUNT(*) AS total_matches,
        SUM(status = 'Finished') AS finished_matches,
        SUM(status = 'Scheduled') AS scheduled_matches,
        AVG(odds_home) AS avg_home_odds,
        AVG(odds_away) AS avg_away_odds
      FROM matches m
      ${matchWhere.where}
    `,
      matchWhere.params,
    );

    const [betslip] = await query<{
      total_picks: number;
      avg_confidence: number | null;
      avg_edge: number | null;
      max_daily_score: number | null;
      latest_slip_date: string | null;
      total_slip_odd: number | null;
    }>(
      `
      SELECT
        COUNT(*) AS total_picks,
        AVG(confidence) AS avg_confidence,
        AVG(edge) AS avg_edge,
        MAX(daily_score) AS max_daily_score,
        MAX(slip_date) AS latest_slip_date,
        MAX(total_slip_odd) AS total_slip_odd
      FROM prediction_daily_betslip
      ${marketClause}
    `,
      marketParams,
    );

    response.json({ matches, betslip });
  } catch (error) {
    next(error);
  }
});

app.get("/api/picks", async (request, response, next) => {
  try {
    const filters = getFilters(request);
    const clauses: string[] = [];
    const params: QueryParams = { limit: Number(request.query.limit ?? 12) };

    if (filters.country) {
      clauses.push("country = :country");
      params.country = filters.country;
    }

    if (filters.market) {
      clauses.push("market = :market");
      params.market = filters.market;
    }

    if (filters.slipDate) {
      clauses.push("slip_date = :slipDate");
      params.slipDate = filters.slipDate;
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const rows = await query(
      `
      SELECT
        id_key,
        slip_date,
        slip_position,
        match_id,
        country,
        league,
        home_team,
        away_team,
        market,
        advice,
        selected_odd,
        probability,
        implied_probability,
        edge,
        confidence,
        daily_score,
        total_slip_odd,
        feature_summary,
        winner_form,
        opponent_form,
        rank_gap,
        points_diff
      FROM prediction_daily_betslip
      ${where}
      ORDER BY slip_date DESC, daily_score DESC
      LIMIT :limit
    `,
      params,
    );

    response.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get("/api/history", async (request, response, next) => {
  try {
    const filters = getFilters(request);
    const clauses: string[] = [];
    const params: QueryParams = { limit: Number(request.query.limit ?? 80) };

    if (filters.country) {
      clauses.push("country = :country");
      params.country = filters.country;
    }

    if (filters.market) {
      clauses.push("market = :market");
      params.market = filters.market;
    }

    if (filters.slipDate) {
      clauses.push("slip_date = :slipDate");
      params.slipDate = filters.slipDate;
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const rows = await query(
      `
      SELECT
        id_key,
        slip_date,
        slip_position,
        match_id,
        source_match_url,
        country,
        league,
        home_team,
        away_team,
        market,
        advice,
        selected_odd,
        probability,
        confidence,
        daily_score,
        total_slip_odd,
        match_status,
        score_home,
        score_away,
        actual_outcome,
        pick_result,
        profit_units,
        settled_at,
        checked_at
      FROM history_daily_d
      ${where}
      ORDER BY slip_date DESC, slip_position ASC
      LIMIT :limit
    `,
      params,
    );

    response.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get("/api/history-summary", async (request, response, next) => {
  try {
    const filters = getFilters(request);
    const clauses: string[] = [];
    const params: QueryParams = {};

    if (filters.country) {
      clauses.push("country = :country");
      params.country = filters.country;
    }

    if (filters.market) {
      clauses.push("market = :market");
      params.market = filters.market;
    }

    if (filters.slipDate) {
      clauses.push("slip_date = :slipDate");
      params.slipDate = filters.slipDate;
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const [summary] = await query<{
      settled_picks: number;
      won_picks: number;
      lost_picks: number;
      pending_picks: number;
      profit_units: number | null;
      avg_confidence: number | null;
      avg_odd: number | null;
      latest_checked_at: string | null;
    }>(
      `
      SELECT
        COUNT(*) AS settled_picks,
        SUM(pick_result = 'WON') AS won_picks,
        SUM(pick_result = 'LOST') AS lost_picks,
        SUM(pick_result IS NULL OR pick_result NOT IN ('WON', 'LOST')) AS pending_picks,
        SUM(profit_units) AS profit_units,
        AVG(confidence) AS avg_confidence,
        AVG(selected_odd) AS avg_odd,
        MAX(checked_at) AS latest_checked_at
      FROM history_daily_d
      ${where}
    `,
      params,
    );

    const byDate = await query<{
      slip_date: string;
      picks: number;
      wins: number;
      losses: number;
      profit_units: number | null;
    }>(
      `
      SELECT
        slip_date,
        COUNT(*) AS picks,
        SUM(pick_result = 'WON') AS wins,
        SUM(pick_result = 'LOST') AS losses,
        SUM(profit_units) AS profit_units
      FROM history_daily_d
      ${where}
      GROUP BY slip_date
      ORDER BY slip_date ASC
    `,
      params,
    );

    response.json({ summary, byDate });
  } catch (error) {
    next(error);
  }
});

app.get("/api/matches", async (request, response, next) => {
  try {
    const filters = getFilters(request);
    const built = buildWhere(filters);

    const rows = await query(
      `
      SELECT
        match_id,
        country,
        league,
        match_date,
        match_time,
        home_team,
        away_team,
        status,
        score_home,
        score_away,
        odds_home,
        odds_draw,
        odds_away,
        home_rank,
        away_rank,
        home_recent_form,
        away_recent_form
      FROM matches m
      ${built.where}
      ORDER BY match_date DESC, match_time DESC
      LIMIT 80
    `,
      built.params,
    );

    response.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get("/api/league-performance", async (request, response, next) => {
  try {
    const filters = getFilters(request);
    const built = buildWhere(filters);

    const rows = await query(
      `
      SELECT
        country,
        league,
        COUNT(*) AS matches,
        AVG(COALESCE(score_home, 0) + COALESCE(score_away, 0)) AS avg_goals,
        AVG(odds_home) AS avg_home_odd,
        SUM(status = 'Finished') AS finished
      FROM matches m
      ${built.where}
      GROUP BY country, league
      HAVING matches >= 2
      ORDER BY matches DESC, avg_goals DESC
      LIMIT 14
    `,
      built.params,
    );

    response.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get("/api/timeline", async (request, response, next) => {
  try {
    const filters = getFilters(request);
    const built = buildWhere(filters);

    const rows = await query(
      `
      SELECT
        match_date AS date,
        COUNT(*) AS matches,
        SUM(status = 'Finished') AS finished,
        AVG(CASE WHEN score_home IS NOT NULL AND score_away IS NOT NULL THEN score_home + score_away END) AS avg_goals
      FROM matches m
      ${built.where}
      GROUP BY match_date
      ORDER BY match_date DESC
      LIMIT 24
    `,
      built.params,
    );

    response.json(rows.reverse());
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  response.status(500).json({
    ok: false,
    message: "API query failed",
    detail: error instanceof Error ? error.message : "Unknown error",
  });
});

app.listen(port, () => {
  console.log(`Flashscore API running on http://localhost:${port}`);
});
