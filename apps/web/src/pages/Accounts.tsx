import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { load as loadYaml } from 'js-yaml';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertTriangle,
  ExternalLink,
  KeyRound,
  LogOut,
  Plus,
  Power,
  Trash2,
  User,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { StatusDot } from '@/components/ui/status-dot';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useRestartDetection } from '@/lib/useRestartDetection';
import {
  addAccount,
  applyAccountsToYaml,
  createAccount,
  removeAccount as removeAccountInList,
  toggleAccount as toggleAccountInList,
  validateAccountName,
  type AccountEntry,
} from '@/lib/accounts-draft';
import type { DeviceCodeLoginResponse } from '@mosbot/shared';

const DEFAULT_CLIENT_ID = '${TWITCH_CLIENT_ID}';

const parseAccountsFromYaml = (raw: string): AccountEntry[] => {
  try {
    const parsed = loadYaml(raw) as { accounts?: unknown } | null;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.accounts)) {
      return [];
    }
    return parsed.accounts.map((a) => {
      const entry = a as Partial<AccountEntry>;
      return {
        name: String(entry.name ?? ''),
        enabled: Boolean(entry.enabled),
        clientId: String(entry.clientId ?? DEFAULT_CLIENT_ID),
      };
    });
  } catch {
    return [];
  }
};

