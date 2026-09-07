// Left-rail block palette: one button per registry block type. Clicking a
// button appends a new block (default props + a layout slot) to the canvas.
import { BLOCK_REGISTRY, STORE_BLOCK_TYPES } from '../../lib/store-blocks';
import type { StoreBlockType } from '../../lib/store-blocks';
import { STORE_EDITOR_LABELS as L } from '../../lib/labels';

export default function BlockPalette({ onAdd }: { onAdd: (type: StoreBlockType) => void }) {
  return (
    <div>
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-charcoal/45 mb-2">{L.blocks}</h3>
      <div className="space-y-1.5">
        {STORE_BLOCK_TYPES.map((type) => {
          const def = BLOCK_REGISTRY[type];
          return (
            <button
              key={type}
              type="button"
              onClick={() => onAdd(type)}
              className="w-full text-left bg-white rounded-xl border border-sage-500/15 hover:border-primary/40 hover:bg-oatmeal/30 transition-colors px-3 py-2"
              data-add-block={type}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{def.label}</span>
                <span className="text-charcoal/40 text-lg leading-none">+</span>
              </div>
              <p className="text-[11px] text-charcoal/50 mt-0.5 leading-snug">{def.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
