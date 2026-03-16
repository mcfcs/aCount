import { useState, useEffect, useCallback } from 'react'
import TopBar from '../components/layout/TopBar'
import KPICard from '../components/common/KPICard'
import LoadingSpinner from '../components/common/LoadingSpinner'
import EmptyState from '../components/common/EmptyState'
import { getSales, getSalesSummary } from '../services/api'

function formatPHP(value) {
  const num = parseFloat(value) || 0
  return `₱${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatUSD(value) {
  const num = parseFloat(value) || 0
  return `$${num.toFixed(2)}`
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  try { return new Date(dateStr).toLocaleDateString('en-PH') } catch { return dateStr }
}

const SALE_TYPE_STYLES = {
  Regular:     'bg-gray-100 text-gray-600',
  FilledOffer: 'bg-indigo-100 text-indigo-700',
  Consignment: 'bg-teal-100 text-teal-700',
}

const SALE_TYPE_LABELS = {
  Regular:     'Regular',
  FilledOffer: 'Offer',
  Consignment: 'Consignment',
}

const STATUS_STYLES = {
  Pending:          'bg-gray-100 text-gray-600',
  Confirmed:        'bg-blue-100 text-blue-700',
  Shipped:          'bg-purple-100 text-purple-700',
  Completed:        'bg-green-100 text-green-700',
  Cancelled:        'bg-red-100 text-red-700',
  'Attention Needed': 'bg-orange-100 text-orange-700',
  Consigned:        'bg-yellow-100 text-yellow-700',
  Returned:         'bg-slate-100 text-slate-600',
}

const ALL_STATUSES = [
  'Pending', 'Confirmed', 'Shipped', 'Completed',
  'Cancelled', 'Attention Needed', 'Consigned', 'Returned',
]

const PER_PAGE = 25

export default function Sales() {
  const [sales, setSales] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = {
        page,
        per_page: PER_PAGE,
      }
      if (statusFilter) params.status = statusFilter

      const [salesData, summaryData] = await Promise.all([
        getSales(params),
        getSalesSummary(),
      ])

      const items = Array.isArray(salesData)
        ? salesData
        : salesData.sales || salesData.items || []
      const total = salesData.total || items.length
      setSales(items)
      setTotalPages(Math.max(1, Math.ceil(total / PER_PAGE)))
      setSummary(summaryData)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load sales data')
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter])

  useEffect(() => { fetchData() }, [fetchData])

  // Client-side name search filter
  const filtered = searchQuery
    ? sales.filter(s =>
        (s.shoe_name || s.name || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sales

  const handleStatusChange = (e) => {
    setStatusFilter(e.target.value)
    setPage(1)
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <TopBar title="Sales" onRefresh={fetchData} loading={loading} />

      <div className="flex-1 p-6 space-y-6">
        {/* Summary KPIs */}
        {summary && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KPICard
              label="Total Sales"
              value={summary.total_sales ?? sales.length}
            />
            <KPICard
              label="Completed"
              value={summary.by_status?.Completed ?? '—'}
            />
            <KPICard
              label="Unmatched"
              value={summary.unmatched_sales ?? '—'}
            />
            <KPICard
              label="Completed Earnings"
              value={summary.completed_earnings_usd != null ? formatUSD(summary.completed_earnings_usd) : '—'}
            />
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search shoe name…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <select
            value={statusFilter}
            onChange={handleStatusChange}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <option value="">All Statuses</option>
            {ALL_STATUSES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="rounded-xl shadow-sm border border-gray-100 bg-white overflow-hidden">
          {loading ? (
            <LoadingSpinner className="py-12" />
          ) : error ? (
            <p className="p-6 text-sm text-red-500">{error}</p>
          ) : !filtered.length ? (
            <EmptyState title="No sales found" message="Try adjusting your filters." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['Order #', 'Shoe Name', 'Type', 'SKU', 'Size', 'Status', 'Selling Price', 'Amount Made', 'Sale Date', 'Inventory Match'].map(col => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((sale, idx) => (
                    <tr key={sale.id || idx} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">
                        {sale.order_number || sale.order_id || '—'}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">
                        {sale.shoe_name || sale.name || '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {sale.sale_type ? (
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${SALE_TYPE_STYLES[sale.sale_type] || 'bg-gray-100 text-gray-600'}`}>
                            {SALE_TYPE_LABELS[sale.sale_type] || sale.sale_type}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {sale.sku || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {sale.size || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[sale.status] || 'bg-gray-100 text-gray-600'}`}>
                          {sale.status || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {sale.selling_price != null ? formatUSD(sale.selling_price) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {sale.amount_made != null ? formatUSD(sale.amount_made) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {formatDate(sale.sale_date || sale.date)}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {sale.inventory_match_status === 'Matched'
                          ? <span className="text-green-600 font-medium">Matched</span>
                          : <span className="text-gray-400">Unmatched</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
