// Left-rail theme controls: display/body font pickers, a colour picker per
// theme role, the preset picker, and reset. Emits whole-theme updates upward;
// the server re-sanitises on save.
import { STORE_FONTS, STORE_COLOR_ROLES, isValidHex, type StoreTheme, type StoreColorRole } from '../../lib/store-theme';
import { STORE_PRESETS, STORE_PRESET_IDS } from '../../lib/store-presets';
import { STORE_COLOR_ROLE_LABEL, STORE_EDITOR_LABELS as L } from '../../lib/labels';

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
          className="w-full bg-white rounded-lg border border-sage-500/20 px-2.5 py-1.5 text-sm"
          data-font-display
        >
          {DISPLAY_FONTS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-charcoal/60 mb-1">{L.fontBody}</span>
        <select
          value={theme.fontBody}
          onChange={(e) => onChange({ ...theme, fontBody: e.target.value })}
          className="w-full bg-white rounded-lg border border-sage-500/20 px-2.5 py-1.5 text-sm"
          data-font-body
        >
          {BODY_FONTS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </label>

      <div>
        <span className="block text-xs font-medium text-charcoal/60 mb-1.5">{L.colors}</span>
        <div className="space-y-1.5">
          {STORE_COLOR_ROLES.map((role) => (
            <div key={role} className="flex items-center gap-2">
              <input
                type="color"
                value={theme.colors[role]}
                onChange={(e) => setColor(role, e.target.value.toUpperCase())}
                className="w-7 h-7 rounded border border-sage-500/20 bg-white shrink-0 cursor-pointer"
                aria-label={STORE_COLOR_ROLE_LABEL[role]}
                data-color={role}
              />
              <span className="text-xs text-charcoal/70 flex-1 truncate">{STORE_COLOR_ROLE_LABEL[role]}</span>
              <input
                type="text"
                value={theme.colors[role]}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isValidHex(v)) setColor(role, v.toUpperCase());
                  else setColor(role, v); // keep typing; sanitised server-side
                }}
                className="w-20 bg-white rounded border border-sage-500/20 px-1.5 py-1 text-[11px] font-mono"
                spellCheck={false}
                data-color-hex={role}
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <span className="block text-xs font-medium text-charcoal/60 mb-1.5">{L.presets}</span>
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
