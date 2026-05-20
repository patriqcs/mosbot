const hashString = (input: string): number => {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export interface ChannelColors {
  bg: string;
  border: string;
  text: string;
  hue: number;
}

/** Deterministic HSL palette per channel — stable across reloads, no API calls. */
export const channelColors = (channel: string): ChannelColors => {
  const hue = hashString(channel.toLowerCase()) % 360;
  return {
    bg: `hsl(${hue} 70% 22% / 0.4)`,
    border: `hsl(${hue} 70% 45% / 0.6)`,
    text: `hsl(${hue} 80% 78%)`,
    hue,
  };
};

export const channelInitial = (name: string): string => {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : '?';
};

/**
 * Fallback color for a chatter when Twitch doesn't return one.
 * Twitch's own client does the same — deterministic per username, keeps the
 * user visually identifiable.
 */
export const fallbackUserColor = (user: string): string => {
  const hue = hashString(user.toLowerCase()) % 360;
  return `hsl(${hue} 70% 70%)`;
};
