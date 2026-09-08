// Left-rail theme controls: display/body font pickers, a colour picker per
// theme role, the preset picker, and reset. Emits whole-theme updates upward;
// the server re-sanitises on save.
import { STORE_FONTS, STORE_COLOR_ROLES, type StoreTheme, type StoreColorRole } from '../../lib/store-theme';
import { STORE_PRESETS, STORE_PRESET_IDS } from '../../lib/store-presets';
import { STORE_COLOR_ROLE_LABEL, STORE_EDITOR_LABELS as L } from '../../lib/labels';
import HeadingControls from './HeadingControls';
import ColorRow from './ColorRow';

const DISPLAY_FONTS = STORE_FONTS.filter((f) => f.role === 'display' || f.role === 'both');
const BODY_FONTS = STORE_FONTS.filter((f) => f.role === 'body' || f.role === 'both');

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

      <div data-heading-section>
        <span className="block text-xs font-medium text-charcoal/60 mb-1">{L.headings}</span>
        <p className="text-[11px] text-charcoal/45 mb-1.5">{L.headingEditHint}</p>
        <HeadingControls theme={theme} onChange={onChange} showColor={false} />
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
