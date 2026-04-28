"use client";

interface StepIndicatorProps {
  current: string;
}

export function StepIndicator({ current }: StepIndicatorProps) {
  const steps = [
    { id: "paste", label: "1 · Paste" },
    { id: "parsed", label: "2 · Preview" },
    { id: "metadata", label: "3 · Lot info" },
    { id: "done", label: "Done" },
  ];
  return (
    <div className="flex items-center gap-2 text-sm">
      {steps.map((s, i) => {
        const active = current === s.id;
        const past = stepRank(current) > i;
        return (
          <div
            key={s.id}
            className={
              active
                ? "rounded-md bg-primary px-2.5 py-1 text-primary-foreground"
                : past
                  ? "rounded-md bg-muted px-2.5 py-1 text-foreground"
                  : "rounded-md px-2.5 py-1 text-muted-foreground"
            }
          >
            {s.label}
          </div>
        );
      })}
    </div>
  );
}

function stepRank(step: string): number {
  const order = ["paste", "parsed", "metadata", "submitting", "done", "error"];
  return order.indexOf(step);
}
