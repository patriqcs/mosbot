import { useCallback, useEffect, useMemo, useState } from 'react';
import { dump as dumpYaml, load as loadYaml } from 'js-yaml';
import { AppConfig, type Weekday, WEEKDAYS } from '@mosbot/shared';
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
import { normalizeEditableConfig } from '@/lib/normalize-config';

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
    maxViewers: number | null;
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
    timezone: string;
    windows: Partial<Record<Weekday, { start: string; end: string }>>;
  };
  safety: {
    preSendJitterMs: { min: number; max: number };
    playProbability: number;
    scheduleJitterMinutes: number;
    maxPlaysPerDay: number;
  };
  accounts: AccountEntry[];
  server: {
    host: string;
    port: number;
    auth: { username: string; passwordHash: string };
  };
  database: { path: string };
}

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
      const rawParsed = loadYaml(raw);
      const normalized = normalizeEditableConfig(rawParsed);
      if (!normalized) return null;
      return normalized as unknown as EditableConfig;
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
            help="Upper bound on channels the bot tracks at any time. Higher = more chat presence, but also more rate-limit pressure on the account. Default 10."
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
          <LabeledOptionalNumber
            label="Max viewers (empty = no cap)"
            help="Skip streams above this viewer count. Useful to focus on smaller communities where !play competition is lower. Leave empty for no upper cap."
            value={config.discovery.maxViewers}
            min={1}
            onChange={(v) => update('discovery', { maxViewers: v })}
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
          <ChatLogToggle
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

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Anti-detection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <SafetyEditor
            value={config.safety}
            onChange={(v) => update('safety', v)}
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

interface LabeledOptionalNumberProps {
  label: string;
  value: number | null;
  min?: number;
  max?: number;
  help?: string;
  onChange: (v: number | null) => void;
}

const LabeledOptionalNumber = ({
  label,
  value,
  min,
  max,
  help,
  onChange,
}: LabeledOptionalNumberProps): JSX.Element => (
  <div className="flex flex-col gap-1">
    <label className="flex items-center gap-1.5 text-xs font-medium">
      {label}
      {help && <FieldHelp text={help} />}
    </label>
    <Input
      type="number"
      value={value ?? ''}
      min={min}
      max={max}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') {
          onChange(null);
          return;
        }
        const n = Number(raw);
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

interface ChatLogToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
}

const ChatLogToggle = ({ value, onChange }: ChatLogToggleProps): JSX.Element => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const handleChange = (v: boolean): void => {
    if (!v && value) {
      setConfirmOpen(true);
      return;
    }
    onChange(v);
  };
  return (
    <>
      <LabeledCheckbox
        label="Persist chat messages to SQLite"
        help="Store every observed chat message into the SQLite database for stats and retrospective analysis. Off = stats still count !play events but individual messages are not kept."
        value={value}
        onChange={handleChange}
      />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Disable chat persistence?"
        description={
          <span>
            Turning this off will <strong>permanently delete all stored chat
            messages</strong> from the SQLite database. Stats counters
            (lobbies, plays) are not affected. This cannot be undone.
          </span>
        }
        confirmLabel="Disable & delete"
        destructive
        onConfirm={() => onChange(false)}
      />
    </>
  );
};

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

interface SafetyEditorProps {
  value: EditableConfig['safety'];
  onChange: (v: EditableConfig['safety']) => void;
}

