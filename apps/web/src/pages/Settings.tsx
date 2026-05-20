import { useCallback, useEffect, useMemo, useState } from 'react';
import { dump as dumpYaml, load as loadYaml } from 'js-yaml';
import { AppConfig } from '@mosbot/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldHelp, TooltipProvider } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { useAutoSave } from '@/lib/useAutoSave';
import { useRestartDetection } from '@/lib/useRestartDetection';
import { UndoToast, ErrorToast } from '@/components/UndoToast';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageHeader } from '@/components/ui/page-header';
import { AlertTriangle } from 'lucide-react';

const ENV_PATTERN = /\$\{([A-Z0-9_]+)\}/g;

const interpolateEnv = (input: unknown): unknown => {
  if (typeof input === 'string') {
    // Client-side has no env access; substitute placeholders with a non-empty
    // stand-in so .min(1) checks for secret fields pass during local validation.
    return input.replace(ENV_PATTERN, '_env_');
  }
  if (Array.isArray(input)) return input.map(interpolateEnv);
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = interpolateEnv(v);
    }
    return out;
  }
  return input;
};

const validateRawConfig = (raw: string): string | null => {
  let parsed: unknown;
  try {
    parsed = loadYaml(raw);
  } catch (err) {
    return `Invalid YAML: ${(err as Error).message}`;
  }
  const interpolated = interpolateEnv(parsed);
  const result = AppConfig.safeParse(interpolated);
  if (result.success) return null;
  const first = result.error.issues[0];
  if (!first) return 'Config validation failed.';
  const path = first.path.join('.') || '(root)';
  return `${path}: ${first.message}`;
};

type Mode = 'form' | 'yaml';

interface AccountEntry {
  name: string;
  enabled: boolean;
  clientId: string;
}

interface EditableConfig {
  discovery: {
    intervalMinutes: number;
    maxStreams: number;
    minViewers: number;
    language: string | null;
    sortBy: 'most-viewers' | 'least-viewers';
  };
  lobby: {
    windowSeconds: number;
    minPlayers: number;
    cooldownSeconds: number;
  };
  ratelimit: {
    userChatBudgetPer30s: number;
    verifiedBot: boolean;
  };
  channels: {
    whitelist: string[];
    blacklist: string[];
    prefer: string[];
  };
  logging: {
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
    rotateDays: number;
    chatLog: boolean;
    chatLogRetentionDays: number;
  };
  schedule: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: string;
  };
  accounts: AccountEntry[];
  server: {
    host: string;
    port: number;
    auth: { username: string; passwordHash: string };
  };
  database: { path: string };
}

const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;

const detectBrowserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const isValidTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const;

export const SettingsPage = (): JSX.Element => {
  const [initial, setInitial] = useState<{ raw: string; path: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getConfig()
      .then(setInitial)
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  if (loadError) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
        {loadError}
      </div>
    );
  }
  if (!initial) {
    return <p className="text-sm text-muted-foreground">Loading settings…</p>;
  }
  return <SettingsEditor initialRaw={initial.raw} path={initial.path} />;
};

interface SettingsEditorProps {
  initialRaw: string;
  path: string;
}

