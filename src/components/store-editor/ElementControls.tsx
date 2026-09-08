// The body of the click-to-edit popover. Given the clicked element KIND it
// renders the controls relevant to that element:
//   heading -> full heading typography (theme-level, all headings)
//   text    -> the body/content colour (theme role `text`)
//   tag     -> the tag/pill colour (theme role `tag`, text auto-contrasts)
//   header  -> the hero band background (theme role `headerBg`)
//   logo    -> the hero block's per-element logo size + a grayscale tint
// heading/text/tag/header are THEME edits (apply everywhere) and flow through
// onThemeChange; logo is a BLOCK-level edit and flows through onUpdateProps.
// Everything here is untrusted UI: the server re-sanitises theme + props on save.
import type { StoreTheme } from '../../lib/store-theme';
import type { StoreBlock } from '../../lib/store-blocks';
import {
  sanitizeHeroElements,
  clampInt,
  HERO_DEFAULT_ELEMENTS,
  HERO_LOGO_SCALE_MIN,
  HERO_LOGO_SCALE_MAX,
  HERO_LOGO_SCALE_DEFAULT,
  HERO_LOGO_TINT_MIN,
  HERO_LOGO_TINT_MAX,
  HERO_LOGO_TINT_DEFAULT,
  HERO_LOGO_COLOR_DEFAULT,
  HERO_LOGO_COLOR_AMOUNT_MIN,
  HERO_LOGO_COLOR_AMOUNT_MAX,
  HERO_LOGO_COLOR_AMOUNT_DEFAULT,
} from '../../lib/store-blocks';
import { isValidHex } from '../../lib/store-theme';
import { STORE_COLOR_ROLE_LABEL, STORE_EDITOR_LABELS as L } from '../../lib/labels';
import HeadingControls from './HeadingControls';
import ColorRow from './ColorRow';

export type ElementEditKind = 'heading' | 'text' | 'tag' | 'header' | 'logo';

export default function ElementControls({
  kind,
  theme,
  onThemeChange,
  block,
  onUpdateProps,
}: {
  kind: ElementEditKind;
  theme: StoreTheme;
  onThemeChange: (theme: StoreTheme) => void;
  /** The hero block, resolved by the canvas; only needed for the logo kind. */
  block?: StoreBlock;
  onUpdateProps: (id: string, patch: Record<string, unknown>) => void;
}) {
  if (kind === 'heading') {
    return <HeadingControls theme={theme} onChange={onThemeChange} />;
  }

  // The three single-colour theme roles share one row; only the bound role differs.
  if (kind === 'text' || kind === 'tag' || kind === 'header') {
    const role = kind === 'header' ? 'headerBg' : kind === 'tag' ? 'tag' : 'text';
    return (
      <ColorRow
        value={theme.colors[role]}
        label={STORE_COLOR_ROLE_LABEL[role]}
        onChange={(v) => onThemeChange({ ...theme, colors: { ...theme.colors, [role]: v } })}
        role={role}
      />
    );
  }

  // logo — block-level size + tint.
  if (!block) return null;
  return <LogoControls block={block} onUpdateProps={onUpdateProps} />;
}

function LogoControls({
  block,
  onUpdateProps,
}: {
  block: StoreBlock;
  onUpdateProps: (id: string, patch: Record<string, unknown>) => void;
}) {
  const p = block.props as Record<string, unknown>;
  const stored = sanitizeHeroElements(p.elements) ?? {};
  const logo = stored.logo ?? HERO_DEFAULT_ELEMENTS.logo;
  const scale = clampInt(logo.scale, HERO_LOGO_SCALE_MIN, HERO_LOGO_SCALE_MAX, HERO_LOGO_SCALE_DEFAULT);
  const tint = clampInt(p.logoTint, HERO_LOGO_TINT_MIN, HERO_LOGO_TINT_MAX, HERO_LOGO_TINT_DEFAULT);
  // Untrusted UI values; the server re-validates the hex and re-clamps the
  // amount on save. Show the stored colour when it's a valid hex, else default.
  const logoColor = isValidHex(p.logoColor) ? String(p.logoColor).toUpperCase() : HERO_LOGO_COLOR_DEFAULT;
  const colorAmount = clampInt(p.logoColorAmount, HERO_LOGO_COLOR_AMOUNT_MIN, HERO_LOGO_COLOR_AMOUNT_MAX, HERO_LOGO_COLOR_AMOUNT_DEFAULT);

  // Size lives in the hero's free-layout map; merge so untouched elements keep
  // their positions. Value is clamped to the bounded percent range.
  const setScale = (value: number) =>
    onUpdateProps(block.id, {
      elements: {
        ...stored,
        logo: { ...logo, scale: clampInt(value, HERO_LOGO_SCALE_MIN, HERO_LOGO_SCALE_MAX, scale) },
      },
    });
  // Tint is its own bounded hero prop; the server re-clamps on save.
  const setTint = (value: number) =>
    onUpdateProps(block.id, {
      logoTint: clampInt(value, HERO_LOGO_TINT_MIN, HERO_LOGO_TINT_MAX, HERO_LOGO_TINT_DEFAULT),
    });
  // Colour + strength are their own bounded hero props; the server re-validates
  // the hex and re-clamps the amount on save.
  const setColor = (value: string) => onUpdateProps(block.id, { logoColor: value });
  const setColorAmount = (value: number) =>
    onUpdateProps(block.id, {
      logoColorAmount: clampInt(value, HERO_LOGO_COLOR_AMOUNT_MIN, HERO_LOGO_COLOR_AMOUNT_MAX, HERO_LOGO_COLOR_AMOUNT_DEFAULT),
    });

  return (
    <div className="space-y-3" data-logo-controls>
      <label className="block">
        <span className="flex items-center justify-between text-xs font-medium text-charcoal/60 mb-1">
          <span>{L.logoSize}</span>
          <span className="font-mono text-charcoal/45">{scale}%</span>
        </span>
        <input
          type="range"
          min={HERO_LOGO_SCALE_MIN}
          max={HERO_LOGO_SCALE_MAX}
          value={scale}
          onChange={(e) => setScale(Number(e.target.value))}
          className="w-full accent-[var(--color-primary)]"
          data-logo-size
        />
      </label>

      <label className="block">
        <span className="flex items-center justify-between text-xs font-medium text-charcoal/60 mb-1">
          <span>{L.logoTint}</span>
          <span className="font-mono text-charcoal/45">{tint}%</span>
        </span>
        <input
          type="range"
          min={HERO_LOGO_TINT_MIN}
          max={HERO_LOGO_TINT_MAX}
          value={tint}
          onChange={(e) => setTint(Number(e.target.value))}
          className="w-full accent-[var(--color-primary)]"
          data-logo-tint
        />
      </label>

      <ColorRow value={logoColor} label={L.logoColor} onChange={setColor} role="logoColor" />

      <label className="block">
        <span className="flex items-center justify-between text-xs font-medium text-charcoal/60 mb-1">
          <span>{L.logoColorAmount}</span>
          <span className="font-mono text-charcoal/45">{colorAmount}%</span>
        </span>
        <input
          type="range"
          min={HERO_LOGO_COLOR_AMOUNT_MIN}
          max={HERO_LOGO_COLOR_AMOUNT_MAX}
          value={colorAmount}
          onChange={(e) => setColorAmount(Number(e.target.value))}
          className="w-full accent-[var(--color-primary)]"
          data-logo-color-amount
        />
      </label>
    </div>
  );
}
