import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { DeviceCodeLoginResponse } from '@mosbot/shared';

export const AccountsPage = (): JSX.Element => {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['status'], queryFn: api.status, refetchInterval: 5_000 });
  const [pending, setPending] = useState<
    Record<string, DeviceCodeLoginResponse | undefined>
  >({});

  const start = async (name: string): Promise<void> => {
    const res = await api.loginAccount(name);
    setPending((p) => ({ ...p, [name]: res }));
  };
  const logout = async (name: string): Promise<void> => {
    await api.logoutAccount(name);
    setPending((p) => ({ ...p, [name]: undefined }));
    await qc.invalidateQueries({ queryKey: ['status'] });
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Accounts</h1>
      <div className="grid md:grid-cols-2 gap-4">
        {(status.data?.accounts ?? []).map((a) => (
          <Card key={a.name}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{a.name}</span>
                <Badge variant={a.loggedIn ? 'success' : 'outline'}>
                  {a.loggedIn ? 'online' : 'offline'}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="text-sm">
                <div>
                  <span className="text-muted-foreground">Twitch user: </span>
                  {a.username ?? '—'}
                </div>
                <div>
                  <span className="text-muted-foreground">Enabled: </span>
                  {a.enabled ? 'yes' : 'no'}
                </div>
              </div>
              {pending[a.name] && (
                <div className="rounded-md border p-3 bg-card">
                  <p className="text-sm">
                    Go to{' '}
                    <a
                      className="text-primary underline"
                      href={pending[a.name]!.verificationUri}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {pending[a.name]!.verificationUri}
                    </a>{' '}
                    and enter:
                  </p>
                  <p className="mt-1 font-mono text-2xl tracking-widest">
                    {pending[a.name]!.userCode}
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={() => start(a.name)} disabled={a.loggedIn}>
                  Login (Device Code)
                </Button>
                <Button variant="outline" onClick={() => logout(a.name)} disabled={!a.loggedIn}>
                  Log out
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};
