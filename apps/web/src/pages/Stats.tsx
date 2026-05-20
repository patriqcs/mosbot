import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, MessagesSquare, Send, Users } from 'lucide-react';
import { api } from '@/lib/api';
import type { StatsRange } from '@mosbot/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MetricTile } from '@/components/ui/metric-tile';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { formatNumber, formatTime, formatTimestamp } from '@/lib/utils';

const RANGES: StatsRange[] = ['24h', '7d', '30d'];

const tooltipStyle = {
  contentStyle: {
    backgroundColor: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
    color: 'hsl(var(--popover-foreground))',
    fontSize: '12px',
    padding: '8px 10px',
    boxShadow: '0 4px 18px rgb(0 0 0 / 0.25)',
  },
  labelStyle: {
    color: 'hsl(var(--muted-foreground))',
    fontSize: '11px',
    marginBottom: '4px',
  },
  itemStyle: { color: 'hsl(var(--popover-foreground))' },
  cursor: { fill: 'hsl(var(--muted) / 0.25)' },
};

export const StatsPage = (): JSX.Element => {
  const [range, setRange] = useState<StatsRange>('24h');
  const q = useQuery({
    queryKey: ['stats', range],
    queryFn: () => api.stats(range),
    refetchInterval: 30_000,
  });
  const totals = q.data?.totals;
  const buckets = q.data?.buckets ?? [];
  const topChannels = q.data?.topChannels ?? [];
  const chatLogEnabled = q.data?.chatLogEnabled ?? false;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Stats"
        description="Aggregated activity across all accounts — !plays issued, lobbies detected, chat messages observed."
        actions={
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            {RANGES.map((r) => (
              <Button
                key={r}
                variant={range === r ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setRange(r)}
                className="h-8 px-3 text-xs font-mono uppercase tracking-wide"
              >
                {r}
              </Button>
            ))}
          </div>
        }
      />

      <div
        className={`grid grid-cols-1 gap-4 ${
          chatLogEnabled ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
        }`}
      >
        <MetricTile
          label="Plays"
          value={formatNumber(totals?.plays ?? 0)}
          icon={Send}
          accent="primary"
          hint={`In the last ${range}`}
        />
        <MetricTile
          label="Lobbies"
          value={formatNumber(totals?.lobbies ?? 0)}
          icon={Users}
          accent="info"
          hint="Distinct lobby windows"
        />
        {chatLogEnabled && (
          <MetricTile
            label="Chat messages"
            value={formatNumber(totals?.chatMessages ?? 0)}
            icon={MessagesSquare}
            accent="muted"
            hint="Across joined channels"
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-primary" />
              Plays &amp; lobbies over time
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64 pt-0">
            {buckets.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  icon={BarChart3}
                  title="No data yet"
                  description="Once the bot starts seeing activity, points will appear here."
                  className="border-none bg-transparent"
                />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={buckets} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="at"
                    tickFormatter={(v: string) =>
                      range === '24h' ? formatTime(v) : formatTimestamp(v)
                    }
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fontSize: 11 }}
                    tickMargin={6}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fontSize: 11 }}
                    width={32}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    labelFormatter={(v) => formatTimestamp(String(v))}
                  />
                  <Line
                    type="monotone"
                    dataKey="plays"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, stroke: 'hsl(var(--primary))', strokeWidth: 2 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="lobbies"
                    stroke="hsl(var(--info))"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, stroke: 'hsl(var(--info))', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-info" />
              Top channels
            </CardTitle>
          </CardHeader>
          <CardContent className="h-80 pt-0">
            {topChannels.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  icon={BarChart3}
                  title="No channels yet"
                  description="As the bot joins channels and sends !play, the busiest ones show up here."
                  className="border-none bg-transparent"
                />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topChannels}
                  margin={{ top: 8, right: 8, bottom: 56, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="channel"
                    stroke="hsl(var(--muted-foreground))"
                    interval={0}
                    angle={-35}
                    textAnchor="end"
                    height={60}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    allowDecimals={false}
                    tick={{ fontSize: 11 }}
                    width={32}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="plays" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
