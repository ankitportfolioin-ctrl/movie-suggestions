import { useEffect, useState } from 'react';

type Row = Record<string, string | number | null>;

interface Dashboard {
  overview: {
    unique_visitors: string; total_page_views: string; total_sessions: string;
    returning_visitors: string; new_visitors: string;
    quiz_starts: string; recommendations_served: string; saves: string;
  };
  topCountries: Row[]; topCities: Row[]; topRegions: Row[];
  topPages: Row[]; topReferrers: Row[];
  hourlyTraffic: { hour: string; page_views: string; unique_visitors: string }[];
  dailyTraffic: { day: string; page_views: string; unique_visitors: string }[];
  events: { event_type: string; count: string }[];
  visitorTrend: { day: string; returning: string; new_visitors: string }[];
  range: string;
}

interface Realtime {
  activeVisitors: number; activePageViews: number; lastActivity: string | null;
  activePages: { path: string; views: string; visitors: string }[];
  activeCountries: { country_code: string; country_name: string; visitors: string }[];
}

const RANGES = [
  { key: '1h', label: 'Last hour' },
  { key: '24h', label: 'Last 24 hours' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
];

function num(v: string | number | undefined | null): string {
  return Number(v ?? 0).toLocaleString();
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? 'border-orange-500/40 bg-orange-500/5' : 'border-zinc-800 bg-rose-950/10'}`}>
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 font-heading text-2xl font-bold text-zinc-100">{value}</div>
    </div>
  );
}

function BarChart({ data, color = '#FF7A2F', height = 140 }: {
  data: { label: string; value: number }[]; color?: string; height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="group relative flex-1" style={{ minWidth: 4 }}>
          <div
            className="w-full rounded-t"
            style={{ height: Math.max(2, (d.value / max) * height), backgroundColor: color }}
            title={`${d.label}: ${d.value.toLocaleString()}`}
          />
          <div className="pointer-events-none absolute bottom-full left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-100 shadow group-hover:block">
            {d.label}: {d.value.toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}

function ListTable({ head, rows }: { head: string[]; rows: string[][] }) {
  if (!rows.length) {
    return <p className="p-4 text-sm text-zinc-500">No data in this range yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
            {head.map((h) => <th key={h} className="px-4 py-2">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-zinc-900 last:border-0">
              {r.map((c, j) => (
                <td key={j} className={`px-4 py-2 ${j === 0 ? 'font-medium text-zinc-100' : 'text-zinc-400'}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/60">
      <h2 className="border-b border-zinc-800 px-4 py-3 font-heading text-sm font-semibold uppercase tracking-wider text-zinc-300">{title}</h2>
      {children}
    </section>
  );
}

function fmtHour(h: string): string {
  const d = new Date(h);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });
}

