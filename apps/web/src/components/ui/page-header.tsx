import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader = ({
  title,
  description,
  actions,
  className,
}: PageHeaderProps): JSX.Element => (
  <header
    className={cn(
      'flex flex-col gap-3 border-b border-border/60 pb-5 md:flex-row md:items-center md:justify-between md:gap-6',
      className,
    )}
  >
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
      {description && (
        <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
      )}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>
);
