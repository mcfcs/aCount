import AlertBadge from '../common/AlertBadge'
import EmptyState from '../common/EmptyState'
import LoadingSpinner from '../common/LoadingSpinner'

const urgencyOrder = ['critical', 'high', 'medium', 'low']

const borderColors = {
  critical: 'border-red-500 bg-red-50',
  high: 'border-orange-500 bg-orange-50',
  medium: 'border-yellow-500 bg-yellow-50',
  low: 'border-blue-500 bg-blue-50',
}

function formatDate(dateStr) {
  if (!dateStr) return null
  try {
    return new Date(dateStr).toLocaleDateString('en-PH')
  } catch {
    return dateStr
  }
}

export default function ActionItems({ alerts = [], loading = false, error = null }) {
  if (loading) return <LoadingSpinner className="py-8" />
  if (error) return <p className="py-4 text-sm text-red-500">{error}</p>

  const safeAlerts = Array.isArray(alerts)
    ? alerts
    : (alerts && Array.isArray(alerts.alerts) ? alerts.alerts : [])

  const grouped = {}
  for (const u of urgencyOrder) {
    const items = safeAlerts.filter(a => a.urgency === u)
    if (items.length) grouped[u] = items
  }

  const hasItems = Object.keys(grouped).length > 0

  return (
    <div className="max-h-[30rem] space-y-4 overflow-y-auto overflow-x-hidden pr-1">
      {!hasItems && <EmptyState title="No action items" message="All caught up!" />}
      {urgencyOrder.map(urgency => {
        const items = grouped[urgency]
        if (!items) return null
        return (
          <div key={urgency}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              {urgency} ({items.length})
            </p>
            <div className="space-y-2">
              {items.map((alert, idx) => (
                <div
                  key={idx}
                  className={`rounded-lg border-l-4 p-3 ${borderColors[urgency] || 'border-gray-300 bg-gray-50'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 break-words text-sm text-gray-800">{alert.message}</p>
                    <span className="shrink-0"><AlertBadge urgency={urgency} /></span>
                  </div>
                  {alert.type && (
                    <p className="mt-1 text-xs text-gray-500">Type: {alert.type}</p>
                  )}
                  {(alert.type === 'shipment_deadline' || alert.type === 'overdue_shipment') && alert.deadline && (
                    <p className="mt-1 text-xs font-medium text-gray-600">
                      Deadline: {formatDate(alert.deadline)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
