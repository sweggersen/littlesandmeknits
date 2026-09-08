// A single colour-role editing row: a native colour swatch + a label + a hex
// text field, kept in sync. Shared by the ThemePanel colour list, the heading
// controls, and the click-to-edit ElementControls popover so the swatch/label/
// hex markup lives in exactly one place. Colours are the trust boundary: this
// client is never trusted, the server re-sanitises every hex on save.
import { isValidHex } from '../../lib/store-theme';

export default function ColorRow({
  value,
  label,
  onChange,
  role,
}: {
  /** Current hex value (may be mid-typing / invalid; server re-sanitises). */
  value: string;
  /** Norwegian-facing role label. */
  label: string;
  /** Emits the new value; already upper-cased when it is a valid hex. */
  onChange: (value: string) => void;
  /** Optional role key, surfaced as data-color / data-color-hex hooks (tests). */
  role?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="w-7 h-7 rounded border border-sage-500/20 bg-surface shrink-0 cursor-pointer"
        aria-label={label}
        data-color={role}
      />
      <span className="text-xs text-charcoal/70 flex-1 truncate">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          onChange(isValidHex(v) ? v.toUpperCase() : v); // keep typing; sanitised server-side
        }}
        className="w-20 bg-surface rounded border border-sage-500/20 px-1.5 py-1 text-[11px] font-mono"
        spellCheck={false}
        data-color-hex={role}
      />
    </div>
  );
}
