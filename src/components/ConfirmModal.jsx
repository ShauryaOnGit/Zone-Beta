export default function ConfirmModal({
  title,
  description,
  confirmLabel,
  busyLabel,
  onConfirm,
  onCancel,
  busy = false,
  error = '',
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/25 p-4"
      onMouseDown={() => {
        if (!busy) onCancel?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="zone-confirm-title"
        className="w-full max-w-md overflow-hidden rounded-md border border-[#D0D7DE] bg-white shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-6 py-5">
          <h2
            id="zone-confirm-title"
            className="text-xl font-semibold text-slate-900"
          >
            {title}
          </h2>

          {description && (
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {description}
            </p>
          )}
        </div>

        <div className="px-6 py-5">
          {error && (
            <p className="mb-4 text-sm text-rose-600">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="h-10 rounded-md border border-[#D0D7DE] bg-white px-4 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="h-10 rounded-md bg-rose-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {busy ? busyLabel || 'Working...' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
