import { useState, useEffect, useCallback } from 'react'
import TopBar from '../components/layout/TopBar'
import KPICard from '../components/common/KPICard'
import LoadingSpinner from '../components/common/LoadingSpinner'
import EmptyState from '../components/common/EmptyState'
import Modal from '../components/common/Modal'
import { exportToCsv } from '../utils/csv'
import { getSales, getSalesSummary, createSale, updateSale, deleteSale } from '../services/api'
import { usePhpEstimateRate, usdToPhp } from '../utils/exchangeRate'

function formatUSD(value) {
  const num = parseFloat(value) || 0
  return `$${num.toFixed(2)}`
}

function formatPHP(value) {
  const num = parseFloat(value) || 0
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(num)
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
  { key: 'sale_date', label: 'Sale Date' },
  { key: 'inventory_match_status', label: 'Inventory Match Status' },
  { key: 'notes', label: 'Notes' },
]

const ALL_STATUSES = ['Pending','Confirmed','Shipped','Completed','Cancelled','Attention Needed','Consigned','Returned']
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
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const phpRate = usePhpEstimateRate()

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_SALE)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const applyFilters = useCallback((rows) => {
    return rows.filter(s => {
      const q = searchQuery.toLowerCase()
      const oq = orderSearch.trim()
      const nameMatch = !q || (s.shoe_name || '').toLowerCase().includes(q)
      const orderMatch = !oq || String(s.order_number || '').includes(oq)
      return nameMatch && orderMatch
    })
  }, [searchQuery, orderSearch])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = { page, per_page: PER_PAGE }
      if (statusFilter) params.status = statusFilter
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
  }, [page, statusFilter])

  useEffect(() => { fetchData() }, [fetchData])
  const filtered = applyFilters(sales)

  const fetchAllSalesForExport = useCallback(async () => {
    let pageNum = 1
    const allItems = []
    const perPage = 100
    while (true) {
      const params = { page: pageNum, per_page: perPage }
      if (statusFilter) params.status = statusFilter
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
  }, [statusFilter])

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

  const handleExport = async () => {
    try {
      const allSales = await fetchAllSalesForExport()
      const allFiltered = applyFilters(allSales)
      exportToCsv('sales-export.csv', allFiltered, SALES_CSV_COLUMNS)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to export sales data')
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
          <input type="text" placeholder="Order #…" value={orderSearch}
            onChange={e => setOrderSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 sm:w-32" />
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
          : !filtered.length ? <EmptyState title="No sales found" message="Try adjusting your filters." />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['Order #','Shoe Name','Type','SKU','Size','Status','Selling Price','Amount Made','Amount Made (PHP est.)','Sale Date','Inv. Match',''].map(col => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((sale, idx) => (
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
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{sale.selling_price != null ? formatUSD(sale.selling_price) : '—'}</td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{sale.amount_made != null ? formatUSD(sale.amount_made) : '—'}</td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {usdToPhp(sale.amount_made, phpRate) != null ? formatPHP(usdToPhp(sale.amount_made, phpRate)) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(sale.sale_date)}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {sale.inventory_match_status === 'Matched'
                          ? <span className="text-green-600 font-medium">Matched</span>
                          : <span className="text-gray-400">Unmatched</span>}
                      </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button onClick={() => openEdit(sale)}
                          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                          Edit
                        </button>
                        <button onClick={() => handleDelete(sale)}
                          className="text-xs text-red-600 hover:text-red-800 font-medium">
                          Delete
                        </button>
                      </div>
                    </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

