import { cn } from '@/lib/utils';

export const Skeleton = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): JSX.Element => (
  <div
    aria-busy="true"
    className={cn(
      'animate-pulse rounded-md bg-muted/60',
      className,
    )}
    {...props}
  />
);
