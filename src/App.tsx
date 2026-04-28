import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  CheckCircle2,
  Clock3,
  Database,
  ExternalLink,
  Filter,
  Gauge,
  History,
  Percent,
  RefreshCw,
  ShieldCheck,
  Target,
  TrendingUp,
  WalletCards,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber, formatPercent } from "@/lib/utils";

type Summary = {
  matches: {
    total_matches: number;
    finished_matches: number;
    scheduled_matches: number;
    avg_home_odds: number | null;
    avg_away_odds: number | null;
  };
  betslip: {
    total_picks: number;
    avg_confidence: number | null;
    avg_edge: number | null;
    max_daily_score: number | null;
    latest_slip_date: string | null;
    total_slip_odd: number | null;
  };
};

type Pick = {
  id_key: string;
  slip_date: string;
  slip_position: number;
  country: string | null;
  league: string | null;
  home_team: string | null;
  away_team: string | null;
  market: string;
  advice: string;
  selected_odd: number;
  probability: number;
  implied_probability: number;
  edge: number;
  confidence: number;
  daily_score: number;
  total_slip_odd: number;
  feature_summary: string | null;
  winner_form: string | null;
  opponent_form: string | null;
  rank_gap: number | null;
  points_diff: number | null;
};

type HistoryRow = {
  id_key: string;
  slip_date: string;
  slip_position: number;
  match_id: string;
  source_match_url: string;
  country: string | null;
  league: string | null;
  home_team: string | null;
  away_team: string | null;
  market: string;
  advice: string;
  selected_odd: number;
  probability: number;
  confidence: number;
  daily_score: number;
  total_slip_odd: number;
  match_status: string | null;
  score_home: number | null;
  score_away: number | null;
  actual_outcome: string | null;
  pick_result: string | null;
  profit_units: number | null;
  settled_at: string | null;
  checked_at: string | null;
};

type HistorySummary = {
  summary: {
    settled_picks: number;
    won_picks: number;
    lost_picks: number;
    pending_picks: number;
    profit_units: number | null;
    avg_confidence: number | null;
    avg_odd: number | null;
    latest_checked_at: string | null;
  };
  byDate: {
    slip_date: string;
    picks: number;
    wins: number;
    losses: number;
    profit_units: number | null;
  }[];
};

type FilterOption = {
  country?: string;
  market?: string;
  slip_date?: string;
  count: number;
};

type DatabaseHealth = {
  ok: boolean;
  connected: boolean;
  database: string;
  host: string;
  server_host?: string | null;
  server_version?: string | null;
  ssl?: boolean;
  tables?: string[];
  missingTables?: string[];
  checkedAt?: string;
  message?: string;
  detail?: string;
};

type ApiState = {
  summary: Summary | null;
  picks: Pick[];
  history: HistoryRow[];
  historySummary: HistorySummary | null;
  countries: FilterOption[];
  markets: FilterOption[];
  historyDates: FilterOption[];
};

