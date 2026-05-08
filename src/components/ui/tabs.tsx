import { cn } from "@/lib/utils";

export type TabItem<T extends string> = {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
};

type TabsProps<T extends string> = {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  tabClassName?: string;
  "aria-label"?: string;
};

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
  tabClassName,
  "aria-label": ariaLabel,
}: TabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--control-bg)] p-0.5",
        className
      )}
    >
      {items.map((item) => {
        const selected = item.value === value;

        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              "rounded-[calc(var(--radius-control)-2px)] px-3 py-1.5 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--control-border-focus)]",
              selected
                ? "bg-[var(--selected-bg)] text-[var(--selected-text)]"
                : "text-[var(--text-tertiary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-secondary)]",
              "disabled:pointer-events-none disabled:opacity-45",
              tabClassName
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