export const AccountsPage = (): JSX.Element => {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['status'], queryFn: api.status, refetchInterval: 5_000 });
  const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig });

  const [pending, setPending] = useState<
    Record<string, DeviceCodeLoginResponse | undefined>
  >({});
  const [restartPending, setRestartPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const clearRestartPending = useCallback(() => setRestartPending(false), []);
  useRestartDetection(clearRestartPending);

  const yamlAccounts = useMemo(
    () => parseAccountsFromYaml(config.data?.raw ?? ''),
    [config.data?.raw],
  );

  const saveAccounts = useMutation({
    mutationFn: async (next: AccountEntry[]) => {
      const raw = config.data?.raw;
      if (!raw) throw new Error('config not loaded yet');
      const nextRaw = applyAccountsToYaml(raw, next);
      return api.saveConfig(nextRaw);
    },
    onSuccess: async (res) => {
      setSaveError(null);
      if (res.restartRequiredSections.includes('accounts')) {
        setRestartPending(true);
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['config'] }),
        qc.invalidateQueries({ queryKey: ['status'] }),
      ]);
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  const startLogin = async (name: string): Promise<void> => {
    const res = await api.loginAccount(name);
    setPending((p) => ({ ...p, [name]: res }));
  };
  const logout = async (name: string): Promise<void> => {
    await api.logoutAccount(name);
    setPending((p) => ({ ...p, [name]: undefined }));
    await qc.invalidateQueries({ queryKey: ['status'] });
  };

  const onAdd = (entry: AccountEntry): void => {
    try {
      const next = addAccount(yamlAccounts, entry);
      saveAccounts.mutate(next);
      setAddOpen(false);
    } catch (err) {
      setSaveError((err as Error).message);
    }
  };

  const onToggleEnabled = (name: string): void => {
    try {
      const next = toggleAccountInList(yamlAccounts, name);
      saveAccounts.mutate(next);
    } catch (err) {
      setSaveError((err as Error).message);
    }
  };

  const onRemove = (name: string): void => {
    try {
      const next = removeAccountInList(yamlAccounts, name);
      saveAccounts.mutate(next);
      setRemoveTarget(null);
    } catch (err) {
      setSaveError((err as Error).message);
    }
  };

  // Display merges YAML entries (source of truth for config) with live status.
  const statusAccounts = status.data?.accounts ?? [];
  const displayed = yamlAccounts.map((entry) => {
    const live = statusAccounts.find((s) => s.name === entry.name);
    return {
      name: entry.name,
      enabled: entry.enabled,
      clientId: entry.clientId,
      loggedIn: live?.loggedIn ?? false,
      username: live?.username ?? null,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Accounts"
        description="Twitch bot accounts. Use Device Code Flow to authorize an account — Twitch never sees a password."
        actions={
          <Button size="sm" onClick={() => setAddOpen(true)} disabled={!config.data}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add account
          </Button>
        }
      />

      <div
        role="alert"
        className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-destructive"
      >
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="space-y-1.5 text-sm">
          <p className="font-semibold uppercase tracking-wide">
            Warning — risk of in-game bans
          </p>
          <p className="leading-relaxed text-destructive/90">
            Automated play can lead to bans or other penalties on the target game. Always
            use the <span className="font-semibold">Schedule</span> to limit activity and
            never overdo it — running accounts around the clock dramatically increases the
            risk of detection.
          </p>
          <p className="leading-relaxed text-destructive/90">
            You are solely responsible for every account you connect. Use at your own risk.
          </p>
        </div>
      </div>

      {restartPending && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="flex-1">
            <p className="font-semibold text-warning">Container restart required</p>
            <p className="mt-0.5 text-xs text-warning/80">
              Account add/remove/enable changes are saved to YAML on disk but only take
              effect after a container restart. This banner clears automatically when a
              restart is detected.
            </p>
          </div>
          <button
            type="button"
            onClick={clearRestartPending}
            className="shrink-0 self-start text-warning/70 transition-colors hover:text-warning"
            aria-label="dismiss"
          >
            ×
          </button>
        </div>
      )}

      {saveError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {saveError}
        </div>
      )}

      {config.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading accounts…</p>
      ) : displayed.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No accounts configured"
          description="Click ‘Add account’ to create one. A container restart is required to load new accounts."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {displayed.map((a) => (
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

                <div className="rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-xs">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Client ID
                  </div>
                  <div className="mt-1 truncate font-mono">{a.clientId}</div>
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

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void startLogin(a.name)}
                    disabled={a.loggedIn}
                    size="sm"
                    className="flex-1 min-w-[7rem]"
                  >
                    <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                    Login
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
                  <Button
                    variant="outline"
                    onClick={() => onToggleEnabled(a.name)}
                    disabled={saveAccounts.isPending}
                    size="sm"
                    title="Toggling requires a container restart"
                  >
                    <Power className="mr-1.5 h-3.5 w-3.5" />
                    {a.enabled ? 'Disable' : 'Enable'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setRemoveTarget(a.name)}
                    disabled={saveAccounts.isPending}
                    size="sm"
                    aria-label={`remove ${a.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AddAccountDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        existingNames={yamlAccounts.map((a) => a.name)}
        onAdd={onAdd}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={`Remove account "${removeTarget ?? ''}"?`}
        description={
          <span>
            This removes the account from your YAML config. A container restart is
            required before the change fully takes effect.
          </span>
        }
        confirmLabel="Remove"
        destructive
        onConfirm={() => removeTarget && onRemove(removeTarget)}
      />
    </div>
  );
};

interface AddAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingNames: string[];
  onAdd: (entry: AccountEntry) => void;
}

const AddAccountDialog = ({
  open,
  onOpenChange,
  existingNames,
  onAdd,
}: AddAccountDialogProps): JSX.Element => {
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState(DEFAULT_CLIENT_ID);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setClientId(DEFAULT_CLIENT_ID);
      setLocalError(null);
    }
  }, [open]);

  const lowered = existingNames.map((n) => n.toLowerCase());

  const submit = (): void => {
    const result = validateAccountName(name);
    if (!result.ok) {
      setLocalError(result.reason);
      return;
    }
    if (lowered.includes(name.trim().toLowerCase())) {
      setLocalError(`account "${name}" already exists`);
      return;
    }
    if (!clientId.trim()) {
      setLocalError('client id is required');
      return;
    }
    onAdd(createAccount(name.trim(), clientId.trim()));
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 animate-in fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(90vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-md border bg-background p-5 shadow-lg animate-in fade-in zoom-in-95">
          <Dialog.Title className="text-base font-semibold">Add account</Dialog.Title>
          <Dialog.Description asChild>
            <div className="mt-2 text-sm text-muted-foreground">
              Adding an account writes it to the YAML config. A container restart is
              required before the bot picks it up.
            </div>
          </Dialog.Description>

          <div className="mt-4 space-y-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Name
              </span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. main"
                autoFocus
              />
              <span className="text-[11px] text-muted-foreground">
                lowercase letters, digits, and underscore only
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Client ID
              </span>
              <Input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="${TWITCH_CLIENT_ID}"
              />
              <span className="text-[11px] text-muted-foreground">
                typically an env var reference, e.g. <code>${'${TWITCH_CLIENT_ID}'}</code>
              </span>
            </label>

            {localError && (
              <p className="text-xs text-destructive" role="alert">
                {localError}
              </p>
            )}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            </Dialog.Close>
            <Button size="sm" onClick={submit}>
              Add
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
