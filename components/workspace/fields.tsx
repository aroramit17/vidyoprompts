"use client";

/** A list edited as one item per line. */
export function LinesField({ label, hint, value, onChange, rows = 3 }: { label: string; hint?: string; value: string[]; onChange: (v: string[]) => void; rows?: number }) {
  return (
    <label className="field">
      <span>
        {label} {hint && <span className="hint">— {hint}</span>}
      </span>
      <textarea
        rows={rows}
        value={value.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n"))}
        onBlur={(e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
      />
    </label>
  );
}

export function TextField({ label, hint, value, onChange, multiline, rows = 2, placeholder }: { label: string; hint?: string; value: string; onChange: (v: string) => void; multiline?: boolean; rows?: number; placeholder?: string }) {
  return (
    <label className="field">
      <span>
        {label} {hint && <span className="hint">— {hint}</span>}
      </span>
      {multiline ? (
        <textarea rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}
