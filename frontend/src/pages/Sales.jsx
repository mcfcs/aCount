import { useState, useEffect, useCallback } from 'react'
import TopBar from '../components/layout/TopBar'
import KPICard from '../components/common/KPICard'
import LoadingSpinner from '../components/common/LoadingSpinner'
import EmptyState from '../components/common/EmptyState'
import Modal from '../components/common/Modal'
import { exportToCsv } from '../utils/csv'
import { getSales, getSalesSummary, getInventory, getPricingSuggestion, createSale, updateSale, deleteSale, linkInventoryToSale, unmatchSale, getPurchaseCosts } from '../services/api'
import { usePhpEstimateRate, usdToPhp } from '../utils/exchangeRate'

function formatUSD(value) {
  const num = parseFloat(value) || 0
  return `$${num.toFixed(2)}`
}

function formatPHP(value) {
  const num = parseFloat(value) || 0
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(num)
}

function calculateProfitPhp(amountMade, purchaseCost, phpRate) {
  const amountMadePhp = usdToPhp(amountMade, phpRate)
  if (amountMadePhp == null || purchaseCost == null) return null
  return parseFloat(amountMadePhp) - parseFloat(purchaseCost)
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  try { return new Date(dateStr).toLocaleDateString('en-PH') } catch { return dateStr }
}
function toDatetimeLocal(iso) {
  if (!iso) return ''
  try { return new Date(iso).toISOString().slice(0, 16) } catch { return '' }
}


const STATUS_STYLES = {
  Pending:            'bg-gray-100 text-gray-600',
  Confirmed:          'bg-blue-100 text-blue-700',
  Shipped:            'bg-purple-100 text-purple-700',
  Completed:          'bg-green-100 text-green-700',
  Cancelled:          'bg-red-100 text-red-700',
  'Attention Needed': 'bg-orange-100 text-orange-700',
  Consigned:          'bg-yellow-100 text-yellow-700',
  Returned:           'bg-slate-100 text-slate-600',
}
const SALE_TYPE_STYLES = {
  Regular:     'bg-gray-100 text-gray-600',
  FilledOffer: 'bg-indigo-100 text-indigo-700',
  Consignment: 'bg-teal-100 text-teal-700',
}
const SALE_TYPE_LABELS = { Regular: 'Regular', FilledOffer: 'Offer', Consignment: 'Consignment' }
const SALES_CSV_COLUMNS = [
  { key: 'order_number', label: 'Order Number' },
  { key: 'shoe_name', label: 'Shoe Name' },
  { key: 'sku', label: 'SKU' },
  { key: 'size', label: 'Size' },
  { key: 'sale_type', label: 'Sale Type' },
  { key: 'condition', label: 'Condition' },
  { key: 'box_condition', label: 'Box Condition' },
  { key: 'status', label: 'Status' },
  { key: 'selling_price', label: 'Selling Price (USD)' },
  { key: 'amount_made', label: 'Amount Made (USD)' },
  { key: 'purchase_cost', label: 'Purchase Cost (PHP)' },
  { key: 'sale_date', label: 'Sale Date' },
  { key: 'inventory_match_status', label: 'Inventory Match Status' },
  { key: 'notes', label: 'Notes' },
]

const ALL_STATUSES = ['Pending','Confirmed','Shipped','Completed','Cancelled','Attention Needed','Consigned','Returned']
const BUY_PRICE_ONLY_STATUSES = ['Shipped', 'Completed', 'Attention Needed', 'Cancelled']
const ALL_SALE_TYPES = ['Regular', 'FilledOffer', 'Consignment']
const PER_PAGE = 25

const INPUT = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400'
const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
    {children}
  </div>
)

const EMPTY_SALE = {
  order_number: '', shoe_name: '', sku: '', size: '',
  sale_type: 'Regular', condition: '', box_condition: '',
  selling_price: '', amount_made: '', sale_date: '',
  status: 'Pending', notes: '',
}

