import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const StreamsPage = (): JSX.Element => {
  const q = useQuery({ queryKey: ['streams'], queryFn: api.streams, refetchInterval: 10_000 });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Live Streams</h1>
      <Card>
        <CardHeader>
          <CardTitle>Discovered channels</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Streamer</th>
                <th className="px-4 py-2 text-right">Viewers</th>
                <th className="px-4 py-2 text-left">Lang</th>
                <th className="px-4 py-2 text-left">Joined</th>
                <th className="px-4 py-2 text-right">!play</th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((s) => (
                <tr key={s.userLogin} className="border-b last:border-0">
                  <td className="px-4 py-2 font-mono">{s.userLogin}</td>
                  <td className="px-4 py-2 text-right">{s.viewerCount.toLocaleString()}</td>
                  <td className="px-4 py-2">{s.language}</td>
                  <td className="px-4 py-2">
                    <Badge variant={s.joined ? 'success' : 'outline'}>
                      {s.joined ? 'yes' : 'no'}
                    </Badge>
                    {s.blacklisted && (
                      <Badge variant="destructive" className="ml-2">
                        blacklisted
                      </Badge>
                    )}
                    {s.whitelisted && (
                      <Badge variant="secondary" className="ml-2">
                        whitelisted
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">{s.playsSent}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(!q.data || q.data.length === 0) && (
            <div className="p-6 text-center text-muted-foreground">No streams discovered yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
