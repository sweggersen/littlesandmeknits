// Thin wrapper around the generalized TypographyControls, bound to the theme's
// HEADING typography + heading colour role. Kept as its own component so the
// existing call sites (ThemePanel section, click-to-edit popover) and their
// `data-heading-*` test hooks stay stable. Emits whole-theme updates via
// onChange; the server re-sanitises on save, so this client is never trusted.
import type { StoreTheme } from '../../lib/store-theme';
import TypographyControls from './TypographyControls';

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
  return (
    <TypographyControls
      value={theme.heading}
      onChange={(heading) => onChange({ ...theme, heading })}
      showColor={showColor}
      colorRole="heading"
      colorValue={theme.colors.heading}
      onColorChange={(value) => onChange({ ...theme, colors: { ...theme.colors, heading: value } })}
      hook="heading"
    />
  );
}
