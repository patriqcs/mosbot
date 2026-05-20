import { cn } from '@/lib/utils';

type Variant = 'success' | 'warning' | 'destructive' | 'muted' | 'info';

interface StatusDotProps {
  variant?: Variant;
  pulse?: boolean;
  className?: string;
  'aria-label'?: string;
}

const VARIANT_BG: Record<Variant, string> = {
  success: 'bg-primary text-primary',
  warning: 'bg-warning text-warning',
  destructive: 'bg-destructive text-destructive',
  muted: 'bg-muted-foreground/40 text-muted-foreground',
  info: 'bg-info text-info',
};

export const StatusDot = ({
  variant = 'success',
  pulse = false,
  className,
  'aria-label': ariaLabel,
}: StatusDotProps): JSX.Element => (
  <span
    aria-label={ariaLabel}
    className={cn('relative inline-flex h-2 w-2 shrink-0 rounded-full', VARIANT_BG[variant], className)}
  >
    {pulse && <span className="status-pulse" aria-hidden />}
  </span>
);
