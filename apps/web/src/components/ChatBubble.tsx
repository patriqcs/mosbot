import { Fragment, useMemo, useState } from 'react';
import type { ChatEvent } from '@mosbot/shared';
import { channelColors, channelInitial, fallbackUserColor } from '@/lib/channel-color';
import {
  applyEmoteLookup,
  bttvEmoteUrl,
  sevenTvEmoteUrl,
  tokenizeChatText,
  twitchEmoteUrl,
  type ChatToken,
  type EmoteProvider,
  type NameLookupEntry,
} from '@/lib/emotes';
import { formatTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface ChatBubbleProps {
  event: ChatEvent;
  profileImageUrl?: string | undefined;
  bttvLookup?: Record<string, NameLookupEntry> | undefined;
  sevenTvLookup?: Record<string, NameLookupEntry> | undefined;
}

export const ChatBubble = ({
  event,
  profileImageUrl,
  bttvLookup,
  sevenTvLookup,
}: ChatBubbleProps): JSX.Element => {
  const colors = channelColors(event.channel);
  const userColor = event.color ?? fallbackUserColor(event.user);
  const tokens = useMemo(() => {
    let t = tokenizeChatText(event.text, event.emoteOffsets);
    if (bttvLookup) t = applyEmoteLookup(t, bttvLookup, 'bttv');
    if (sevenTvLookup) t = applyEmoteLookup(t, sevenTvLookup, '7tv');
    return t;
  }, [event.text, event.emoteOffsets, bttvLookup, sevenTvLookup]);
  return (
    <div
      className={cn(
        'group flex items-start gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors',
        'hover:bg-muted/20',
      )}
      style={{ borderColor: colors.border, backgroundColor: colors.bg }}
    >
      <Avatar src={profileImageUrl} channel={event.channel} colors={colors} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span
            className="rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: colors.text, backgroundColor: `hsl(${colors.hue} 70% 15% / 0.7)` }}
          >
            #{event.channel}
          </span>
          {event.badges.map((b) => (
            <BadgeChip key={`${b.set}/${b.version}`} set={b.set} />
          ))}
          {event.isFirstMessage && (
            <span className="rounded bg-warning/20 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-warning">
              new
            </span>
          )}
          <span
            className="font-semibold tabular-nums"
            style={{ color: userColor }}
            title={event.user}
          >
            {event.displayName || event.user}
          </span>
          <span className="ml-auto text-[10px] font-mono text-muted-foreground/70 tabular-nums">
            {formatTime(event.at)}
          </span>
        </div>
        <div
          className={cn(
            'mt-0.5 break-words text-foreground/90',
            event.isAction && 'italic',
          )}
          style={event.isAction ? { color: userColor } : undefined}
        >
          {renderTokens(tokens)}
        </div>
      </div>
    </div>
  );
};

const Avatar = ({
  src,
  channel,
  colors,
}: {
  src: string | undefined;
  channel: string;
  colors: ReturnType<typeof channelColors>;
}): JSX.Element => {
  const [errored, setErrored] = useState(false);
  if (src && !errored) {
    return (
      <img
        src={src}
        alt={`#${channel}`}
        loading="lazy"
        decoding="async"
        onError={() => setErrored(true)}
        className="h-7 w-7 shrink-0 rounded-full border object-cover"
        style={{ borderColor: colors.border }}
      />
    );
  }
  return (
    <div
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full border font-mono text-xs font-bold uppercase"
      style={{
        borderColor: colors.border,
        backgroundColor: `hsl(${colors.hue} 70% 25%)`,
        color: colors.text,
      }}
      aria-label={`#${channel}`}
    >
      {channelInitial(channel)}
    </div>
  );
};

const KNOWN_BADGES: Record<string, { label: string; className: string }> = {
  broadcaster: { label: 'BC', className: 'bg-rose-600 text-white' },
  moderator: { label: 'MOD', className: 'bg-emerald-600 text-white' },
  vip: { label: 'VIP', className: 'bg-fuchsia-600 text-white' },
  subscriber: { label: 'SUB', className: 'bg-violet-600 text-white' },
  founder: { label: 'FND', className: 'bg-amber-600 text-white' },
  staff: { label: 'STAFF', className: 'bg-slate-700 text-white' },
  admin: { label: 'ADM', className: 'bg-red-700 text-white' },
  artist: { label: 'ART', className: 'bg-pink-600 text-white' },
};

const BadgeChip = ({ set }: { set: string }): JSX.Element | null => {
  const def = KNOWN_BADGES[set];
  if (!def) return null;
  return (
    <span
      className={cn(
        'rounded px-1 py-0.5 font-mono text-[9px] font-bold tracking-wide',
        def.className,
      )}
      title={set}
    >
      {def.label}
    </span>
  );
};

const MENTION_RE = /(@[\w]+)/g;

const emoteUrl = (tok: { provider: EmoteProvider; id: string }): string => {
  switch (tok.provider) {
    case 'twitch':
      return twitchEmoteUrl(tok.id);
    case 'bttv':
      return bttvEmoteUrl(tok.id);
    case '7tv':
      return sevenTvEmoteUrl(tok.id);
  }
};

const renderTokens = (tokens: ChatToken[]): JSX.Element[] =>
  tokens.map((tok, i) => {
    if (tok.type === 'emote') {
      return (
        <img
          key={i}
          src={emoteUrl(tok)}
          alt={tok.name}
          title={`${tok.name} · ${tok.provider}`}
          loading="lazy"
          decoding="async"
          className="inline-block h-7 w-auto align-middle"
        />
      );
    }
    return <Fragment key={i}>{renderTextChunk(tok.text)}</Fragment>;
  });

const renderTextChunk = (text: string): JSX.Element[] => {
  const parts = text.split(MENTION_RE);
  return parts.map((part, i) => {
    if (MENTION_RE.test(part)) {
      MENTION_RE.lastIndex = 0;
      return (
        <span
          key={i}
          className="rounded bg-primary/15 px-1 font-semibold text-primary"
        >
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
};
