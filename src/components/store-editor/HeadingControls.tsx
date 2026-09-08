// Shared heading-typography controls: heading colour + weight + italic +
// underline + size/scale. Theme-level (per element TYPE), so every change
// reskins ALL headings across the storefront. Rendered both in the ThemePanel
// "Overskrifter" section and in the click-to-edit popover on the canvas, so the
// two stay in perfect sync. Emits whole-theme updates via onChange; the server
// re-sanitises on save, so this client is never trusted.
import {
  HEADING_WEIGHTS,
  HEADING_SCALES,
  type StoreTheme,
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

export default function HeadingControls({
  theme,
  onChange,
  showColor = true,
}: {
  theme: StoreTheme;
  onChange: (theme: StoreTheme) => void;
  // The colour also lives in the "Farger" list, so the ThemePanel section hides
  // it here to avoid a duplicate; the click-to-edit popover keeps it (that's
  // where editing a heading's colour in place is the point).
  showColor?: boolean;
}) {
  const setColor = (value: string) =>
    onChange({ ...theme, colors: { ...theme.colors, heading: value } });
  const setHeading = (patch: Partial<StoreTheme['heading']>) =>
    onChange({ ...theme, heading: { ...theme.heading, ...patch } });

  return (
    <div className="space-y-2.5" data-heading-controls>
      {/* Heading colour — same row pattern as the colour list. */}
      {showColor && (
        <ColorRow
          value={theme.colors.heading}
          label={STORE_COLOR_ROLE_LABEL.heading}
          onChange={setColor}
          role="heading"
        />
      )}

      <label className="block">
        <span className="block text-xs font-medium text-charcoal/60 mb-1">{L.headingWeight}</span>
        <select
          value={theme.heading.weight}
          onChange={(e) => setHeading({ weight: e.target.value as HeadingWeight })}
          className="w-full bg-surface rounded-lg border border-sage-500/20 px-2.5 py-1.5 text-sm"
          data-heading-weight
        >
          {HEADING_WEIGHTS.map((w) => (
            <option key={w} value={w}>{STORE_HEADING_WEIGHT_LABEL[w]}</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-charcoal/60 mb-1">{L.headingScale}</span>
        <select
          value={theme.heading.scale}
          onChange={(e) => setHeading({ scale: e.target.value as HeadingScale })}
          className="w-full bg-surface rounded-lg border border-sage-500/20 px-2.5 py-1.5 text-sm"
          data-heading-scale
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
            checked={theme.heading.italic}
            onChange={(e) => setHeading({ italic: e.target.checked })}
            className="rounded border-sage-500/30"
            data-heading-italic
          />
          <span className="italic">{L.headingItalic}</span>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-charcoal/70 cursor-pointer">
          <input
            type="checkbox"
            checked={theme.heading.underline}
            onChange={(e) => setHeading({ underline: e.target.checked })}
            className="rounded border-sage-500/30"
            data-heading-underline
          />
          <span className="underline">{L.headingUnderline}</span>
        </label>
      </div>
    </div>
  );
}
