import { useState, useEffect, useCallback } from 'react'
import TopBar from '../components/layout/TopBar'
import KPICard from '../components/common/KPICard'
import LoadingSpinner from '../components/common/LoadingSpinner'
import EmptyState from '../components/common/EmptyState'
import { getInventory } from '../services/api'

function formatPHP(value) {
  const num = parseFloat(value) || 0
  return `₱${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatUSD(value) {
  if (value == null) return '—'
  const num = parseFloat(value) || 0
  return `$${num.toFixed(2)}`
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  try { return new Date(dateStr).toLocaleDateString('en-PH') } catch { return dateStr }
}

function isOldItem(dateStr) {
  if (!dateStr) return false
  try {
    const days = (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
    return days > 90
  } catch { return false }
}

const STATUS_STYLES = {
  Available: 'bg-green-100 text-green-700',
  Sold:      'bg-blue-100 text-blue-700',
  Consigned: 'bg-yellow-100 text-yellow-700',
}

const ALL_STATUSES = ['Available', 'Sold', 'Consigned']

export default function Inventory() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = {}
      if (statusFilter) params.status = statusFilter
      const data = await getInventory(params)
      const arr = Array.isArray(data) ? data : data.inventory || data.items || []
      setItems(arr)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load inventory')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const filtered = searchQuery
    ? items.filter(item => {
        const q = searchQuery.toLowerCase()
        return (
          (item.shoe_name || item.name || '').toLowerCase().includes(q) ||
          (item.sku || '').toLowerCase().includes(q)
        )
      })
    : items

  // Summary stats
  const totalItems = items.length
  const availableCount = items.filter(i => i.status === 'Available').length
  const soldCount = items.filter(i => i.status === 'Sold').length
  const consignedCount = items.filter(i => i.status === 'Consigned').length
  const totalValue = items.reduce((sum, i) => sum + (parseFloat(i.purchase_cost_php || i.purchase_cost || 0)), 0)

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <TopBar title="Inventory" onRefresh={fetchData} loading={loading} />

      <div className="flex-1 p-6 space-y-6">
        {/* Summary KPIs */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <KPICard label="Total Items" value={totalItems} />
          <KPICard label="Available" value={availableCount} valueClassName="text-green-600" />
          <KPICard label="Sold" value={soldCount} valueClassName="text-blue-600" />
          <KPICard label="Consigned" value={consignedCount} valueClassName="text-yellow-600" />
          <KPICard label="Total Cost Value" value={formatPHP(totalValue)} />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search name or SKU…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value) }}
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
            <EmptyState title="No inventory items" message="Try adjusting your filters." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['SKU', 'Shoe Name', 'Size', 'Status', 'Purchase Cost', 'Listed Price', 'Date Purchased', 'Source', 'Linked Sale'].map(col => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((item, idx) => {
                    const aging = item.status === 'Available' && isOldItem(item.date_purchased || item.purchase_date)
                    return (
                      <tr key={item.id || idx} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">
                          {item.sku || '—'}
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          <span className="font-medium text-gray-900 truncate block">
                            {item.shoe_name || item.name || '—'}
                          </span>
                          {aging && (
                            <span className="inline-flex items-center gap-1 text-xs text-orange-600 font-medium">
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                              Aging ({Math.floor((Date.now() - new Date(item.date_purchased || item.purchase_date).getTime()) / (1000 * 60 * 60 * 24))}d)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500">{item.size || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[item.status] || 'bg-gray-100 text-gray-600'}`}>
                            {item.status || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          {item.purchase_cost_php != null
                            ? formatPHP(item.purchase_cost_php)
                            : item.purchase_cost != null
                            ? formatPHP(item.purchase_cost)
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          {item.listed_price_usd != null
                            ? formatUSD(item.listed_price_usd)
                            : item.listed_price != null
                            ? formatUSD(item.listed_price)
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          {formatDate(item.date_purchased || item.purchase_date)}
                        </td>
                        <td className="px-4 py-3 text-gray-500">{item.source || '—'}</td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                          {item.linked_sale_id || item.sale_id || '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
