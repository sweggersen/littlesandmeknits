// Top toolbar: save draft, preview draft, publish, reset. Status text reflects
// the async save/publish state.
import { STORE_EDITOR_LABELS as L } from '../../lib/labels';

export type AsyncState = 'idle' | 'busy' | 'done' | 'error';

export default function Toolbar({
  dirty,
  saveState,
  publishState,
  error,
  onSave,
  onPreview,
  onPublish,
  onReset,
}: {
  dirty: boolean;
  saveState: AsyncState;
  publishState: AsyncState;
  error: string | null;
  onSave: () => void;
  onPreview: () => void;
  onPublish: () => void;
  onReset: () => void;
}) {
  const saveLabel =
    saveState === 'busy' ? L.saving : saveState === 'done' && !dirty ? L.saved : L.save;
  const publishLabel = publishState === 'busy' ? L.publishing : publishState === 'done' ? L.published : L.publish;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onSave}
        disabled={saveState === 'busy'}
        className="btn-primary px-4 py-2 rounded-full text-sm font-medium disabled:opacity-50"
        data-save
      >
        {saveLabel}
      </button>
      <button
        type="button"
        onClick={onPreview}
        className="px-4 py-2 rounded-full text-sm font-medium border border-sage-500/30 hover:bg-oatmeal/40 transition-colors"
        data-preview
      >
        {L.preview}
      </button>
      <button
        type="button"
        onClick={onPublish}
        disabled={publishState === 'busy'}
        className="px-4 py-2 rounded-full text-sm font-medium bg-charcoal text-linen hover:opacity-90 transition-opacity disabled:opacity-50"
        data-publish
      >
        {publishLabel}
      </button>
      <button
        type="button"
        onClick={onReset}
        className="px-4 py-2 rounded-full text-sm font-medium text-charcoal/60 hover:bg-sage-100/60 transition-colors ml-auto"
        data-reset
      >
        {L.reset}
      </button>
      {error && <span className="w-full text-sm text-terracotta-700">{error}</span>}
    </div>
  );
}
