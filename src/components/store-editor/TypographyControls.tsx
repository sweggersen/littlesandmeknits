// Reusable per-element typography controls: an optional colour row + weight +
// size/scale + italic + underline, editing any `StoreHeadingStyle`-shaped
// object (headings OR body text). Theme-level (per element TYPE), so every
// change reskins ALL elements of that type across the storefront. Emits the
// updated style via onChange; the server re-sanitises on save, so this client
// is never trusted. The `hook` prop drives the `data-<hook>-*` test hooks so
// the heading case keeps its existing `data-heading-*` selectors.
import {
  HEADING_WEIGHTS,
  HEADING_SCALES,
  type StoreHeadingStyle,
  type StoreColorRole,
  type HeadingWeight,
  type HeadingScale,
} from '../../lib/store-theme';
import {
  STORE_COLOR_ROLE_LABEL,
  STORE_HEADING_WEIGHT_LABEL,
  STORE_HEADING_SCALE_LABEL,
  STORE_EDITOR_LABELS as L,
} from '../../lib/labels';
import ColorRow from './ColorRow';

export default function TypographyControls({
  value,
  onChange,
  showColor = false,
  colorRole,
  colorValue,
  onColorChange,
  hook = 'heading',
}: {
  /** The typography block to edit (theme.heading or theme.body). */
  value: StoreHeadingStyle;
  onChange: (next: StoreHeadingStyle) => void;
  /** Render the colour row for `colorRole` (else it's edited in the Farger list). */
  showColor?: boolean;
  colorRole?: StoreColorRole;
  colorValue?: string;
  onColorChange?: (value: string) => void;
  /** Prefix for the `data-<hook>-*` test hooks. */
  hook?: string;
}) {
  const set = (patch: Partial<StoreHeadingStyle>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-2.5" {...{ [`data-${hook}-controls`]: '' }}>
      {showColor && colorRole && onColorChange && (
        <ColorRow
          value={colorValue ?? ''}
          label={STORE_COLOR_ROLE_LABEL[colorRole]}
          onChange={onColorChange}
          role={colorRole}
        />
      )}

      <label className="block">
        <span className="block text-xs font-medium text-charcoal/60 mb-1">{L.headingWeight}</span>
        <select
          value={value.weight}
          onChange={(e) => set({ weight: e.target.value as HeadingWeight })}
          className="w-full bg-surface rounded-lg border border-sage-500/20 px-2.5 py-1.5 text-sm"
          {...{ [`data-${hook}-weight`]: '' }}
        >
          {HEADING_WEIGHTS.map((w) => (
            <option key={w} value={w}>{STORE_HEADING_WEIGHT_LABEL[w]}</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-charcoal/60 mb-1">{L.headingScale}</span>
        <select
          value={value.scale}
          onChange={(e) => set({ scale: e.target.value as HeadingScale })}
          className="w-full bg-surface rounded-lg border border-sage-500/20 px-2.5 py-1.5 text-sm"
          {...{ [`data-${hook}-scale`]: '' }}
        >
          {HEADING_SCALES.map((s) => (
            <option key={s} value={s}>{STORE_HEADING_SCALE_LABEL[s]}</option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-xs text-charcoal/70 cursor-pointer">
          <input
            type="checkbox"
            checked={value.italic}
            onChange={(e) => set({ italic: e.target.checked })}
            className="rounded border-sage-500/30"
            {...{ [`data-${hook}-italic`]: '' }}
          />
          <span className="italic">{L.headingItalic}</span>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-charcoal/70 cursor-pointer">
          <input
            type="checkbox"
            checked={value.underline}
            onChange={(e) => set({ underline: e.target.checked })}
            className="rounded border-sage-500/30"
            {...{ [`data-${hook}-underline`]: '' }}
          />
          <span className="underline">{L.headingUnderline}</span>
        </label>
      </div>
    </div>
  );
}
