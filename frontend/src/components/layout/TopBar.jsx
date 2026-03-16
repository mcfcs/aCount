export default function TopBar({ title, onRefresh, loading = false }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
      <h1 className="text-base font-semibold text-gray-900 sm:text-xl">{title}</h1>
      <button
        onClick={onRefresh}
        disabled={loading}
        className="flex min-h-10 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-60 sm:px-3 sm:text-sm"
      >
        <svg
          className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
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
        <span className="hidden sm:inline">{loading ? 'Refreshing...' : 'Refresh'}</span>
      </button>
    </div>
  )
}
