import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface MetricTileProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  hint?: string;
  accent?: 'primary' | 'info' | 'warning' | 'destructive' | 'muted';
  className?: string;
}

const ACCENT_RING: Record<NonNullable<MetricTileProps['accent']>, string> = {
  primary: 'text-primary bg-primary/10 ring-1 ring-primary/20',
  info: 'text-info bg-info/10 ring-1 ring-info/20',
  warning: 'text-warning bg-warning/10 ring-1 ring-warning/20',
  destructive: 'text-destructive bg-destructive/10 ring-1 ring-destructive/20',
  muted: 'text-muted-foreground bg-muted ring-1 ring-border',
};

export const MetricTile = ({
  label,
  value,
  icon: Icon,
  hint,
  accent = 'muted',
  className,
}: MetricTileProps): JSX.Element => (
  <div
    className={cn(
      'group relative overflow-hidden rounded-lg border bg-card p-5 transition-colors hover:border-border/80',
      'shadow-card',
      className,
    )}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {Icon && (
        <span
          className={cn('flex h-8 w-8 items-center justify-center rounded-md', ACCENT_RING[accent])}
        >
          <Icon className="h-4 w-4" />
        </span>
      )}
    </div>
    <div className="mt-3 flex items-baseline gap-1.5">
      <span className="text-2xl font-bold tabular-nums tracking-tight md:text-3xl">{value}</span>
    </div>
    {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
  </div>
);
