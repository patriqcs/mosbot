import { useEffect, useMemo, useState } from 'react';
import { dump as dumpYaml, load as loadYaml } from 'js-yaml';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

type Mode = 'form' | 'yaml';

interface EditableConfig {
  discovery: {
    intervalMinutes: number;
    maxStreams: number;
    minViewers: number;
    language: string | null;
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
  coexistence?: {
    pointsMiner?: {
      enabled: boolean;
      dockerContainerName: string;
      appdataPath: string;
    };
  };
  channels: {
    whitelist: string[];
    blacklist: string[];
  };
  logging: {
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
    rotateDays: number;
    chatLog: boolean;
  };
}

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const;

export const SettingsPage = (): JSX.Element => {
  const [mode, setMode] = useState<Mode>('form');
  const [raw, setRaw] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getConfig()
      .then(({ raw: r, path: p }) => {
        setRaw(r);
        setPath(p);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const parsed = useMemo<EditableConfig | null>(() => {
    if (!raw) return null;
    try {
      return loadYaml(raw) as EditableConfig;
    } catch {
      return null;
    }
  }, [raw]);

  const updateRawFromForm = (next: EditableConfig): void => {
    const full = loadYaml(raw) as Record<string, unknown>;
    const merged = { ...full, ...next } as Record<string, unknown>;
    setRaw(dumpYaml(merged, { lineWidth: 100, noRefs: true }));
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.saveConfig(raw);
      setNotice(
        res.restartRequired
          ? 'Saved. Restart the container to apply changes.'
          : 'Saved.',
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
        <div className="flex gap-2">
          <Button
            variant={mode === 'form' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('form')}
          >
            Form
          </Button>
          <Button
            variant={mode === 'yaml' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('yaml')}
          >
            YAML
          </Button>
        </div>
      </div>

      {path && (
        <p className="text-xs text-muted-foreground">
          Editing <code>{path}</code>. Secrets (<code>{'${TWITCH_CLIENT_ID}'}</code>,{' '}
          <code>{'${DASHBOARD_PASSWORD_HASH}'}</code>) are env-var references — do not edit.
        </p>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-primary/30 bg-primary/10 p-3 text-sm">
          {notice}
        </div>
      )}

      {mode === 'form' && parsed && (
        <FormView config={parsed} onChange={updateRawFromForm} />
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
            <CardTitle>YAML</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              spellCheck={false}
              className="h-[60vh] w-full rounded-md border bg-background p-3 font-mono text-xs"
            />
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving || !raw}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
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
            value={config.discovery.intervalMinutes}
            min={1}
            max={60}
            onChange={(v) => update('discovery', { intervalMinutes: v })}
          />
          <LabeledNumber
            label="Max streams"
            value={config.discovery.maxStreams}
            min={1}
            max={100}
            onChange={(v) => update('discovery', { maxStreams: v })}
          />
          <LabeledNumber
            label="Min viewers"
            value={config.discovery.minViewers}
            min={0}
            onChange={(v) => update('discovery', { minViewers: v })}
          />
          <LabeledText
            label="Language (ISO code, empty = any)"
            value={config.discovery.language ?? ''}
            onChange={(v) => update('discovery', { language: v.trim() === '' ? null : v })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lobby</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <LabeledNumber
            label="Window (seconds)"
            value={config.lobby.windowSeconds}
            min={5}
            max={600}
            onChange={(v) => update('lobby', { windowSeconds: v })}
          />
          <LabeledNumber
            label="Min players"
            value={config.lobby.minPlayers}
            min={1}
            max={100}
            onChange={(v) => update('lobby', { minPlayers: v })}
          />
          <LabeledNumber
            label="Cooldown (seconds)"
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
            value={config.ratelimit.userChatBudgetPer30s}
            min={1}
            max={100}
            onChange={(v) => update('ratelimit', { userChatBudgetPer30s: v })}
          />
          <LabeledCheckbox
            label="Verified bot (45 msg/30s)"
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
            <label className="text-xs font-medium">Level</label>
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
            value={config.logging.rotateDays}
            min={1}
            max={365}
            onChange={(v) => update('logging', { rotateDays: v })}
          />
          <LabeledCheckbox
            label="Persist chat messages to SQLite"
            value={config.logging.chatLog}
            onChange={(v) => update('logging', { chatLog: v })}
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
            values={config.channels.whitelist}
            onChange={(v) => update('channels', { whitelist: v })}
          />
          <TagList
            label="Blacklist (never joined)"
            values={config.channels.blacklist}
            onChange={(v) => update('channels', { blacklist: v })}
          />
        </CardContent>
      </Card>

      {config.coexistence?.pointsMiner && (
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Coexistence (Points Miner)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <LabeledCheckbox
              label="Enabled"
              value={config.coexistence.pointsMiner.enabled}
              onChange={(v) =>
                onChange({
                  ...config,
                  coexistence: {
                    ...config.coexistence,
                    pointsMiner: { ...config.coexistence!.pointsMiner!, enabled: v },
                  },
                })
              }
            />
            <LabeledText
              label="Docker container name"
              value={config.coexistence.pointsMiner.dockerContainerName}
              onChange={(v) =>
                onChange({
                  ...config,
                  coexistence: {
                    ...config.coexistence,
                    pointsMiner: {
                      ...config.coexistence!.pointsMiner!,
                      dockerContainerName: v,
                    },
                  },
                })
              }
            />
            <LabeledText
              label="Appdata path"
              value={config.coexistence.pointsMiner.appdataPath}
              onChange={(v) =>
                onChange({
                  ...config,
                  coexistence: {
                    ...config.coexistence,
                    pointsMiner: { ...config.coexistence!.pointsMiner!, appdataPath: v },
                  },
                })
              }
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
};

interface LabeledNumberProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}

const LabeledNumber = ({ label, value, min, max, onChange }: LabeledNumberProps): JSX.Element => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium">{label}</label>
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
  onChange: (v: string) => void;
}

const LabeledText = ({ label, value, onChange }: LabeledTextProps): JSX.Element => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-medium">{label}</label>
    <Input value={value} onChange={(e) => onChange(e.target.value)} />
  </div>
);

interface LabeledCheckboxProps {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

const LabeledCheckbox = ({ label, value, onChange }: LabeledCheckboxProps): JSX.Element => (
  <label className="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={value}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4"
    />
    {label}
  </label>
);

interface TagListProps {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
}

const TagList = ({ label, values, onChange }: TagListProps): JSX.Element => {
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
      <label className="text-xs font-medium">{label}</label>
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