function fmtDay(d: string): string {
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function AnalyticsDashboard() {
  const [range, setRange] = useState('7d');
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [rt, setRt] = useState<Realtime | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [d, r] = await Promise.all([
          fetch(`/api/analytics/dashboard?range=${range}`).then((res) => {
            if (!res.ok) throw new Error(`Dashboard API ${res.status}`);
            return res.json();
          }),
          fetch('/api/analytics/realtime').then((res) => {
            if (!res.ok) throw new Error(`Realtime API ${res.status}`);
            return res.json();
          }),
        ]);
        if (alive) { setDash(d); setRt(r); setError(null); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load analytics');
      }
    };
    load();
    const t = setInterval(load, 15_000); // realtime refresh
    return () => { alive = false; clearInterval(t); };
  }, [range]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
        <div className="rounded-xl border border-rose-800 bg-rose-950/30 p-6 text-center">
          <p className="font-heading text-lg text-rose-300">Analytics unavailable</p>
          <p className="mt-1 text-sm text-zinc-400">{error}</p>
          <a href="/" className="mt-4 inline-block rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-orange-400">Back to CineMatch</a>
        </div>
      </div>
    );
  }

  const o = dash?.overview;
  const returning = Number(o?.returning_visitors ?? 0);
  const newV = Number(o?.new_visitors ?? 0);
  const returningPct = returning + newV > 0 ? Math.round((returning / (returning + newV)) * 100) : 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="font-heading text-xl font-bold">
              <span className="text-rose-400">Cine</span>Match <span className="text-zinc-400">Traffic</span>
            </h1>
            <p className="text-xs text-zinc-500">Anonymous traffic analytics — no personal data collected.</p>
          </div>
          <nav className="flex items-center gap-2">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${range === r.key ? 'bg-orange-500 text-zinc-950' : 'border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'}`}
              >
                {r.label}
              </button>
            ))}
            <a href="/" className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:border-zinc-500">Back to site</a>
          </nav>
        </div>
      </header>

      {(rt?.activeVisitors ?? 0) > 0 && (
        <div className="border-b border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-center text-sm text-emerald-300">
          <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          {rt!.activeVisitors.toLocaleString()} visitor{rt!.activeVisitors === 1 ? '' : 's'} online now (last 5 min)
        </div>
      )}

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Unique visitors" value={num(o?.unique_visitors)} accent />
          <Stat label="Page views" value={num(o?.total_page_views)} />
          <Stat label="Sessions" value={num(o?.total_sessions)} />
          <Stat label="Repeat visitors" value={`${num(o?.returning_visitors)} (${returningPct}%)`} accent />
          <Stat label="Quiz starts" value={num(o?.quiz_starts)} />
          <Stat label="Recommendations served" value={num(o?.recommendations_served)} />
          <Stat label="Movies saved" value={num(o?.saves)} />
          <Stat label="Online now" value={num(rt?.activeVisitors)} accent />
        </div>

        <Card title="Hourly traffic — last 24h">
          {dash?.hourlyTraffic.length ? (
            <>
              <div className="p-4">
                <BarChart data={dash.hourlyTraffic.map((h) => ({ label: fmtHour(h.hour), value: Number(h.page_views) }))} />
                <div className="mt-4">
                  <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">Unique visitors</p>
                  <BarChart height={90} color="#38bdf8" data={dash.hourlyTraffic.map((h) => ({ label: fmtHour(h.hour), value: Number(h.unique_visitors) }))} />
                </div>
              </div>
            </>
          ) : (
            <p className="p-4 text-sm text-zinc-500">No traffic in the last 24 hours.</p>
          )}
        </Card>

        <Card title="Daily page views">
          {dash?.dailyTraffic.length ? (
            <div className="p-4">
              <BarChart data={dash.dailyTraffic.map((d) => ({ label: fmtDay(d.day), value: Number(d.page_views) }))} />
            </div>
          ) : (
            <p className="p-4 text-sm text-zinc-500">No data in this range.</p>
          )}
        </Card>

        <Card title="Repeat vs. new visitors">
          {dash?.visitorTrend.length ? (
            <div className="p-4">
              <BarChart height={100} color="#a3e635" data={dash.visitorTrend.map((d) => ({ label: `${fmtDay(d.day)} — returning`, value: Number(d.returning) }))} />
              <div className="mt-3">
                <BarChart height={100} color="#e879f9" data={dash.visitorTrend.map((d) => ({ label: `${fmtDay(d.day)} — new`, value: Number(d.new_visitors) }))} />
              </div>
              <p className="mt-2 text-xs text-zinc-500">Green = returning, pink = new</p>
            </div>
          ) : (
            <p className="p-4 text-sm text-zinc-500">No data in this range.</p>
          )}
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card title="Top cities">
            <ListTable
              head={['City', 'Country', 'Visitors']}
              rows={(dash?.topCities ?? []).map((c) => [String(c.city), String(c.country_name || c.country_code || ''), num(c.visitors as string)])}
            />
          </Card>
          <Card title="States / regions">
            <ListTable
              head={['Region', 'Country', 'Visitors']}
              rows={(dash?.topRegions ?? []).map((r) => [String(r.region_name), String(r.country_name ?? ''), num(r.visitors as string)])}
            />
          </Card>
          <Card title="Countries">
            <ListTable
              head={['Country', 'Visitors', 'Page views']}
              rows={(dash?.topCountries ?? []).map((c) => [String(c.country_name || c.country_code), '', num(c.visitors as string)])}
            />
          </Card>
          <Card title="Top pages">
            <ListTable
              head={['Page', 'Views', 'Visitors']}
              rows={(dash?.topPages ?? []).map((p) => [String(p.path), '', num(p.page_views as string)])}
            />
          </Card>
          <Card title="Referrers">
            <ListTable
              head={['Source', '', 'Visits']}
              rows={(dash?.topReferrers ?? []).map((r) => [String(r.referrer), '', num(r.count as string)])}
            />
          </Card>
          <Card title="Site events">
            <ListTable
              head={['Event', '', 'Count']}
              rows={(dash?.events ?? []).map((e) => [String(e.event_type), '', num(e.count)])}
            />
          </Card>
        </div>

        <Card title="Live activity — last 5 minutes">
          {(rt?.activePages.length ?? 0) || (rt?.activeCountries.length ?? 0) ? (
            <div className="grid gap-4 p-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">Pages being viewed</p>
                <ul className="space-y-1 text-sm">
                  {rt!.activePages.map((p) => (
                    <li key={p.path} className="flex justify-between rounded bg-zinc-900/60 px-3 py-1.5">
                      <span className="text-zinc-200">{p.path}</span>
                      <span className="text-zinc-500">{p.views} view{Number(p.views) === 1 ? '' : 's'}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">Where they are</p>
                <ul className="space-y-1 text-sm">
                  {rt!.activeCountries.map((c) => (
                    <li key={c.country_code} className="flex justify-between rounded bg-zinc-900/60 px-3 py-1.5">
                      <span className="text-zinc-200">{c.country_name || c.country_code}</span>
                      <span className="text-zinc-500">{c.visitors}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="p-4 text-sm text-zinc-500">No live visitors right now. Dashboard auto-refreshes every 15s.</p>
          )}
        </Card>

        <footer className="pb-8 text-center text-xs text-zinc-600">
          Public traffic dashboard · IPs are one-way hashed · no cookies cross sites · <a href="/" className="underline hover:text-zinc-400">movie-night-picker</a>
        </footer>
      </main>
    </div>
  );
}
