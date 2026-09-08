// Left-rail theme controls: display/body font pickers, a colour picker per
// theme role, a "Tekststiler" list that drills into per-element typography
// controls (L1 list -> L2 detail), the preset picker, and reset. Emits
// whole-theme updates upward; the server re-sanitises on save.
import { useState } from 'react';
import { STORE_FONTS, STORE_COLOR_ROLES, type StoreTheme, type StoreColorRole } from '../../lib/store-theme';
import { STORE_PRESETS, STORE_PRESET_IDS } from '../../lib/store-presets';
import { STORE_COLOR_ROLE_LABEL, STORE_EDITOR_LABELS as L } from '../../lib/labels';
import TypographyControls from './TypographyControls';
import ColorRow from './ColorRow';

const DISPLAY_FONTS = STORE_FONTS.filter((f) => f.role === 'display' || f.role === 'both');
const BODY_FONTS = STORE_FONTS.filter((f) => f.role === 'body' || f.role === 'both');

// The text elements that expose per-type typography. Each drills into an L2
// controls view; `styleKey` selects which theme block the controls edit.
type TextStyleKey = 'heading' | 'body';
const TEXT_STYLE_ROWS: { key: TextStyleKey; label: string; hint: string }[] = [
  { key: 'heading', label: L.headings, hint: L.headingEditHint },
  { key: 'body', label: L.body, hint: L.bodyEditHint },
];

export default function ThemePanel({
  theme,
  onChange,
  onApplyPreset,
}: {
  theme: StoreTheme;
  onChange: (theme: StoreTheme) => void;
  onApplyPreset: (presetId: string) => void;
}) {
  const setColor = (role: StoreColorRole, value: string) =>
    onChange({ ...theme, colors: { ...theme.colors, [role]: value } });

  // Which text element (if any) is drilled into. null = the compact L1 list.
  const [openStyle, setOpenStyle] = useState<TextStyleKey | null>(null);
  const openRow = TEXT_STYLE_ROWS.find((r) => r.key === openStyle) ?? null;

  return (
    <div className="space-y-4">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-charcoal/45">{L.theme}</h3>

      <label className="block">
        <span className="block text-xs font-medium text-charcoal/60 mb-1">{L.fontDisplay}</span>
        <select
          value={theme.fontDisplay}
          onChange={(e) => onChange({ ...theme, fontDisplay: e.target.value })}
          className="w-full bg-surface rounded-lg border border-sage-500/20 px-2.5 py-1.5 text-sm"
          style={{ fontFamily: DISPLAY_FONTS.find((f) => f.id === theme.fontDisplay)?.family }}
          data-font-display
        >
          {DISPLAY_FONTS.map((f) => (
            <option key={f.id} value={f.id} style={{ fontFamily: f.family }}>{f.label}</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-charcoal/60 mb-1">{L.fontBody}</span>
        <select
          value={theme.fontBody}
          onChange={(e) => onChange({ ...theme, fontBody: e.target.value })}
          className="w-full bg-surface rounded-lg border border-sage-500/20 px-2.5 py-1.5 text-sm"
          style={{ fontFamily: BODY_FONTS.find((f) => f.id === theme.fontBody)?.family }}
          data-font-body
        >
          {BODY_FONTS.map((f) => (
            <option key={f.id} value={f.id} style={{ fontFamily: f.family }}>{f.label}</option>
          ))}
        </select>
      </label>

      <div>
        <span className="block text-xs font-medium text-charcoal/60 mb-1.5">{L.colors}</span>
        <div className="space-y-1.5">
          {STORE_COLOR_ROLES.map((role) => (
            <ColorRow
              key={role}
              value={theme.colors[role]}
              label={STORE_COLOR_ROLE_LABEL[role]}
              onChange={(v) => setColor(role, v)}
              role={role}
            />
          ))}
        </div>
      </div>

      {/* Text styles: L1 is a compact list of text elements; clicking a row
          drills into that element's L2 typography controls. Colour stays in the
          Farger list above, so these controls hide it (showColor=false). */}
      <div data-text-styles-section>
        <span className="block text-xs font-medium text-charcoal/60 mb-1.5">{L.textStyles}</span>

        {openRow === null ? (
          <div className="space-y-1.5" data-text-styles-list>
            {TEXT_STYLE_ROWS.map((row) => (
              <button
                key={row.key}
                type="button"
                onClick={() => setOpenStyle(row.key)}
                className="w-full flex items-center justify-between rounded-lg border border-sage-500/20 bg-surface px-3 py-2 text-sm hover:bg-oatmeal/40 transition-colors"
                data-text-style-row={row.key}
              >
                <span>{row.label}</span>
                <span aria-hidden className="text-charcoal/40">›</span>
              </button>
            ))}
          </div>
        ) : (
          <div data-text-style-detail={openRow.key}>
            <button
              type="button"
              onClick={() => setOpenStyle(null)}
              className="flex items-center gap-1.5 text-xs font-medium text-charcoal/60 hover:text-charcoal mb-2"
              data-text-styles-back
            >
              <span aria-hidden>←</span>
              <span>{L.textStylesBack}</span>
            </button>
            <p className="text-[11px] text-charcoal/45 mb-1.5">{openRow.hint}</p>
            <TypographyControls
              value={openRow.key === 'heading' ? theme.heading : theme.body}
              onChange={(next) =>
                onChange(
                  openRow.key === 'heading'
                    ? { ...theme, heading: next }
                    : { ...theme, body: next },
                )
              }
              showColor={false}
              hook={openRow.key}
            />
          </div>
        )}
      </div>

      <div>
        <span className="block text-xs font-medium text-charcoal/60">{L.presets}</span>
        <p className="text-[11px] text-charcoal/45 mb-1.5">Endrer farger og fonter. Legger til en layout hvis butikken er tom.</p>
        <div className="flex flex-wrap gap-1.5">
          {STORE_PRESET_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onApplyPreset(id)}
              className="text-xs px-2.5 py-1 rounded-full border border-sage-500/30 hover:bg-oatmeal/40 transition-colors"
              data-preset={id}
            >
              {STORE_PRESETS[id].label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
