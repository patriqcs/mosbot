import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, KeyRound, LogOut, User } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { StatusDot } from '@/components/ui/status-dot';
import { EmptyState } from '@/components/ui/empty-state';
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

  const accounts = status.data?.accounts ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Accounts"
        description="Twitch bot accounts. Use Device Code Flow to authorize an account — Twitch never sees a password."
      />

      {accounts.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No accounts configured"
          description="Add at least one account in Settings → Accounts."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {accounts.map((a) => (
            <Card key={a.name} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-md bg-muted ring-1 ring-border">
                      <User className="h-5 w-5 text-muted-foreground" />
                    </span>
                    <div className="flex flex-col">
                      <CardTitle className="text-base">{a.name}</CardTitle>
                      <span className="font-mono text-xs text-muted-foreground">
                        {a.username ? `@${a.username}` : 'not authorized'}
                      </span>
                    </div>
                  </div>
                  <Badge
                    variant={a.loggedIn ? 'success' : a.enabled ? 'destructive' : 'outline'}
                    className="gap-1.5"
                  >
                    <StatusDot
                      variant={a.loggedIn ? 'success' : a.enabled ? 'destructive' : 'muted'}
                      pulse={a.loggedIn}
                      className="h-1.5 w-1.5"
                    />
                    {a.loggedIn ? 'online' : a.enabled ? 'offline' : 'disabled'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Enabled
                    </div>
                    <div className="mt-1 font-mono">{a.enabled ? 'yes' : 'no'}</div>
                  </div>
                  <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Twitch user
                    </div>
                    <div className="mt-1 truncate font-mono">{a.username ?? '—'}</div>
                  </div>
                </div>

                {pending[a.name] && (
                  <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
                    <p className="text-xs text-muted-foreground">
                      Open{' '}
                      <a
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                        href={pending[a.name]!.verificationUri}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {pending[a.name]!.verificationUri}
                        <ExternalLink className="h-3 w-3" />
                      </a>{' '}
                      and enter:
                    </p>
                    <p className="mt-3 select-all rounded-md border border-primary/40 bg-background/60 px-3 py-2 text-center font-mono text-2xl font-bold tracking-[0.3em] text-primary">
                      {pending[a.name]!.userCode}
                    </p>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    onClick={() => void start(a.name)}
                    disabled={a.loggedIn}
                    size="sm"
                    className="flex-1"
                  >
                    <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                    Login (Device Code)
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void logout(a.name)}
                    disabled={!a.loggedIn}
                    size="sm"
                  >
                    <LogOut className="mr-1.5 h-3.5 w-3.5" />
                    Log out
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
