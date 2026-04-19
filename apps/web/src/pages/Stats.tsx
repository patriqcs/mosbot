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
import { api } from '@/lib/api';
import type { StatsRange } from '@mosbot/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const RANGES: StatsRange[] = ['24h', '7d', '30d'];

const tooltipStyle = {
  contentStyle: {
    backgroundColor: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '6px',
    color: 'hsl(var(--popover-foreground))',
    fontSize: '12px',
  },
  labelStyle: { color: 'hsl(var(--popover-foreground))' },
  itemStyle: { color: 'hsl(var(--popover-foreground))' },
  cursor: { fill: 'hsl(var(--muted) / 0.3)' },
};

export const StatsPage = (): JSX.Element => {
  const [range, setRange] = useState<StatsRange>('24h');
  const q = useQuery({
    queryKey: ['stats', range],
    queryFn: () => api.stats(range),
    refetchInterval: 30_000,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Stats</h1>
        <div className="flex gap-2">
          {RANGES.map((r) => (
            <Button
              key={r}
              variant={range === r ? 'default' : 'outline'}
              size="sm"
              onClick={() => setRange(r)}
            >
              {r}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Plays over time</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={q.data?.buckets ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="at"
                  tickFormatter={(v: string) => v.slice(11, 16)}
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis stroke="hsl(var(--muted-foreground))" />
                <Tooltip {...tooltipStyle} />
                <Line type="monotone" dataKey="plays" stroke="hsl(var(--primary))" />
                <Line type="monotone" dataKey="lobbies" stroke="hsl(var(--destructive))" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top channels</CardTitle>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={q.data?.topChannels ?? []}
                margin={{ top: 8, right: 8, bottom: 56, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="channel"
                  stroke="hsl(var(--muted-foreground))"
                  interval={0}
                  angle={-35}
                  textAnchor="end"
                  height={60}
                  tick={{ fontSize: 11 }}
                />
                <YAxis stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="plays" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Totals ({range})</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-xs text-muted-foreground">Plays</div>
            <div className="text-xl font-bold">{q.data?.totals.plays ?? 0}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Lobbies</div>
            <div className="text-xl font-bold">{q.data?.totals.lobbies ?? 0}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Chat msgs</div>
            <div className="text-xl font-bold">{q.data?.totals.chatMessages ?? 0}</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