const SettingsEditor = ({ initialRaw, path }: SettingsEditorProps): JSX.Element => {
  const [mode, setMode] = useState<Mode>('form');
  const { raw, setRaw, undoState, undo, dismissUndo, error, clearError } = useAutoSave(
    initialRaw,
    api.saveConfig,
    { validate: validateRawConfig },
  );
  const [restartPending, setRestartPending] = useState<string[]>([]);

  useEffect(() => {
    if (!undoState) return;
    const sections = undoState.lastResult.restartRequiredSections;
    if (sections.length === 0) return;
    setRestartPending((prev) => Array.from(new Set([...prev, ...sections])));
  }, [undoState]);

  const clearRestartPending = useCallback(() => setRestartPending([]), []);
  useRestartDetection(clearRestartPending);

  const parsed = useMemo<EditableConfig | null>(() => {
    if (!raw) return null;
    try {
      const rawParsed = loadYaml(raw) as Partial<EditableConfig>;
      if (!rawParsed || typeof rawParsed !== 'object') return null;
      return {
        ...(rawParsed as EditableConfig),
        schedule: rawParsed.schedule ?? {
          enabled: false,
          start: '08:00',
          end: '22:00',
          timezone: detectBrowserTimezone(),
        },
      };
    } catch {
      return null;
    }
  }, [raw]);

  const updateRawFromForm = (next: EditableConfig): void => {
    const full = loadYaml(raw) as Record<string, unknown>;
    const merged = { ...full, ...next } as Record<string, unknown>;
    setRaw(dumpYaml(merged, { lineWidth: 100, noRefs: true }));
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Settings"
          description={
            <>
              Editing{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                {path}
              </code>
              . Changes save automatically and apply live where possible.
            </>
          }
          actions={
            <div className="inline-flex rounded-md border border-border bg-card p-0.5">
              <Button
                variant={mode === 'form' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setMode('form')}
                className="h-8 px-3 text-xs"
              >
                Form
              </Button>
              <Button
                variant={mode === 'yaml' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setMode('yaml')}
                className="h-8 px-3 text-xs"
              >
                YAML
              </Button>
            </div>
          }
        />

        <p className="text-xs text-muted-foreground">
          Secrets (<code>{'${TWITCH_CLIENT_ID}'}</code>,{' '}
          <code>{'${DASHBOARD_PASSWORD_HASH}'}</code>) are env-var references — do not
          edit them through the form.
        </p>

        {restartPending.length > 0 && (
          <div className="fade-rise flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="flex-1">
              <p className="font-semibold text-warning">Container restart required</p>
              <p className="mt-0.5 text-xs text-warning/80">
                Pending sections: <span className="font-mono">{restartPending.join(', ')}</span>.
                The new values are saved to YAML on disk and take effect on the next
                container restart. This banner will clear automatically when a restart
                is detected.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRestartPending([])}
              className="shrink-0 self-start text-warning/70 transition-colors hover:text-warning"
              aria-label="dismiss"
            >
              ×
            </button>
          </div>
        )}

        {mode === 'form' && parsed && (
          <>
            <FormView config={parsed} onChange={updateRawFromForm} />
            <RestartRequiredSections config={parsed} onApply={updateRawFromForm} />
          </>
        )}
        {mode === 'form' && !parsed && raw && (
          <Card>
            <CardContent className="py-4 text-sm text-muted-foreground">
              YAML is currently invalid — switch to YAML mode to fix.
            </CardContent>
          </Card>
        )}

        {mode === 'yaml' && (
          <Card>
            <CardHeader>
              <CardTitle>YAML (read-only)</CardTitle>
            </CardHeader>
            <CardContent>
              <textarea
                value={raw}
                readOnly
                spellCheck={false}
                className="h-[60vh] w-full rounded-md border bg-muted/30 p-3 font-mono text-xs"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                YAML viewing only. Use the Form mode to edit settings.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {error && <ErrorToast message={error} onDismiss={clearError} />}
      {!error && undoState && (
        <UndoToast
          count={undoState.count}
          restartRequired={undoState.lastResult.restartRequired}
          onUndo={() => void undo()}
          onDismiss={dismissUndo}
        />
      )}
    </TooltipProvider>
  );
};

interface RestartRequiredSectionsProps {
  config: EditableConfig;
  onApply: (next: EditableConfig) => void;
}

const RestartRequiredSections = ({
  config,
  onApply,
}: RestartRequiredSectionsProps): JSX.Element => (
  <div className="flex flex-col gap-4">
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Requires container restart
      </h2>
      <FieldHelp text="Changes in these sections need a container restart to take effect. Each section has its own Apply button with a confirmation dialog so you don't trigger a restart by accident." />
    </div>
    <div className="grid gap-6 md:grid-cols-2">
      <AccountsCard
        value={config.accounts}
        onApply={(next) => onApply({ ...config, accounts: next })}
      />
      <ServerBindCard
        value={{ host: config.server.host, port: config.server.port }}
        onApply={(next) =>
          onApply({ ...config, server: { ...config.server, ...next } })
        }
      />
      <DatabaseCard
        value={config.database}
        onApply={(next) => onApply({ ...config, database: next })}
      />
      <LogRotateCard
        value={config.logging.rotateDays}
        onApply={(next) =>
          onApply({ ...config, logging: { ...config.logging, rotateDays: next } })
        }
      />
    </div>
  </div>
);

interface AccountsCardProps {
  value: AccountEntry[];
  onApply: (next: AccountEntry[]) => void;
}

const AccountsCard = ({ value, onApply }: AccountsCardProps): JSX.Element => {
  const [draft, setDraft] = useState<AccountEntry[]>(value);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => setDraft(value), [value]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(value);
  const updateRow = (i: number, patch: Partial<AccountEntry>): void => {
    setDraft(draft.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  };
  const addRow = (): void =>
    setDraft([...draft, { name: '', enabled: false, clientId: '${TWITCH_CLIENT_ID}' }]);
  const removeRow = (i: number): void => setDraft(draft.filter((_, idx) => idx !== i));

  return (
    <Card className="md:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Accounts</CardTitle>
        <Button
          variant="outline"
          size="sm"
          disabled={!dirty}
          onClick={() => setConfirmOpen(true)}
        >
          Apply (restart)
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Twitch bot accounts. Adding, removing or toggling an account requires a
          container restart. The Client ID typically references an env var, e.g.
          <code> ${'${TWITCH_CLIENT_ID}'}</code>.
        </p>
        {draft.length === 0 && (
          <p className="text-xs text-muted-foreground">No accounts configured.</p>
        )}
        {draft.map((account, i) => (
          <div
            key={i}
            className="grid grid-cols-1 gap-2 rounded-md border bg-muted/30 p-3 md:grid-cols-[1fr_auto_2fr_auto]"
          >
            <Input
              value={account.name}
              onChange={(e) => updateRow(i, { name: e.target.value })}
              placeholder="account name"
            />
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={account.enabled}
                onChange={(e) => updateRow(i, { enabled: e.target.checked })}
                className="h-4 w-4"
              />
              enabled
            </label>
            <Input
              value={account.clientId}
              onChange={(e) => updateRow(i, { clientId: e.target.value })}
              placeholder="${TWITCH_CLIENT_ID}"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => removeRow(i)}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          Add account
        </Button>
      </CardContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Apply account changes?"
        description={
          <span>
            Account add/remove/enable changes only take effect after a container restart.
            The new values will be saved to the YAML on disk now; you must restart the
            container yourself to load them.
          </span>
        }
        confirmLabel="Save now"
        onConfirm={() => onApply(draft)}
      />
    </Card>
  );
};

interface ServerBindValue {
  host: string;
  port: number;
}

interface ServerBindCardProps {
  value: ServerBindValue;
  onApply: (next: ServerBindValue) => void;
}

const ServerBindCard = ({ value, onApply }: ServerBindCardProps): JSX.Element => {
  const [draft, setDraft] = useState<ServerBindValue>(value);
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const dirty = draft.host !== value.host || draft.port !== value.port;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Server bind</CardTitle>
        <Button
          variant="outline"
          size="sm"
          disabled={!dirty}
          onClick={() => setConfirmOpen(true)}
        >
          Apply (restart)
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <LabeledText
          label="Host"
          help="IP address the HTTP API binds to. 0.0.0.0 = all interfaces (typical for Docker). Restart-required because the listener is bound once at startup."
          value={draft.host}
          onChange={(host) => setDraft({ ...draft, host })}
        />
        <LabeledNumber
          label="Port"
          help="Port number the HTTP API listens on. Make sure the host firewall and Docker port mapping match. Default 8787."
          min={1}
          max={65535}
          value={draft.port}
          onChange={(port) => setDraft({ ...draft, port })}
        />
      </CardContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Apply server bind changes?"
        description={
          <span>
            Changing host or port requires a container restart. The new values will be
            saved to YAML now; restart the container to reload.
          </span>
        }
        confirmLabel="Save now"
        onConfirm={() => onApply(draft)}
      />
    </Card>
  );
};

interface DatabaseCardProps {
  value: { path: string };
  onApply: (next: { path: string }) => void;
}

const DatabaseCard = ({ value, onApply }: DatabaseCardProps): JSX.Element => {
  const [draft, setDraft] = useState(value);
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const dirty = draft.path !== value.path;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Database</CardTitle>
        <Button
          variant="outline"
          size="sm"
          disabled={!dirty}
          onClick={() => setConfirmOpen(true)}
        >
          Apply (restart)
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <LabeledText
          label="SQLite file path"
          help="Where the SQLite database file lives inside the container. The mapped volume on the host must point to this path. Changing it without migrating data effectively starts a fresh database."
          value={draft.path}
          onChange={(path) => setDraft({ path })}
        />
      </CardContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Apply database path change?"
        description={
          <span>
            Pointing at a different SQLite file means the bot will use a different
            database on the next start. Any in-memory state (stats, chat log, timers)
            stays in the old file; the new file starts empty unless you copied data.
          </span>
        }
        confirmLabel="Save now"
        destructive
        onConfirm={() => onApply(draft)}
      />
    </Card>
  );
};

interface LogRotateCardProps {
  value: number;
  onApply: (next: number) => void;
}

const LogRotateCard = ({ value, onApply }: LogRotateCardProps): JSX.Element => {
  const [draft, setDraft] = useState(value);
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const dirty = draft !== value;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Log rotation</CardTitle>
        <Button
          variant="outline"
          size="sm"
          disabled={!dirty}
          onClick={() => setConfirmOpen(true)}
        >
          Apply (restart)
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <LabeledNumber
          label="Rotate after (days)"
          help="Log files older than this are deleted by pino-roll. The rotation interval is configured once at startup, so changing it needs a container restart."
          min={1}
          max={365}
          value={draft}
          onChange={setDraft}
        />
      </CardContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Apply log rotation change?"
        description={
          <span>
            Log-file rotation is configured once at container startup. The new value
            will be saved to YAML now and applied on the next restart.
          </span>
        }
        confirmLabel="Save now"
        onConfirm={() => onApply(draft)}
      />
    </Card>
  );
};

interface FormViewProps {
  config: EditableConfig;
  onChange: (next: EditableConfig) => void;
}

const FormView = ({ config, onChange }: FormViewProps): JSX.Element => {
  const update = <K extends keyof EditableConfig>(
    section: K,
    patch: Partial<EditableConfig[K]>,
  ): void => {
    onChange({ ...config, [section]: { ...config[section], ...patch } });
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Discovery</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <LabeledNumber
            label="Interval (minutes)"
            help="How often the bot queries Twitch Helix for live Marbles-on-Stream channels. Lower = faster reaction to new streams, but more API traffic. Default 3."
            value={config.discovery.intervalMinutes}
            min={1}
            max={60}
            onChange={(v) => update('discovery', { intervalMinutes: v })}
          />
          <LabeledNumber
            label="Max streams"
            help="Upper bound on channels the bot tracks at any time. Higher = more chat presence, but also more rate-limit pressure on the account. Default 20."
            value={config.discovery.maxStreams}
            min={1}
            max={100}
            onChange={(v) => update('discovery', { maxStreams: v })}
          />
          <LabeledNumber
            label="Min viewers"
            help="Skip streams below this viewer count. Raise to focus on larger audiences, lower to join smaller streams. Default 30."
            value={config.discovery.minViewers}
            min={0}
            onChange={(v) => update('discovery', { minViewers: v })}
          />
          <LabeledText
            label="Languages (ISO codes, comma-separated, empty = any)"
            help="ISO language code(s), e.g. 'en' for English only, or 'de,en' for German + English. Multiple codes are comma-separated. Only streams in one of these languages are considered. Leave empty to accept any language."
            value={config.discovery.language ?? ''}
            onChange={(v) => update('discovery', { language: v.trim() === '' ? null : v })}
          />
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1.5 text-xs font-medium">
              Prefer
              <FieldHelp text="'Most viewers' picks the top-N streams ranked by viewer count (fastest, default). 'Least viewers' picks the smallest streams above the Min-viewers floor — useful for smaller communities where !play competition is lower. Changing this takes effect on the next Discovery interval." />
            </label>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={config.discovery.sortBy === 'most-viewers' ? 'default' : 'outline'}
                onClick={() => update('discovery', { sortBy: 'most-viewers' })}
              >
                Most viewers
              </Button>
              <Button
                size="sm"
                variant={config.discovery.sortBy === 'least-viewers' ? 'default' : 'outline'}
                onClick={() => update('discovery', { sortBy: 'least-viewers' })}
              >
                Least viewers
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lobby</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <LabeledNumber
            label="Window (seconds)"
            help="Rolling time window during which distinct !play messages must appear to count as an open lobby. Default 30."
            value={config.lobby.windowSeconds}
            min={5}
            max={600}
            onChange={(v) => update('lobby', { windowSeconds: v })}
          />
          <LabeledNumber
            label="Min players"
            help="Number of distinct OTHER users that must send !play within the window before the bot joins in by sending its own !play. Default 4."
            value={config.lobby.minPlayers}
            min={1}
            max={100}
            onChange={(v) => update('lobby', { minPlayers: v })}
          />
          <LabeledNumber
            label="Cooldown (seconds)"
            help="After the bot sends its own !play in a channel, it will not send another for this many seconds — prevents spam on back-to-back lobbies. Default 180."
            value={config.lobby.cooldownSeconds}
            min={0}
            max={3600}
            onChange={(v) => update('lobby', { cooldownSeconds: v })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rate limit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <LabeledNumber
            label="User chat budget / 30s"
            help="Maximum chat messages the bot may send per 30 s. Twitch caps regular accounts at 20; this default (16) leaves safety margin so any miner sending !play on the same account does not push us over."
            value={config.ratelimit.userChatBudgetPer30s}
            min={1}
            max={100}
            onChange={(v) => update('ratelimit', { userChatBudgetPer30s: v })}
          />
          <LabeledCheckbox
            label="Verified bot (45 msg/30s)"
            help="Enable ONLY if the Twitch account is granted Verified Bot status. Raises the effective budget to 45 msg / 30 s. Default off."
            value={config.ratelimit.verifiedBot}
            onChange={(v) => update('ratelimit', { verifiedBot: v })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logging</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1.5 text-xs font-medium">
              Level
              <FieldHelp text="Lowest severity captured in logs. 'trace' and 'debug' are very verbose; 'info' is the default for production. Changing this via YAML requires restart; use the Logs page for runtime changes." />
            </label>
            <div className="flex gap-1">
              {LOG_LEVELS.map((l) => (
                <Button
                  key={l}
                  size="sm"
                  variant={config.logging.level === l ? 'default' : 'outline'}
                  onClick={() => update('logging', { level: l })}
                >
                  {l}
                </Button>
              ))}
            </div>
          </div>
          <LabeledNumber
            label="Rotate after (days)"
            help="Log files older than this are deleted by pino-roll. Default 14."
            value={config.logging.rotateDays}
            min={1}
            max={365}
            onChange={(v) => update('logging', { rotateDays: v })}
          />
          <LabeledCheckbox
            label="Persist chat messages to SQLite"
            help="Store every observed chat message into the SQLite database for stats and retrospective analysis. Off = stats still count !play events but individual messages are not kept."
            value={config.logging.chatLog}
            onChange={(v) => update('logging', { chatLog: v })}
          />
          <LabeledNumber
            label="Chat log retention (days)"
            help="Chat rows older than this many days are deleted every hour. A VACUUM runs every 24 h to reclaim disk space. Default 14. Only relevant when 'Persist chat messages' is enabled."
            value={config.logging.chatLogRetentionDays}
            min={1}
            max={365}
            onChange={(v) => update('logging', { chatLogRetentionDays: v })}
          />
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ScheduleEditor
            value={config.schedule}
            onChange={(v) => update('schedule', v)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dashboard login</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <LabeledText
            label="Username"
            help="Username for the dashboard login form. Read live on each request — change applies immediately."
            value={config.server.auth.username}
            onChange={(v) =>
              update('server', { auth: { ...config.server.auth, username: v } })
            }
          />
          <LabeledText
            label="Password hash (argon2)"
            help="Argon2 password hash. If you reference an env var like ${DASHBOARD_PASSWORD_HASH}, do not edit here — change it on the container. Otherwise paste a fresh argon2 hash."
            value={config.server.auth.passwordHash}
            onChange={(v) =>
              update('server', { auth: { ...config.server.auth, passwordHash: v } })
            }
          />
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Channels</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <TagList
            label="Whitelist (only these channels joined, case-insensitive)"
            help="If non-empty, Discovery results are filtered down to ONLY these logins. Everything else is ignored. Useful for focused testing or restricting to known-safe channels."
            values={config.channels.whitelist}
            onChange={(v) => update('channels', { whitelist: v })}
          />
          <TagList
            label="Blacklist (never joined)"
            help="Channel logins the bot must never join, even if they appear in Discovery. Typically used to respect streamers who asked not to be joined."
            values={config.channels.blacklist}
            onChange={(v) => update('channels', { blacklist: v })}
          />
          <TagList
            label="Prefer list (auto-prioritised when online)"
            help="Channels in this list are always joined when online, even if a Whitelist is set (Blacklist still wins). When a prefer-channel comes online and all 3 Marbles-Timer slots are full, the slot with the shortest remaining time is skipped and replaced by the prefer-channel. The 'Prefer' setting in Discovery (most/least viewers) decides which candidate is picked when several prefer-channels are online or when a freed slot must be refilled."
            values={config.channels.prefer ?? []}
            onChange={(v) => update('channels', { prefer: v })}
          />
        </CardContent>
      </Card>

    </div>
  );
};

interface LabeledNumberProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  help?: string;
  onChange: (v: number) => void;
}

const LabeledNumber = ({
  label,
  value,
  min,
  max,
  help,
  onChange,
}: LabeledNumberProps): JSX.Element => (
  <div className="flex flex-col gap-1">
    <label className="flex items-center gap-1.5 text-xs font-medium">
      {label}
      {help && <FieldHelp text={help} />}
    </label>
    <Input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  </div>
);

interface LabeledTextProps {
  label: string;
  value: string;
  help?: string;
  onChange: (v: string) => void;
}

const LabeledText = ({ label, value, help, onChange }: LabeledTextProps): JSX.Element => (
  <div className="flex flex-col gap-1">
    <label className="flex items-center gap-1.5 text-xs font-medium">
      {label}
      {help && <FieldHelp text={help} />}
    </label>
    <Input value={value} onChange={(e) => onChange(e.target.value)} />
  </div>
);

interface LabeledCheckboxProps {
  label: string;
  value: boolean;
  help?: string;
  onChange: (v: boolean) => void;
}

const LabeledCheckbox = ({
  label,
  value,
  help,
  onChange,
}: LabeledCheckboxProps): JSX.Element => (
  <div className="flex items-center gap-2 text-sm">
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4"
      />
      {label}
    </label>
    {help && <FieldHelp text={help} />}
  </div>
);

interface TagListProps {
  label: string;
  values: string[];
  help?: string;
  onChange: (v: string[]) => void;
}

interface ScheduleEditorProps {
  value: EditableConfig['schedule'];
  onChange: (v: EditableConfig['schedule']) => void;
}

const ScheduleEditor = ({ value, onChange }: ScheduleEditorProps): JSX.Element => {
  const overnight = value.start !== value.end && value.start > value.end;
  const sameTime = value.start === value.end;
  const startInvalid = !TIME_24H.test(value.start);
  const endInvalid = !TIME_24H.test(value.end);
  const tzInvalid = value.timezone.length === 0 || !isValidTimezone(value.timezone);

  return (
    <div className="space-y-3">
      <LabeledCheckbox
        label="Schedule enabled"
        help="When on, the bot only runs inside the Start–End window. Outside the window it is automatically stopped. A manual Start/Stop overrides until the next schedule edge."
        value={value.enabled}
        onChange={(v) => onChange({ ...value, enabled: v })}
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1.5 text-xs font-medium">
            Start (24h)
            <FieldHelp text="Time of day when the bot starts. HH:MM, 24-hour format. Interpreted in the timezone selected below." />
          </label>
          <Input
            type="time"
            step={60}
            value={value.start}
            onChange={(e) => onChange({ ...value, start: e.target.value })}
            disabled={!value.enabled}
          />
          {startInvalid && (
            <p className="text-xs text-destructive">Invalid time. Expected HH:MM.</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1.5 text-xs font-medium">
            End (24h)
            <FieldHelp text="Time of day when the bot stops. If End is earlier than Start, the window crosses midnight (e.g. 22:00–06:00)." />
          </label>
          <Input
            type="time"
            step={60}
            value={value.end}
            onChange={(e) => onChange({ ...value, end: e.target.value })}
            disabled={!value.enabled}
          />
          {endInvalid && (
            <p className="text-xs text-destructive">Invalid time. Expected HH:MM.</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1.5 text-xs font-medium">
            Timezone
            <FieldHelp text="IANA timezone such as 'Europe/Berlin' or 'America/New_York'. Determines how Start and End are interpreted. DST is handled automatically." />
          </label>
          <div className="flex gap-2">
            <Input
              value={value.timezone}
              onChange={(e) => onChange({ ...value, timezone: e.target.value.trim() })}
              placeholder="Europe/Berlin"
              disabled={!value.enabled}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange({ ...value, timezone: detectBrowserTimezone() })}
              disabled={!value.enabled}
              title="Detect browser timezone"
            >
              Auto
            </Button>
          </div>
          {tzInvalid && value.enabled && (
            <p className="text-xs text-destructive">
              Invalid IANA timezone (e.g. &ldquo;Europe/Berlin&rdquo;).
            </p>
          )}
        </div>
      </div>
      {sameTime && value.enabled && (
        <p className="text-xs text-destructive">Start and End must differ.</p>
      )}
      {overnight && value.enabled && !sameTime && !startInvalid && !endInvalid && (
        <p className="text-xs text-muted-foreground">
          Overnight window: bot runs from {value.start} across midnight until {value.end}.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Schedule changes apply live without a container restart.
      </p>
    </div>
  );
};

const TagList = ({ label, values, help, onChange }: TagListProps): JSX.Element => {
  const [input, setInput] = useState('');
  const add = (): void => {
    const v = input.trim();
    if (!v) return;
    if (values.includes(v)) {
      setInput('');
      return;
    }
    onChange([...values, v]);
    setInput('');
  };
  const remove = (v: string): void => onChange(values.filter((x) => x !== v));
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-1.5 text-xs font-medium">
        {label}
        {help && <FieldHelp text={help} />}
      </label>
      <div className="flex flex-wrap gap-1">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs"
          >
            {v}
            <button
              type="button"
              onClick={() => remove(v)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={`remove ${v}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="channel login…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
};