const SafetyEditor = ({ value, onChange }: SafetyEditorProps): JSX.Element => {
  const jitterInvalid = value.preSendJitterMs.min > value.preSendJitterMs.max;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Reduce bot fingerprintability. Lower probability and wider jitter make
        the activity pattern more human-like, at the cost of fewer plays per
        session. Changes apply live.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1.5 text-xs font-medium">
            Pre-send jitter min (ms)
            <FieldHelp text="Lower bound of the random delay between detecting a full lobby and sending !play. 0 disables the delay." />
          </label>
          <Input
            type="number"
            min={0}
            max={60_000}
            step={100}
            value={value.preSendJitterMs.min}
            onChange={(e) =>
              onChange({
                ...value,
                preSendJitterMs: {
                  ...value.preSendJitterMs,
                  min: Math.max(0, Number(e.target.value) || 0),
                },
              })
            }
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1.5 text-xs font-medium">
            Pre-send jitter max (ms)
            <FieldHelp text="Upper bound of the random delay. Must be ≥ min. Practical range: 1500–6000 ms." />
          </label>
          <Input
            type="number"
            min={0}
            max={60_000}
            step={100}
            value={value.preSendJitterMs.max}
            onChange={(e) =>
              onChange({
                ...value,
                preSendJitterMs: {
                  ...value.preSendJitterMs,
                  max: Math.max(0, Number(e.target.value) || 0),
                },
              })
            }
          />
          {jitterInvalid && (
            <p className="text-xs text-destructive">max must be ≥ min</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1.5 text-xs font-medium">
            Play probability ({Math.round(value.playProbability * 100)}%)
            <FieldHelp text="Fraction of detected lobbies the bot actually joins. 1.0 = always; 0.8 = skip ~20% on purpose. Lower values look more human, fewer plays." />
          </label>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={value.playProbability}
            onChange={(e) =>
              onChange({
                ...value,
                playProbability: Math.min(
                  1,
                  Math.max(0, Number(e.target.value) || 0),
                ),
              })
            }
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1.5 text-xs font-medium">
            Schedule jitter (± minutes)
            <FieldHelp text="Random ±N min offset applied to each day's start and end, deterministic per day. 0 disables. Practical range: 0–15." />
          </label>
          <Input
            type="number"
            min={0}
            max={60}
            step={1}
            value={value.scheduleJitterMinutes}
            onChange={(e) =>
              onChange({
                ...value,
                scheduleJitterMinutes: Math.max(0, Math.floor(Number(e.target.value) || 0)),
              })
            }
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-1.5 text-xs font-medium">
          Max plays per day per account
          <FieldHelp text="Hard upper bound on !play sends per account per local day (in the schedule timezone). 0 disables the cap. Protects against runaway configs." />
        </label>
        <Input
          type="number"
          min={0}
          max={1000}
          step={1}
          value={value.maxPlaysPerDay}
          onChange={(e) =>
            onChange({
              ...value,
              maxPlaysPerDay: Math.max(0, Math.floor(Number(e.target.value) || 0)),
            })
          }
        />
      </div>
    </div>
  );
};

const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

const allWindowsEqual = (
  windows: Partial<Record<Weekday, { start: string; end: string }>>,
): boolean => {
  const values = Object.values(windows).filter(
    (v): v is { start: string; end: string } => v !== undefined,
  );
  if (values.length <= 1) return true;
  const first = values[0]!;
  return values.every((w) => w.start === first.start && w.end === first.end);
};

const firstWindow = (
  windows: Partial<Record<Weekday, { start: string; end: string }>>,
): { start: string; end: string } => {
  for (const d of WEEKDAYS) {
    const w = windows[d];
    if (w) return w;
  }
  return { start: '12:00', end: '16:00' };
};

const ScheduleEditor = ({ value, onChange }: ScheduleEditorProps): JSX.Element => {
  const tzInvalid = value.timezone.length === 0 || !isValidTimezone(value.timezone);
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);

  const selectedDays = useMemo(
    () => WEEKDAYS.filter((d) => value.windows[d] !== undefined),
    [value.windows],
  );

  // Auto-detect per-day mode: differing times in the existing windows.
  const [perDayMode, setPerDayMode] = useState<boolean>(() => !allWindowsEqual(value.windows));
  const simpleTime = firstWindow(value.windows);

  const handleEnabledChange = (v: boolean): void => {
    if (!v && value.enabled) {
      setDisableConfirmOpen(true);
      return;
    }
    onChange({ ...value, enabled: v });
  };

  const toggleDay = (day: Weekday): void => {
    const next = { ...value.windows };
    if (next[day]) {
      delete next[day];
    } else {
      // Use simpleTime (or last known time) as the new day's default.
      next[day] = { ...simpleTime };
    }
    onChange({ ...value, windows: next });
  };

  const setSimpleTime = (patch: Partial<{ start: string; end: string }>): void => {
    const merged = { ...simpleTime, ...patch };
    const next: Partial<Record<Weekday, { start: string; end: string }>> = {};
    for (const d of selectedDays) {
      next[d] = { ...merged };
    }
    onChange({ ...value, windows: next });
  };

  const setDayTime = (
    day: Weekday,
    patch: Partial<{ start: string; end: string }>,
  ): void => {
    const current = value.windows[day] ?? { ...simpleTime };
    onChange({
      ...value,
      windows: { ...value.windows, [day]: { ...current, ...patch } },
    });
  };

  const copyMonToAll = (): void => {
    const mon = value.windows.mon;
    if (!mon) return;
    const next: Partial<Record<Weekday, { start: string; end: string }>> = {};
    for (const d of selectedDays) {
      next[d] = { ...mon };
    }
    onChange({ ...value, windows: next });
  };

  const togglePerDayMode = (on: boolean): void => {
    setPerDayMode(on);
    if (!on) {
      // collapsing to simple mode: align all selected days to the first one
      const t = simpleTime;
      const next: Partial<Record<Weekday, { start: string; end: string }>> = {};
      for (const d of selectedDays) {
        next[d] = { ...t };
      }
      onChange({ ...value, windows: next });
    }
  };

  const noDaysSelected = selectedDays.length === 0;

  return (
    <div className="space-y-3">
      <LabeledCheckbox
        label="Schedule enabled"
        help="When on, the bot only runs inside the time window on selected weekdays. A manual Start/Stop overrides until the next schedule edge."
        value={value.enabled}
        onChange={handleEnabledChange}
      />
      <ConfirmDialog
        open={disableConfirmOpen}
        onOpenChange={setDisableConfirmOpen}
        title="Disable the schedule?"
        description={
          <span>
            Disabling the schedule means the bot runs 24/7 (until you stop it
            manually). Running accounts around the clock dramatically increases the
            risk of in-game bans. You are solely responsible for the accounts you
            connect — use at your own risk.
          </span>
        }
        confirmLabel="Disable anyway"
        destructive
        onConfirm={() => onChange({ ...value, enabled: false })}
      />

      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-1.5 text-xs font-medium">
          Days
          <FieldHelp text="Click a day to toggle it. The bot only runs on selected days, inside the time window. An overnight window (start > end) extends into the next morning." />
        </label>
        <div className="flex flex-wrap gap-1">
          {WEEKDAYS.map((d) => {
            const selected = value.windows[d] !== undefined;
            return (
              <Button
                key={d}
                type="button"
                size="sm"
                variant={selected ? 'default' : 'outline'}
                onClick={() => toggleDay(d)}
                disabled={!value.enabled}
              >
                {WEEKDAY_LABEL[d]}
              </Button>
            );
          })}
        </div>
        {noDaysSelected && value.enabled && (
          <p className="text-xs text-destructive">Select at least one day.</p>
        )}
      </div>

      <LabeledCheckbox
        label="Different times per day"
        help="Off = one time window applies to every selected day. On = each selected day has its own start/end."
        value={perDayMode}
        onChange={togglePerDayMode}
      />

      {!perDayMode ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1.5 text-xs font-medium">
              Start (24h)
            </label>
            <Input
              type="time"
              step={60}
              value={simpleTime.start}
              onChange={(e) => setSimpleTime({ start: e.target.value })}
              disabled={!value.enabled || noDaysSelected}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1.5 text-xs font-medium">
              End (24h)
            </label>
            <Input
              type="time"
              step={60}
              value={simpleTime.end}
              onChange={(e) => setSimpleTime({ end: e.target.value })}
              disabled={!value.enabled || noDaysSelected}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Per-day windows
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={copyMonToAll}
              disabled={!value.enabled || !value.windows.mon || selectedDays.length < 2}
              title="Copy Monday's time to all other selected days"
            >
              Copy Mon to all
            </Button>
          </div>
          {selectedDays.map((d) => {
            const w = value.windows[d]!;
            return (
              <div
                key={d}
                className="grid grid-cols-[3.5rem_1fr_auto_1fr] items-center gap-2"
              >
                <span className="text-xs font-medium">{WEEKDAY_LABEL[d]}</span>
                <Input
                  type="time"
                  step={60}
                  value={w.start}
                  onChange={(e) => setDayTime(d, { start: e.target.value })}
                  disabled={!value.enabled}
                />
                <span className="text-xs text-muted-foreground">–</span>
                <Input
                  type="time"
                  step={60}
                  value={w.end}
                  onChange={(e) => setDayTime(d, { end: e.target.value })}
                  disabled={!value.enabled}
                />
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-1.5 text-xs font-medium">
          Timezone
          <FieldHelp text="IANA timezone such as 'Europe/Berlin' or 'America/New_York'. Determines how the day boundaries and times are interpreted. DST is handled automatically." />
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

      <p className="text-xs text-muted-foreground">
        Schedule changes apply live without a container restart. Overnight windows
        (start &gt; end) automatically extend into the next morning.
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
