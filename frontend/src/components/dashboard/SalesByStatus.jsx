import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import EmptyState from '../common/EmptyState'
import LoadingSpinner from '../common/LoadingSpinner'

const STATUS_COLORS = {
  Pending: '#9ca3af',
  Confirmed: '#3b82f6',
  Shipped: '#a855f7',
  Completed: '#22c55e',
  Cancelled: '#ef4444',
  'Attention Needed': '#f97316',
  Consigned: '#eab308',
  Returned: '#64748b',
}

const FALLBACK_COLORS = [
  '#6366f1', '#22c55e', '#3b82f6', '#f59e0b',
  '#ef4444', '#a855f7', '#14b8a6', '#f97316',
]

function CustomTooltip({ active, payload }) {
  if (active && payload && payload.length) {
    const { name, value } = payload[0]
    return (
      <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-md text-sm">
        <p className="font-medium text-gray-800">{name}</p>
        <p className="text-gray-500">{value} sale{value !== 1 ? 's' : ''}</p>
      </div>
    )
  }
  return null
}

export default function SalesByStatus({ sales = [], statusCounts = null, loading = false, error = null }) {
  if (loading) return <LoadingSpinner className="py-8" />
  if (error) return <p className="py-4 text-sm text-red-500">{error}</p>

  // Prefer a pre-aggregated { status: count } map (cheaper than shipping rows);
  // fall back to counting a raw sales array when only that is provided.
  let data
  if (statusCounts && typeof statusCounts === 'object') {
    data = Object.entries(statusCounts)
      .map(([name, value]) => ({ name, value: Number(value) || 0 }))
      .filter((d) => d.value > 0)
  } else {
    const counts = {}
    for (const sale of sales) {
      const status = sale.status || 'Unknown'
      counts[status] = (counts[status] || 0) + 1
    }
    data = Object.entries(counts).map(([name, value]) => ({ name, value }))
  }

  if (!data.length) return <EmptyState title="No sales data" message="Sales will appear here once recorded." />

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={2}
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={STATUS_COLORS[entry.name] || FALLBACK_COLORS[index % FALLBACK_COLORS.length]}
            />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(value) => <span className="text-xs text-gray-600">{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
