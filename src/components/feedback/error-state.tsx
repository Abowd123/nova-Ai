import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title: string;
  description?: string;
  retryLabel?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ title, description, retryLabel, onRetry, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-3xl border border-destructive/40 bg-destructive/5 p-6 text-center",
        className,
      )}
    >
      <TriangleAlert className="size-8 text-destructive" aria-hidden="true" />
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {onRetry && retryLabel ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
