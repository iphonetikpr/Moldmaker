import { useEffect, useState } from "react";
import { clampNumber, parseNumberDraft, stepNumber } from "./numberField";

type Props = {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  title?: string;
  "aria-label"?: string;
};

export function NumberField({ id, value, onChange, min, max, step = 1, title, "aria-label": ariaLabel }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    setDraft(null);
  }, [value]);

  const shown = draft ?? String(value);

  function commit(raw: string) {
    const n = parseNumberDraft(raw);
    setDraft(null);
    if (n == null) return;
    onChange(clampNumber(n, min, max));
  }

  return (
    <input
      id={id}
      className="num"
      inputMode="decimal"
      title={title}
      aria-label={ariaLabel}
      value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit((e.target as HTMLInputElement).value);
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const dir = e.key === "ArrowUp" ? 1 : -1;
          onChange(stepNumber(value, dir, step, min, max));
        } else if (e.key === "Escape") {
          setDraft(null);
        }
      }}
    />
  );
}
