import { createClient } from "@supabase/supabase-js";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";

dotenv.config({ path: ".env.local" });
dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json());

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase env variables. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
  },
});

type Filters = {
  country: string | null;
  market: string | null;
  status: string | null;
  slipDate: string | null;
};

type DbRow = Record<string, unknown>;

function getFilters(request: express.Request): Filters {
  const country = typeof request.query.country === "string" ? request.query.country : null;
  const market = typeof request.query.market === "string" ? request.query.market : null;
  const status = typeof request.query.status === "string" ? request.query.status : null;
  const slipDate = typeof request.query.slipDate === "string" ? request.query.slipDate : null;

  return { country, market, status, slipDate };
}

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function avg(rows: DbRow[], key: string) {
  const values = rows.map((row) => numberValue(row[key])).filter((value): value is number => value !== null);
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function sum(rows: DbRow[], key: string) {
  const values = rows.map((row) => numberValue(row[key])).filter((value): value is number => value !== null);
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0);
}

function maxNumber(rows: DbRow[], key: string) {
  const values = rows.map((row) => numberValue(row[key])).filter((value): value is number => value !== null);
  return values.length ? Math.max(...values) : null;
}

function maxString(rows: DbRow[], key: string) {
  const values = rows.map((row) => row[key]).filter((value): value is string => typeof value === "string");
  return values.length ? values.sort().at(-1) ?? null : null;
}

function groupCount(rows: DbRow[], key: string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ [key]: value, count }))
    .sort((a, b) => Number(b.count) - Number(a.count) || String(a[key]).localeCompare(String(b[key])));
}

function errorDetail(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function isMissingTableError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "PGRST205"
  );
}