export default function Sales() {
  const [sales, setSales] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [orderSearch, setOrderSearch] = useState('')
  const [skuSearch, setSkuSearch] = useState('')
  const [matchableFilter, setMatchableFilter] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const phpRate = usePhpEstimateRate()

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_SALE)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [matchModalOpen, setMatchModalOpen] = useState(false)
  const [matchingSale, setMatchingSale] = useState(null)
  const [matchCandidates, setMatchCandidates] = useState([])
  const [selectedInventoryId, setSelectedInventoryId] = useState('')
  const [manualPurchaseCost, setManualPurchaseCost] = useState('')
  const [matchingLoading, setMatchingLoading] = useState(false)
  const [matchError, setMatchError] = useState(null)
  const [manualOnlyMatchMode, setManualOnlyMatchMode] = useState(false)
  const [availablePurchaseCosts, setAvailablePurchaseCosts] = useState([])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = { page, per_page: PER_PAGE }
      if (statusFilter) params.status = statusFilter
      const q = searchQuery.trim()
      if (q) params.shoe_name = q
      const oq = orderSearch.trim()
      if (oq) params.order_number = oq
      const sq = skuSearch.trim()
      if (sq) params.sku = sq
      if (matchableFilter) params.matchable = '1'
      const [salesData, summaryData] = await Promise.all([getSales(params), getSalesSummary()])
      const items = Array.isArray(salesData) ? salesData : salesData.sales || salesData.items || []
      const total = salesData.total || items.length
      setSales(items)
      setTotalPages(Math.max(1, Math.ceil(total / PER_PAGE)))
      setSummary(summaryData)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load sales data')
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, searchQuery, orderSearch, skuSearch, matchableFilter])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    setPage(1)
  }, [searchQuery, orderSearch, statusFilter, skuSearch, matchableFilter])

  const fetchAllSalesForExport = useCallback(async () => {
    let pageNum = 1
    const allItems = []
    const perPage = 100
    while (true) {
      const params = { page: pageNum, per_page: perPage }
      if (statusFilter) params.status = statusFilter
      const q = searchQuery.trim()
      if (q) params.shoe_name = q
      const oq = orderSearch.trim()
      if (oq) params.order_number = oq
      const salesData = await getSales(params)
      const items = Array.isArray(salesData) ? salesData : salesData.sales || salesData.items || []
      const totalPages = salesData.pages || Math.ceil((salesData.total || 0) / perPage)
      allItems.push(...items)
      if (salesData.pages != null) {
        if (pageNum >= totalPages) break
      } else if (items.length < perPage) {
        break
      } else if (salesData.total && allItems.length >= salesData.total) {
        break
      }
      pageNum += 1
    }
    return allItems
  }, [statusFilter, searchQuery, orderSearch])

  const openAdd = () => {
    setEditing(null)
    setForm({ ...EMPTY_SALE, sale_date: toDatetimeLocal(new Date().toISOString()) })
    setSaveError(null)
    setModalOpen(true)
  }

  const openEdit = (sale) => {
    setEditing(sale)
    setForm({
      order_number: sale.order_number ?? '',
      shoe_name: sale.shoe_name ?? '',
      sku: sale.sku ?? '',
      size: sale.size ?? '',
      sale_type: sale.sale_type ?? 'Regular',
      condition: sale.condition ?? '',
      box_condition: sale.box_condition ?? '',
      selling_price: sale.selling_price ?? '',
      amount_made: sale.amount_made ?? '',
      sale_date: toDatetimeLocal(sale.sale_date),
      status: sale.status ?? 'Pending',
      notes: sale.notes ?? '',
    })
    setSaveError(null)
    setModalOpen(true)
  }

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    try {
      const payload = {
        ...form,
        order_number: form.order_number ? Number(form.order_number) : undefined,
        size: form.size ? Number(form.size) : undefined,
        selling_price: form.selling_price !== '' ? Number(form.selling_price) : undefined,
        amount_made: form.amount_made !== '' ? Number(form.amount_made) : undefined,
      }
      if (editing) {
        await updateSale(editing.sale_id, payload)
      } else {
        await createSale(payload)
      }
      setModalOpen(false)
      fetchData()
    } catch (err) {
      setSaveError(err?.response?.data?.error || err?.response?.data?.errors?.join(', ') || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (sale) => {
    if (!window.confirm(`Delete Sale #${sale.order_number}? This action cannot be undone.`)) return
    try {
      await deleteSale(sale.sale_id)
      fetchData()
    } catch (err) {
      setError(err?.response?.data?.error || 'Delete failed')
    }
  }

  const handleUnmatch = async (sale) => {
    if (!window.confirm(`Unmatch Order #${sale.order_number}? This will clear linked inventory and buying price.`)) return
    try {
      await unmatchSale(sale.sale_id)
      fetchData()
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to unmatch sale.')
    }
  }

  const handleExport = async () => {
    try {
      const allSales = await fetchAllSalesForExport()
      exportToCsv('sales-export.csv', allSales, SALES_CSV_COLUMNS)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to export sales data')
    }
  }

  const openMatchModal = async (sale) => {
    setMatchingSale(sale)
    setSelectedInventoryId('')
    setManualPurchaseCost(sale?.purchase_cost != null ? String(sale.purchase_cost) : '')
    setMatchError(null)
    setMatchCandidates([])
    setAvailablePurchaseCosts([])
    setMatchingLoading(true)
    setManualOnlyMatchMode(BUY_PRICE_ONLY_STATUSES.includes(sale.status))
    setMatchModalOpen(true)

    // Fetch distinct recorded purchase costs for this SKU
    const costsData = sale?.sku
      ? await getPurchaseCosts({ sku: sale.sku }).catch(() => ({ costs: [] }))
      : { costs: [] }
    const costs = costsData.costs || []
    setAvailablePurchaseCosts(costs)

    if (BUY_PRICE_ONLY_STATUSES.includes(sale.status)) {
      try {
        // Only auto-fill if there is exactly one distinct recorded cost
        if (sale?.purchase_cost == null) {
          if (costs.length === 1) {
            setManualPurchaseCost(String(costs[0]))
          } else if (costs.length === 0) {
            const suggestion = await getPricingSuggestion({ sku: sale.sku })
            const estimated = suggestion?.estimated_purchase_cost
            if (estimated != null) setManualPurchaseCost(String(estimated))
          }
          // costs.length > 1 → leave blank, user picks from selector
        }
      } catch {
        // Non-blocking
      } finally {
        setMatchingLoading(false)
      }
      return
    }

    try {
      const filters = {}
      if (sale?.sku) filters.sku = sale.sku
      if (sale?.size != null) filters.size = sale.size
      filters.status = 'Available'
      const data = await getInventory(filters)
      const items = Array.isArray(data) ? data : data.items || []
      const filtered = items.filter(item => item.sku === sale.sku && Number(item.size) === Number(sale.size))
      setMatchCandidates(filtered)
      if (filtered.length === 0) {
        setMatchError('No exact available inventory match found.')
      }
      // Auto-fill manual cost only when no inventory selection possible AND exactly one recorded cost
      if (sale?.purchase_cost == null) {
        if (costs.length === 1) {
          setManualPurchaseCost(String(costs[0]))
        } else if (costs.length === 0) {
          const suggestion = await getPricingSuggestion({ sku: sale.sku })
          const estimated = suggestion?.estimated_purchase_cost
          if (estimated != null) setManualPurchaseCost(current => current || String(estimated))
        }
        // costs.length > 1 → leave blank, user picks from selector
      }
    } catch (err) {
      setMatchError(err?.response?.data?.error || 'Failed to load matching inventory.')
    } finally {
      setMatchingLoading(false)
    }
  }

  const closeMatchModal = () => {
    setMatchModalOpen(false)
    setMatchingSale(null)
    setMatchCandidates([])
    setMatchError(null)
    setSelectedInventoryId('')
    setManualPurchaseCost('')
    setManualOnlyMatchMode(false)
    setAvailablePurchaseCosts([])
  }

  const handleMatchSubmit = async (e) => {
    e.preventDefault()
    if (!matchingSale) return
    setMatchingLoading(true)
    setMatchError(null)
    try {
      const costStr = manualPurchaseCost === '__manual__' ? '' : manualPurchaseCost
      if (manualOnlyMatchMode) {
        const value = costStr !== '' ? Number(costStr) : NaN
        if (!Number.isFinite(value)) {
          setMatchError('Enter a valid buying price.')
          setMatchingLoading(false)
          return
        }
        await updateSale(matchingSale.sale_id, { purchase_cost: value })
      } else if (selectedInventoryId) {
        await linkInventoryToSale(Number(selectedInventoryId), matchingSale.sale_id)
      } else {
        const value = costStr !== '' ? Number(costStr) : NaN
        if (!Number.isFinite(value)) {
          setMatchError('Enter a valid buying price when not selecting an inventory item.')
          setMatchingLoading(false)
          return
        }
        await updateSale(matchingSale.sale_id, { purchase_cost: value })
      }
      closeMatchModal()
      await fetchData()
    } catch (err) {
      setMatchError(err?.response?.data?.error || err?.response?.data?.errors?.join(', ') || 'Failed to update matching.')
    } finally {
      setMatchingLoading(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <TopBar title="Sales" onRefresh={fetchData} loading={loading} />

        <div className="flex-1 p-4 space-y-6 sm:p-6">
        {summary && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <KPICard label="Total Sales" value={summary.total_sales ?? sales.length} />
            <KPICard label="Completed" value={summary.by_status?.Completed ?? '—'} />
            <KPICard label="Unmatched" value={summary.unmatched_sales ?? '—'} />
            <KPICard label="Completed Earnings" value={summary.completed_earnings_usd != null ? formatUSD(summary.completed_earnings_usd) : '—'} />
            <KPICard
              label={`Completed Earnings (PHP est. @ ${phpRate || 0})`}
              value={summary.completed_earnings_usd != null ? formatPHP(usdToPhp(summary.completed_earnings_usd, phpRate)) : '—'}
            />
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <input type="text" placeholder="Search shoe name…" value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 sm:w-auto" />
          <input type="text" placeholder="SKU…" value={skuSearch}
            onChange={e => setSkuSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 sm:w-36" />
          <input type="text" placeholder="Order #…" value={orderSearch}
            onChange={e => setOrderSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 sm:w-32" />
          <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 shadow-sm cursor-pointer select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={matchableFilter}
              onChange={e => setMatchableFilter(e.target.checked)}
              className="accent-indigo-600"
            />
            No cost, but matchable
          </label>
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500 sm:flex-1">
            Using USD→PHP rate from Settings: {phpRate}
          </div>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 sm:w-auto">
            <option value="">All Statuses</option>
            {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={handleExport}
            className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors sm:w-auto">
            Export CSV
          </button>
          <button onClick={openAdd}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors sm:ml-auto sm:w-auto">
            + Add Sale
          </button>
        </div>

        <div className="rounded-xl shadow-sm border border-gray-100 bg-white overflow-hidden">
          {loading ? <LoadingSpinner className="py-12" />
          : error ? <p className="p-6 text-sm text-red-500">{error}</p>
          : !sales.length ? <EmptyState title="No sales found" message="Try adjusting your filters." />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400 text-left">Order #</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400 text-left">Shoe Name</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400 text-left">Type</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400 text-left">SKU</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400 text-left">Size</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400 text-left">Status</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400 text-left">Amount Made</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400 text-left">Amount Made (PHP est.)</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400 text-left">Purchase Cost (PHP)</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400 text-left">Profit (PHP)</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400 text-left">Sale Date</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400 text-center">Inv. Match</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400 text-center">Match</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400 text-center">Edit</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400 text-center">Delete</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                {sales.map((sale, idx) => (
                    <tr key={sale.sale_id || idx} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">{sale.order_number || '—'}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">{sale.shoe_name || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {sale.sale_type ? (
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${SALE_TYPE_STYLES[sale.sale_type] || 'bg-gray-100 text-gray-600'}`}>
                            {SALE_TYPE_LABELS[sale.sale_type] || sale.sale_type}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{sale.sku || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{sale.size || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[sale.status] || 'bg-gray-100 text-gray-600'}`}>
                          {sale.status || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{sale.amount_made != null ? formatUSD(sale.amount_made) : '—'}</td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {usdToPhp(sale.amount_made, phpRate) != null ? formatPHP(usdToPhp(sale.amount_made, phpRate)) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{sale.purchase_cost != null ? formatPHP(sale.purchase_cost) : '—'}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {calculateProfitPhp(sale.amount_made, sale.purchase_cost, phpRate) != null
                          ? formatPHP(calculateProfitPhp(sale.amount_made, sale.purchase_cost, phpRate))
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(sale.sale_date)}</td>
                    <td className="px-4 py-3 text-center text-gray-500">
                        {sale.inventory_match_status === 'Matched'
                          ? <span className="text-green-600 font-medium">Matched</span>
                          : <span className="text-gray-400">Unmatched</span>}
                      </td>
                    <td className="px-4 py-3 text-center">
                      {sale.purchase_cost != null ? (
                        <button onClick={() => handleUnmatch(sale)}
                          className="text-xs text-amber-700 hover:text-amber-900 font-medium">
                          Unmatch
                        </button>
                      ) : BUY_PRICE_ONLY_STATUSES.includes(sale.status) ? (
                        <button onClick={() => openMatchModal(sale)}
                          className="text-xs text-emerald-700 hover:text-emerald-900 font-medium">
                          Add Buying Price
                        </button>
                      ) : (
                        <button onClick={() => openMatchModal(sale)}
                          className="text-xs text-green-700 hover:text-green-900 font-medium">
                          Match
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => openEdit(sale)}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                        Edit
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => handleDelete(sale)}
                        className="text-xs text-red-600 hover:text-red-800 font-medium">
                        Delete
                      </button>
                    </td>
                    </tr>
                  ))}
                </tbody>
              </table>
        </div>
      )}

      {matchModalOpen && (
        <Modal title={manualOnlyMatchMode ? `Add Buying Price for Order #${matchingSale?.order_number ?? ''}` : `Match Inventory for Order #${matchingSale?.order_number ?? ''}`} onClose={closeMatchModal}>
          <form onSubmit={handleMatchSubmit} className="space-y-4">
            <p className="text-sm text-gray-600">
              {manualOnlyMatchMode
                ? 'No inventory matching is required for this status. Please enter the buying price in PHP.'
                : 'Select the exact available inventory item, or enter a manual buying price if none exists.'}
            </p>
            {!manualOnlyMatchMode && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-600">Available Inventory Matches</label>
              {matchingLoading ? (
                  <p className="text-xs text-gray-500">Loading available matches...</p>
              ) : matchCandidates.length ? (
                <select value={selectedInventoryId} onChange={(e) => setSelectedInventoryId(e.target.value)} className={INPUT}>
                  <option value="">-- Select exact inventory item --</option>
                  {matchCandidates.map(item => (
                    <option key={item.inventory_id} value={item.inventory_id}>
                      #{item.inventory_id} | {item.sku} | size {item.size} | bought {formatPHP(item.purchase_cost)}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-gray-500">No exact available items found.</p>
              )}
            </div>
            )}
            {availablePurchaseCosts.length > 1 && !selectedInventoryId && (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-600">
                  Recorded Purchase Costs for this SKU
                </label>
                <select
                  value={manualPurchaseCost}
                  onChange={(e) => setManualPurchaseCost(e.target.value)}
                  className={INPUT}
                >
                  <option value="">— Pick a recorded cost —</option>
                  {availablePurchaseCosts.map(cost => (
                    <option key={cost} value={cost}>{formatPHP(cost)}</option>
                  ))}
                  <option value="__manual__">Enter manually…</option>
                </select>
              </div>
            )}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-600">
                {availablePurchaseCosts.length > 1 && !selectedInventoryId
                  ? 'Or enter a custom purchase cost (PHP)'
                  : 'Manual Purchase Cost (PHP)'}
              </label>
              <input
                type="number"
                step="0.01"
                value={manualPurchaseCost === '__manual__' ? '' : manualPurchaseCost}
                onChange={(e) => setManualPurchaseCost(e.target.value)}
                className={INPUT}
                placeholder={manualOnlyMatchMode ? 'Set buying price to continue' : 'Set only when no exact match'}
                disabled={!!selectedInventoryId}
              />
            </div>
            {matchError && <p className="text-sm text-red-500">{matchError}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={closeMatchModal}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button type="submit" disabled={matchingLoading}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                {matchingLoading ? 'Saving...' : 'Apply'}
              </button>
            </div>
          </form>
        </Modal>
      )}
        </div>

        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">Previous</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>

      {modalOpen && (
        <Modal title={editing ? `Edit Sale #${editing.order_number}` : 'Add Sale'} onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Order Number">
                <input type="number" required value={form.order_number} onChange={set('order_number')} className={INPUT} />
              </Field>
              <Field label="Sale Date">
                <input type="datetime-local" required value={form.sale_date} onChange={set('sale_date')} className={INPUT} />
              </Field>
            </div>
            <Field label="Shoe Name">
              <input type="text" required value={form.shoe_name} onChange={set('shoe_name')} className={INPUT} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="SKU">
                <input type="text" value={form.sku} onChange={set('sku')} className={INPUT} />
              </Field>
              <Field label="Size">
                <input type="number" step="0.5" value={form.size} onChange={set('size')} className={INPUT} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Sale Type">
                <select value={form.sale_type} onChange={set('sale_type')} className={INPUT}>
                  {ALL_SALE_TYPES.map(t => <option key={t} value={t}>{SALE_TYPE_LABELS[t]}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={set('status')} className={INPUT}>
                  {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Condition">
                <select value={form.condition} onChange={set('condition')} className={INPUT}>
                  <option value="">—</option>
                  <option>New</option>
                  <option>Used</option>
                </select>
              </Field>
              <Field label="Box Condition">
                <select value={form.box_condition} onChange={set('box_condition')} className={INPUT}>
                  <option value="">—</option>
                  <option>Good Condition</option>
                  <option>No Box</option>
                  <option>Badly Damaged</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Selling Price (USD)">
                <input type="number" step="0.01" value={form.selling_price} onChange={set('selling_price')} className={INPUT} />
              </Field>
              <Field label="Amount Made (USD)">
                <input type="number" step="0.01" value={form.amount_made} onChange={set('amount_made')} className={INPUT} />
              </Field>
            </div>
            <Field label="Notes">
              <textarea rows={2} value={form.notes} onChange={set('notes')} className={INPUT} />
            </Field>
            {saveError && <p className="text-sm text-red-500">{saveError}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setModalOpen(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}


