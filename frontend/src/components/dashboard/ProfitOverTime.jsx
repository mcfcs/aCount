import EmptyState from '../common/EmptyState'

export default function ProfitOverTime() {
  // No time-series data available from the API yet — show a graceful placeholder
  return (
    <EmptyState
      title="Profit Over Time"
      message="Time-series profit data is not yet available. This chart will populate once time-series endpoints are added to the API."
      icon={
        <svg className="h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
        </svg>
      }
    />
  )
}