async function fetchPaged(table: string, columns = "*", filters?: (query: any) => any) {
  const pageSize = 1000;
  const rows: DbRow[] = [];

  for (let from = 0; ; from += pageSize) {
    let request = supabase.from(table).select(columns).range(from, from + pageSize - 1);
    if (filters) request = filters(request);

    const { data, error } = await request;
    if (error) {
      if (isMissingTableError(error)) return [];
      throw error;
    }

    rows.push(...((data ?? []) as unknown as DbRow[]));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

function applyMatchFilters(filters: Filters) {
  return (query: any) => {
    let next = query;
    if (filters.country) next = next.eq("country", filters.country);
    if (filters.status) next = next.eq("status", filters.status);
    return next;
  };
}

function applyPickFilters(filters: Filters) {
  return (query: any) => {
    let next = query;
    if (filters.country) next = next.eq("country", filters.country);
    if (filters.market) next = next.eq("market", filters.market);
    return next;
  };
}

function applyHistoryFilters(filters: Filters) {
  return (query: any) => {
    let next = applyPickFilters(filters)(query);
    if (filters.slipDate) next = next.eq("slip_date", filters.slipDate);
    return next;
  };
}

app.get("/api/health", async (_request, response) => {
  try {
    const { error, count } = await supabase
      .from("prediction_daily_betslip")
      .select("id_key", { count: "exact", head: true });
    if (error) throw error;
    response.json({ ok: true, source: "supabase", url: supabaseUrl, daily_picks: count ?? 0 });
  } catch (error) {
    response.status(503).json({
      ok: false,
      message: "Supabase connection failed",
      detail: errorDetail(error),
    });
  }
});

app.get("/api/filters", async (_request, response, next) => {
  try {
    const [matches, picks, history] = await Promise.all([
      fetchPaged("matches", "country"),
      fetchPaged("prediction_daily_betslip", "market"),
      fetchPaged("history_daily_d", "slip_date"),
    ]);

    response.json({
      countries: groupCount(matches, "country").slice(0, 60),
      markets: groupCount(picks, "market"),
      historyDates: groupCount(history, "slip_date").sort((a, b) => String(b.slip_date).localeCompare(String(a.slip_date))),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/summary", async (request, response, next) => {
  try {
    const filters = getFilters(request);
    const [matches, picks] = await Promise.all([
      fetchPaged("matches", "status,odds_home,odds_away", applyMatchFilters(filters)),
      fetchPaged(
        "prediction_daily_betslip",
        "confidence,edge,daily_score,slip_date,total_slip_odd",
        applyPickFilters(filters),
      ),
    ]);

    response.json({
      matches: {
        total_matches: matches.length,
        finished_matches: matches.filter((row) => row.status === "Finished").length,
        scheduled_matches: matches.filter((row) => row.status === "Scheduled").length,
        avg_home_odds: avg(matches, "odds_home"),
        avg_away_odds: avg(matches, "odds_away"),
      },
      betslip: {
        total_picks: picks.length,
        avg_confidence: avg(picks, "confidence"),
        avg_edge: avg(picks, "edge"),
        max_daily_score: maxNumber(picks, "daily_score"),
        latest_slip_date: maxString(picks, "slip_date"),
        total_slip_odd: maxNumber(picks, "total_slip_odd"),
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/picks", async (request, response, next) => {
  try {
    const filters = getFilters(request);
    const limit = Number(request.query.limit ?? 12);
    let query = supabase
      .from("prediction_daily_betslip")
      .select(
        "id_key,slip_date,slip_position,match_id,country,league,home_team,away_team,market,advice,selected_odd,probability,implied_probability,edge,confidence,daily_score,total_slip_odd,feature_summary,winner_form,opponent_form,rank_gap,points_diff",
      )
      .order("slip_date", { ascending: false })
      .order("daily_score", { ascending: false })
      .limit(limit);

    query = applyPickFilters(filters)(query);
    const { data, error } = await query;
    if (error) {
      if (isMissingTableError(error)) return response.json([]);
      throw error;
    }

    response.json(data ?? []);
  } catch (error) {
    next(error);
  }
});

app.get("/api/history", async (request, response, next) => {
  try {
    const filters = getFilters(request);
    const limit = Number(request.query.limit ?? 80);
    let query = supabase
      .from("history_daily_d")
      .select(
        "id_key,slip_date,slip_position,match_id,source_match_url,country,league,home_team,away_team,market,advice,selected_odd,probability,confidence,daily_score,total_slip_odd,match_status,score_home,score_away,actual_outcome,pick_result,profit_units,settled_at,checked_at",
      )
      .order("slip_date", { ascending: false })
      .order("slip_position", { ascending: true })
      .limit(limit);

    query = applyHistoryFilters(filters)(query);
    const { data, error } = await query;
    if (error) {
      if (isMissingTableError(error)) return response.json([]);
      throw error;
    }

    response.json(data ?? []);
  } catch (error) {
    next(error);
  }
});

app.get("/api/history-summary", async (request, response, next) => {
  try {
    const filters = getFilters(request);
    const rows = await fetchPaged(
      "history_daily_d",
      "slip_date,pick_result,profit_units,confidence,selected_odd,checked_at",
      applyHistoryFilters(filters),
    );

    const byDate = [...new Set(rows.map((row) => row.slip_date).filter((date): date is string => typeof date === "string"))]
      .sort()
      .map((slipDate) => {
        const dateRows = rows.filter((row) => row.slip_date === slipDate);
        return {
          slip_date: slipDate,
          picks: dateRows.length,
          wins: dateRows.filter((row) => row.pick_result === "WON").length,
          losses: dateRows.filter((row) => row.pick_result === "LOST").length,
          profit_units: sum(dateRows, "profit_units"),
        };
      });

    response.json({
      summary: {
        settled_picks: rows.length,
        won_picks: rows.filter((row) => row.pick_result === "WON").length,
        lost_picks: rows.filter((row) => row.pick_result === "LOST").length,
        pending_picks: rows.filter((row) => row.pick_result !== "WON" && row.pick_result !== "LOST").length,
        profit_units: sum(rows, "profit_units"),
        avg_confidence: avg(rows, "confidence"),
        avg_odd: avg(rows, "selected_odd"),
        latest_checked_at: maxString(rows, "checked_at"),
      },
      byDate,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/matches", async (request, response, next) => {
  try {
    const filters = getFilters(request);
    let query = supabase
      .from("matches")
      .select(
        "match_id,country,league,match_date,match_time,home_team,away_team,status,score_home,score_away,odds_home,odds_draw,odds_away,home_rank,away_rank,home_recent_form,away_recent_form",
      )
      .order("match_date", { ascending: false })
      .order("match_time", { ascending: false })
      .limit(80);

    query = applyMatchFilters(filters)(query);
    const { data, error } = await query;
    if (error) {
      if (isMissingTableError(error)) return response.json([]);
      throw error;
    }

    response.json(data ?? []);
  } catch (error) {
    next(error);
  }
});

app.get("/api/league-performance", async (request, response, next) => {
  try {
    const filters = getFilters(request);
    const rows = await fetchPaged(
      "matches",
      "country,league,status,score_home,score_away,odds_home",
      applyMatchFilters(filters),
    );

    const keys = [...new Set(rows.map((row) => `${String(row.country)}|||${String(row.league)}`))];
    const leagues = keys
      .map((key) => {
        const [country, league] = key.split("|||");
        const leagueRows = rows.filter((row) => String(row.country) === country && String(row.league) === league);
        return {
          country,
          league,
          matches: leagueRows.length,
          avg_goals: avg(
            leagueRows.map((row) => ({
              goals: (numberValue(row.score_home) ?? 0) + (numberValue(row.score_away) ?? 0),
            })),
            "goals",
          ),
          avg_home_odd: avg(leagueRows, "odds_home"),
          finished: leagueRows.filter((row) => row.status === "Finished").length,
        };
      })
      .filter((row) => row.matches >= 2)
      .sort((a, b) => b.matches - a.matches || (b.avg_goals ?? 0) - (a.avg_goals ?? 0))
      .slice(0, 14);

    response.json(leagues);
  } catch (error) {
    next(error);
  }
});

app.get("/api/timeline", async (request, response, next) => {
  try {
    const filters = getFilters(request);
    const rows = await fetchPaged("matches", "match_date,status,score_home,score_away", applyMatchFilters(filters));
    const dates = [...new Set(rows.map((row) => row.match_date).filter((date): date is string => typeof date === "string"))]
      .sort()
      .slice(-24);

    const timeline = dates.map((date) => {
      const dateRows = rows.filter((row) => row.match_date === date);
      return {
        date,
        matches: dateRows.length,
        finished: dateRows.filter((row) => row.status === "Finished").length,
        avg_goals: avg(
          dateRows
            .filter((row) => numberValue(row.score_home) !== null && numberValue(row.score_away) !== null)
            .map((row) => ({ goals: Number(row.score_home) + Number(row.score_away) })),
          "goals",
        ),
      };
    });

    response.json(timeline);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  response.status(500).json({
    ok: false,
    message: "API query failed",
    detail: errorDetail(error),
  });
});

app.listen(port, () => {
  console.log(`Flashscore Supabase API running on http://localhost:${port}`);
});
