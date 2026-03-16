import EmptyState from '../common/EmptyState'
import LoadingSpinner from '../common/LoadingSpinner'

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('en-PH')
  } catch {
    return dateStr
  }
}

const statusColors = {
  Success: 'bg-green-100 text-green-700',
  Skipped: 'bg-gray-100 text-gray-500',
  Failed: 'bg-red-100 text-red-700',
}

export default function RecentActivity({ entries = [], loading = false, error = null }) {
  if (loading) return <LoadingSpinner className="py-8" />
  if (error) return <p className="py-4 text-sm text-red-500">{error}</p>
  if (!entries.length) return <EmptyState title="No recent activity" />

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
            <th className="pb-2 pr-4">Date</th>
            <th className="pb-2 pr-4">Subject / Description</th>
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {entries.slice(0, 15).map((entry, idx) => (
            <tr key={idx} className="hover:bg-gray-50">
              <td className="py-2 pr-4 whitespace-nowrap text-gray-500">
                {formatDate(entry.processed_at || entry.date || entry.created_at)}
              </td>
              <td className="py-2 pr-4 max-w-xs truncate text-gray-800">
                {entry.email_type || entry.subject || entry.description || '—'}
              </td>
              <td className="py-2 pr-4">
                {entry.status && (
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[entry.status] || 'bg-gray-100 text-gray-600'}`}>
                    {entry.status}
                  </span>
                )}
              </td>
              <td className="py-2 text-gray-500 text-xs max-w-xs truncate">
                {entry.error_message || entry.linked_record_type || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
