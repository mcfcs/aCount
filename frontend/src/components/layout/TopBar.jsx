export default function TopBar({ title, onRefresh, loading = false }) {
  return (
    <div className="sticky top-0 z-30 border-b border-gray-100 bg-gray-50/85 backdrop-blur-md">
      {/* hairline volt rule */}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-linear-to-r from-indigo-600/70 via-indigo-600/10 to-transparent" />
      <div className="flex items-end justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
        <div className="min-w-0">
          <p className="kicker mb-1">aCount&nbsp;/&nbsp;ledger</p>
          <h1 className="font-display truncate text-3xl uppercase leading-none text-gray-900 sm:text-4xl">
            {title}
          </h1>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="group flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-600 transition-colors hover:border-indigo-400/60 hover:text-gray-900 disabled:opacity-60 sm:text-sm"
        >
          <svg
            className={`h-4 w-4 text-gray-400 transition-colors group-hover:text-indigo-600 ${loading ? 'animate-spin text-indigo-600' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          <span className="hidden sm:inline">{loading ? 'Syncing' : 'Refresh'}</span>
        </button>
      </div>
    </div>
  )
}