const initialState: ApiState = {
  summary: null,
  picks: [],
  history: [],
  historySummary: null,
  countries: [],
  markets: [],
  historyDates: [],
};

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? body?.message ?? `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function toQuery(filters: { country: string; market: string; slipDate: string }, includeSlipDate = false) {
  const params = new URLSearchParams();
  if (filters.country !== "all") params.set("country", filters.country);
  if (filters.market !== "all") params.set("market", filters.market);
  if (includeSlipDate && filters.slipDate !== "all") params.set("slipDate", filters.slipDate);
  return params.toString();
}

function App() {
  const [data, setData] = useState<ApiState>(initialState);
  const [filters, setFilters] = useState({ country: "all", market: "all", slipDate: "all" });
  const [view, setView] = useState<"dashboard" | "history">("dashboard");
  const [databaseStatus, setDatabaseStatus] = useState<{
    state: "checking" | "online" | "degraded" | "offline";
    health: DatabaseHealth | null;
  }>({ state: "checking", health: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    setDatabaseStatus((current) => ({ ...current, state: "checking" }));
    const query = toQuery(filters);
    const historyQuery = toQuery(filters, true);
    const suffix = query ? `?${query}` : "";
    const historySuffix = historyQuery ? `?${historyQuery}` : "";
    let health: DatabaseHealth | null = null;

    try {
      health = await getJson<DatabaseHealth>("/api/health");
      setDatabaseStatus({ state: health.ok ? "online" : "degraded", health });

      if (!health.connected) {
        throw new Error(health.detail ?? health.message ?? "Database host is offline");
      }

      if (!health.ok) {
        const missing = health.missingTables?.length ? `Missing tables: ${health.missingTables.join(", ")}` : null;
        throw new Error(missing ?? "Database is connected but not ready");
      }

      const [summary, picks, history, historySummary, filterData] = await Promise.all([
        getJson<Summary>(`/api/summary${suffix}`),
        getJson<Pick[]>(`/api/picks${suffix}`),
        getJson<HistoryRow[]>(`/api/history${historySuffix}`),
        getJson<HistorySummary>(`/api/history-summary${historySuffix}`),
        getJson<{ countries: FilterOption[]; markets: FilterOption[]; historyDates: FilterOption[] }>("/api/filters"),
      ]);

      setData({
        summary,
        picks,
        history,
        historySummary,
        countries: filterData.countries,
        markets: filterData.markets,
        historyDates: filterData.historyDates,
      });
    } catch (loadError) {
      if (!health) {
        setDatabaseStatus({ state: "offline", health: null });
      }
      setError(loadError instanceof Error ? loadError.message : "Unable to load dashboard data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [filters.country, filters.market, filters.slipDate]);

  const marketChart = useMemo(
    () =>
      data.picks.slice(0, 8).map((pick) => ({
        name: `${pick.home_team ?? "Home"} v ${pick.away_team ?? "Away"}`,
        probability: Number((pick.probability * 100).toFixed(1)),
        implied: Number((pick.implied_probability * 100).toFixed(1)),
        edge: Number((pick.edge * 100).toFixed(1)),
      })),
    [data.picks],
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="hero-shell relative overflow-hidden border-b border-border">
        <div className="hero-grid absolute inset-0" />
        <div className="relative mx-auto grid max-w-7xl gap-6 px-4 pb-16 pt-5 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:pb-20 lg:pt-8">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col justify-center"
          >
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <div className="tunisia-mark" aria-label="Tunisia logo">
                <span className="tunisia-star">*</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className="border-red-200 bg-red-50 text-red-700">Tunisia system</Badge>
                <DatabaseStatusBadge status={databaseStatus} />
              </div>
            </div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-red-600">Prediction cockpit</p>
            <h1 className="max-w-4xl text-4xl font-semibold leading-tight tracking-normal text-slate-950 sm:text-5xl lg:text-6xl">
              06GamingStore Prediction
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
              A clean, responsive dashboard for daily picks, odds edge, confidence, profit history, and settled tickets.
            </p>
            <p className="mt-5 text-sm font-medium text-red-700">Developer all rights: 06GamingStore</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="hero-panel"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500">Host database</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">
                  {databaseStatus.health?.database ?? "Checking"}
                </p>
                <p className="mt-1 max-w-[280px] truncate text-xs text-slate-500">
                  {databaseStatus.health?.host ?? "Verifying connection before loading"}
                </p>
              </div>
              <div className={databaseStatus.state === "online" ? "rounded-2xl bg-emerald-600 p-3 text-white shadow-lg shadow-emerald-600/20" : "rounded-2xl bg-red-600 p-3 text-white shadow-lg shadow-red-600/20"}>
                <Database className="h-6 w-6" />
              </div>
            </div>
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-600">Load gate</span>
                <span className={databaseStatus.state === "online" ? "text-sm font-semibold text-emerald-700" : databaseStatus.state === "checking" ? "text-sm font-semibold text-amber-700" : "text-sm font-semibold text-red-700"}>
                  {databaseStatus.state === "online"
                    ? "Ready"
                    : databaseStatus.state === "checking"
                      ? "Checking"
                      : databaseStatus.state === "degraded"
                        ? "Needs setup"
                        : "Offline"}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {databaseStatus.health?.missingTables?.length
                  ? `Missing: ${databaseStatus.health.missingTables.join(", ")}`
                  : databaseStatus.health?.checkedAt
                    ? `Verified at ${new Date(databaseStatus.health.checkedAt).toLocaleString()}`
                    : "The dashboard waits for database health before requesting charts."}
              </p>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <HeroMetric label="Picks" value={formatNumber(data.summary?.betslip.total_picks)} />
              <HeroMetric label="Slip odd" value={data.summary?.betslip.total_slip_odd?.toFixed(2) ?? "n/a"} />
              <HeroMetric label="Confidence" value={formatPercent(data.summary?.betslip.avg_confidence)} />
              <HeroMetric label="Edge" value={formatPercent(data.summary?.betslip.avg_edge)} />
            </div>
          </motion.div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
        <div className="-mt-9 rounded-2xl border border-border bg-white/90 p-3 shadow-xl shadow-slate-200/70 backdrop-blur md:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
              <Filter className="h-4 w-4 text-red-600" />
              Filters
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:flex lg:items-center">
              <div className="grid grid-cols-2 rounded-xl border border-border bg-slate-50 p-1">
              <Button
                variant={view === "dashboard" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setView("dashboard")}
              >
                <BarChart3 className="h-4 w-4" />
                Dashboard
              </Button>
              <Button
                variant={view === "history" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setView("history")}
              >
                <History className="h-4 w-4" />
                Historique
              </Button>
            </div>
          
            <select
              className="h-10 rounded-xl border border-input bg-white px-3 text-sm outline-none ring-ring focus:ring-2"
              value={filters.market}
              onChange={(event) => setFilters((current) => ({ ...current, market: event.target.value }))}
            >
              <option value="all">All markets</option>
              {data.markets.map((option) => (
                <option key={option.market} value={option.market}>
                  {option.market} ({option.count})
                </option>
              ))}
            </select>
            {view === "history" && (
              <select
                className="h-10 rounded-xl border border-input bg-white px-3 text-sm outline-none ring-ring focus:ring-2"
                value={filters.slipDate}
                onChange={(event) => setFilters((current) => ({ ...current, slipDate: event.target.value }))}
              >
                <option value="all">All history dates</option>
                {data.historyDates.map((option) => (
                  <option key={option.slip_date} value={option.slip_date}>
                    {option.slip_date} ({option.count})
                  </option>
                ))}
              </select>
            )}
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Refresh
            </Button>
            </div>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {error ? (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-950 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <Database className="mt-0.5 h-5 w-5 text-red-600" />
                <div>
                  <h2 className="font-semibold text-red-950">Host database is not ready</h2>
                  <p className="mt-1 text-sm text-red-800">
                    {error}. Check Vercel environment variables, Aiven SSL, and that the required tables are imported.
                  </p>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {view === "dashboard" ? (
                <>
                  <StatsGrid summary={data.summary} loading={loading} />

                  <div className="mt-5 lg:mt-6">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <BarChart3 className="h-4 w-4 text-red-600" />
                          Probability edge
                        </CardTitle>
                        <CardDescription>Model probability, implied probability, and edge for the strongest picks.</CardDescription>
                      </CardHeader>
                      <CardContent className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={marketChart} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="name" hide />
                            <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                            <Legend />
                            <Bar dataKey="probability" name="Model %" radius={[4, 4, 0, 0]} fill="#22c55e" />
                            <Bar dataKey="implied" name="Implied %" radius={[4, 4, 0, 0]} fill="#38bdf8" />
                            <Bar dataKey="edge" name="Edge %" radius={[4, 4, 0, 0]} fill="#f59e0b" />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="mt-5">
                    <PicksPanel picks={data.picks} />
                  </div>
                </>
              ) : (
                <HistoryView rows={data.history} historySummary={data.historySummary} loading={loading} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </main>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function DatabaseStatusBadge({
  status,
}: {
  status: { state: "checking" | "online" | "degraded" | "offline"; health: DatabaseHealth | null };
}) {
  const config = {
    checking: {
      label: "Checking host DB",
      className: "border-amber-200 bg-amber-50 text-amber-700",
      icon: <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />,
    },
    online: {
      label: "Host DB online",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      icon: <CheckCircle2 className="mr-1 h-3.5 w-3.5" />,
    },
    degraded: {
      label: "DB needs import",
      className: "border-orange-200 bg-orange-50 text-orange-700",
      icon: <Database className="mr-1 h-3.5 w-3.5" />,
    },
    offline: {
      label: "Host DB offline",
      className: "border-red-200 bg-red-50 text-red-700",
      icon: <XCircle className="mr-1 h-3.5 w-3.5" />,
    },
  }[status.state];

  return (
    <Badge className={config.className} title={status.health?.host ?? "Database host"}>
      {config.icon}
      {config.label}
    </Badge>
  );
}

function StatsGrid({ summary, loading }: { summary: Summary | null; loading: boolean }) {
  const stats = [
    {
      label: "Daily picks",
      value: formatNumber(summary?.betslip.total_picks),
      detail: summary?.betslip.latest_slip_date ?? "No slip date",
      icon: Target,
    },
    {
      label: "Confidence",
      value: formatPercent(summary?.betslip.avg_confidence),
      detail: `${formatPercent(summary?.betslip.avg_edge)} avg edge`,
      icon: Percent,
    },
    {
      label: "Slip odd",
      value: summary?.betslip.total_slip_odd ? summary.betslip.total_slip_odd.toFixed(2) : "n/a",
      detail: `${formatNumber(summary?.betslip.max_daily_score, 1)} max score`,
      icon: Gauge,
    },
    {
      label: "Momentum",
      value: formatNumber(summary?.betslip.max_daily_score, 1),
      detail: "highest daily score",
      icon: TrendingUp,
    },
  ];

  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:mt-6 lg:grid-cols-4">
      {stats.map((stat, index) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
        >
          <Card className="overflow-hidden border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-200/80">
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="mt-2 text-3xl font-semibold tracking-normal">{loading ? "..." : stat.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{stat.detail}</p>
                </div>
                <div className="rounded-2xl border border-red-100 bg-red-50 p-3">
                  <stat.icon className="h-5 w-5 text-red-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

function PicksPanel({ picks }: { picks: Pick[] }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-4 w-4 text-red-600" />
          Best betslip picks
        </CardTitle>
        <CardDescription>Ranked by daily score from `prediction_daily_betslip`.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {picks.slice(0, 7).map((pick, index) => (
          <motion.div
            key={pick.id_key}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.04 }}
            className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="success">{pick.market}</Badge>
                  <span className="text-xs text-muted-foreground">{pick.country} / {pick.league}</span>
                </div>
                <h3 className="mt-3 font-semibold leading-snug tracking-normal text-slate-950">
                  {pick.home_team} vs {pick.away_team}
                </h3>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{pick.feature_summary}</p>
              </div>
              <div className="rounded-2xl bg-slate-950 px-3 py-2 text-right text-white">
                <p className="text-xl font-semibold">{pick.selected_odd.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">odd</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <Signal label="Prob" value={formatPercent(pick.probability)} />
              <Signal label="Edge" value={formatPercent(pick.edge)} />
              <Signal label="Rank gap" value={formatNumber(pick.rank_gap)} />
              <Signal label="Pts diff" value={formatNumber(pick.points_diff)} />
            </div>
          </motion.div>
        ))}
      </CardContent>
    </Card>
  );
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2">
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}

function HistoryView({
  rows,
  historySummary,
  loading,
}: {
  rows: HistoryRow[];
  historySummary: HistorySummary | null;
  loading: boolean;
}) {
  const summary = historySummary?.summary;
  const winRate =
    summary && summary.settled_picks > 0 ? (Number(summary.won_picks ?? 0) / Number(summary.settled_picks)) : null;

  const stats = [
    {
      label: "Historique picks",
      value: formatNumber(summary?.settled_picks),
      detail: `${formatNumber(summary?.won_picks)} won / ${formatNumber(summary?.lost_picks)} lost`,
      icon: Clock3,
    },
    {
      label: "Win rate",
      value: formatPercent(winRate),
      detail: `${formatNumber(summary?.pending_picks)} pending`,
      icon: CheckCircle2,
    },
    {
      label: "Profit units",
      value: formatNumber(summary?.profit_units, 2),
      detail: `Avg odd ${formatNumber(summary?.avg_odd, 2)}`,
      icon: WalletCards,
    },
    {
      label: "Avg confidence",
      value: formatPercent(summary?.avg_confidence),
      detail: summary?.latest_checked_at ?? "No check yet",
      icon: ShieldCheck,
    },
  ];

  return (
    <>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                    <p className="mt-2 text-3xl font-semibold tracking-normal">{loading ? "..." : stat.value}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{stat.detail}</p>
                  </div>
                  <div className="rounded-md border bg-secondary p-3">
                    <stat.icon className="h-5 w-5 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[0.82fr_1.18fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <WalletCards className="h-4 w-4 text-emerald-400" />
              Profit by slip date
            </CardTitle>
            <CardDescription>Settled units from `history_daily_d` grouped by date.</CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={historySummary?.byDate ?? []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="slip_date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Legend />
                <Bar dataKey="profit_units" name="Profit units" radius={[4, 4, 0, 0]} fill="#22c55e" />
                <Bar dataKey="wins" name="Wins" radius={[4, 4, 0, 0]} fill="#38bdf8" />
                <Bar dataKey="losses" name="Losses" radius={[4, 4, 0, 0]} fill="#f43f5e" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-sky-400" />
              Historique des tickets
            </CardTitle>
            <CardDescription>Results, profit, final score, and Flashscore source link.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="sticky top-0 z-10 border-y bg-secondary text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Match</th>
                    <th className="px-4 py-3 text-left">Pick</th>
                    <th className="px-4 py-3 text-left">Odd</th>
                    <th className="px-4 py-3 text-left">Prob</th>
                    <th className="px-4 py-3 text-left">Score</th>
                    <th className="px-4 py-3 text-left">Result</th>
                    <th className="px-4 py-3 text-left">Profit</th>
                    <th className="px-4 py-3 text-left">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id_key} className="border-b transition hover:bg-secondary/40">
                      <td className="px-4 py-3 text-muted-foreground">
                        <p>{row.slip_date}</p>
                        <p className="text-xs">#{row.slip_position}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{row.home_team} vs {row.away_team}</p>
                        <p className="text-xs text-muted-foreground">{row.country} / {row.league}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary">{row.advice}</Badge>
                      </td>
                      <td className="px-4 py-3">{row.selected_odd.toFixed(2)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatPercent(row.probability)}</td>
                      <td className="px-4 py-3">
                        {row.score_home === null || row.score_away === null ? "n/a" : `${row.score_home}:${row.score_away}`}
                      </td>
                      <td className="px-4 py-3">
                        <ResultBadge result={row.pick_result} />
                      </td>
                      <td className={row.profit_units && row.profit_units > 0 ? "px-4 py-3 text-emerald-300" : "px-4 py-3 text-rose-300"}>
                        {formatNumber(row.profit_units, 2)}
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="icon" onClick={() => window.open(row.source_match_url, "_blank")}>
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function ResultBadge({ result }: { result: string | null }) {
  if (result === "WON") {
    return (
      <Badge variant="success">
        <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
        WON
      </Badge>
    );
  }

  if (result === "LOST") {
    return (
      <Badge className="border-rose-500/30 bg-rose-500/10 text-rose-300">
        <XCircle className="mr-1 h-3.5 w-3.5" />
        LOST
      </Badge>
    );
  }

  return <Badge variant="outline">{result ?? "PENDING"}</Badge>;
}

export default App;
