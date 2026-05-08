import { cn } from "@/lib/utils";

type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<BadgeTone, string> = {
  neutral:
    "border-[var(--border-subtle)] bg-[var(--bg-surface-hover)] text-[var(--text-secondary)]",
  accent:
    "border-[var(--accent-medium)] bg-[var(--accent-soft)] text-[var(--accent)]",
  success:
    "border-[color-mix(in_srgb,var(--success)_26%,transparent)] bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[var(--success)]",
  warning:
    "border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] text-[var(--warning)]",
  danger:
    "border-[color-mix(in_srgb,var(--danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-[var(--danger)]",
  info:
    "border-[color-mix(in_srgb,var(--info)_28%,transparent)] bg-[color-mix(in_srgb,var(--info)_12%,transparent)] text-[var(--info)]",
};

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex min-h-5 items-center rounded-[var(--radius-control)] border px-2 py-0.5 text-[11px] font-medium leading-none",
        toneClasses[tone],
        className
      )}
      {...props}
    />
  );
}
