import { useState, useEffect, useCallback } from 'react'
import TopBar from '../components/layout/TopBar'
import KPICard from '../components/common/KPICard'
import LoadingSpinner from '../components/common/LoadingSpinner'
import EmptyState from '../components/common/EmptyState'
import Modal from '../components/common/Modal'
import { exportToCsv } from '../utils/csv'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import {
  getInventory,
  createInventoryItem,
  createInventoryItems,
  updateInventoryItem,
  deleteInventoryItem,
  getShoeBySku,
  getPricingSuggestion,
  getShoes,
  ensureShoe,
} from '../services/api'

function formatPHP(value) {
  const num = parseFloat(value) || 0
  return `₱${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function formatUSD(value) {
  if (value == null) return '—'
  return `$${parseFloat(value).toFixed(2)}`
}
function formatDate(dateStr) {
  if (!dateStr) return '—'
  try { return new Date(dateStr).toLocaleDateString('en-PH') } catch { return dateStr }
}
function isOldItem(dateStr) {
  if (!dateStr) return false
  try { return (Date.now() - new Date(dateStr).getTime()) / 86400000 > 90 } catch { return false }
}
function toDatetimeLocal(iso) {
  if (!iso) return ''
  try { return new Date(iso).toISOString().slice(0, 16) } catch { return '' }
}

const STATUS_STYLES = {
  Available: 'bg-green-100 text-green-700',
  Sold:      'bg-blue-100 text-blue-700',
  Consigned: 'bg-yellow-100 text-yellow-700',
}
const ALL_STATUSES = ['Available', 'Sold', 'Consigned']
const ALL_BRANDS = [
  'Air Jordan', 'New Balance', 'Adidas', 'Nike', 'Puma',
  'Asics', 'Converse', 'Hoka', 'Reebok', 'Other',
]
const BRAND_COLORS = {
  Nike: '#22c55e',
  Adidas: '#3b82f6',
  Other: '#9ca3af',
  'Air Jordan': '#f59e0b',
  'New Balance': '#8b5cf6',
  Puma: '#14b8a6',
  Asics: '#ef4444',
  Converse: '#64748b',
  Hoka: '#f97316',
  Reebok: '#06b6d4',
}
const SHOE_CHART_FALLBACK = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#14b8a6', '#8b5cf6', '#f97316', '#06b6d4', '#64748b', '#3b82f6']

const INPUT = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400'
const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
    {children}
  </div>
)

const EMPTY_ITEM = {
  sku: '', shoe_name: '', size: '', status: 'Available',
  brand: '',
  purchase_cost: '', listed_price: '', date_purchased: '',
  source: '', notes: '',
}
const EMPTY_BULK_ITEM = { size: '', quantity: 1 }
const EMPTY_SHOE_ITEM = {
  sku: '',
  name: '',
  brand: '',
}
const INVENTORY_CSV_COLUMNS = [
  { key: 'sku', label: 'SKU' },
  { key: 'shoe_name', label: 'Shoe Name' },
  { key: 'size', label: 'Size' },
  { key: 'status', label: 'Status' },
  { key: 'purchase_cost', label: 'Purchase Cost' },
  { key: 'listed_price', label: 'Listed Price' },
  { key: 'date_purchased', label: 'Date Purchased' },
  { key: 'source', label: 'Source' },
  { key: 'notes', label: 'Notes' },
  { key: 'linked_sale_id', label: 'Linked Sale ID' },
]

export default function Inventory() {
  const [items, setItems] = useState([])
  const [shoes, setShoes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [activeView, setActiveView] = useState('inventory')
  const [shoeBrandFilter, setShoeBrandFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_ITEM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkItems, setBulkItems] = useState([EMPTY_BULK_ITEM])

  const [shoeModalOpen, setShoeModalOpen] = useState(false)
  const [shoeForm, setShoeForm] = useState(EMPTY_SHOE_ITEM)
  const [shoeSaving, setShoeSaving] = useState(false)
  const [shoeSaveError, setShoeSaveError] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const fetchAllPages = async (requestFn, baseParams) => {
      const perPage = 100
      const allRows = []
      let pageNum = 1
      const q = searchQuery.trim()
      const shouldFetchAll = Boolean(q)
      if (!shouldFetchAll) {
        const firstData = await requestFn({ ...baseParams, page: pageNum, per_page: 200 })
        return Array.isArray(firstData) ? firstData : firstData.inventory || firstData.shoes || firstData.items || []
      }

      while (true) {
        const data = await requestFn({ ...baseParams, page: pageNum, per_page: perPage })
        const rows = Array.isArray(data) ? data : data.inventory || data.shoes || data.items || []
        const totalPages = data.pages || Math.ceil((data.total || 0) / perPage)
        allRows.push(...rows)
        if (data.pages != null) {
          if (pageNum >= totalPages) break
        } else if (rows.length < perPage) {
          break
        } else if (data.total && allRows.length >= data.total) {
          break
        }
        pageNum += 1
      }
      return allRows
    }

    if (activeView === 'shoes') {
      try {
        const params = {
          sort_by: 'sku',
          order: 'asc',
        }
        if (shoeBrandFilter) params.brand = shoeBrandFilter
        const q = searchQuery.trim()
        if (q) params.q = q
        const rows = await fetchAllPages((requestParams) => getShoes(requestParams), params)
        setShoes(rows)
      } catch (err) {
        setError(err?.response?.data?.error || 'Failed to load shoes')
      } finally {
        setLoading(false)
      }
      return
    }

    try {
      const params = {}
      if (statusFilter) params.status = statusFilter
      const q = searchQuery.trim()
      if (q) params.q = q
      const rows = await fetchAllPages((requestParams) => getInventory(requestParams), params)
      setItems(Array.isArray(rows) ? rows : [])
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load inventory')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, activeView, shoeBrandFilter, searchQuery])

  useEffect(() => { fetchData() }, [fetchData])

  const shoeBrandData = Object.entries(
    shoes.reduce((acc, item) => {
      const brand = item.brand || 'Other'
      acc[brand] = (acc[brand] || 0) + 1
      return acc
    }, {})
  ).map(([brand, count]) => ({
    name: brand,
    value: count,
  }))

  const fetchAllInventoryForExport = useCallback(async () => {
    let pageNum = 1
    const allItems = []
    const perPage = 100
    const q = searchQuery.trim()
    while (true) {
      const params = { page: pageNum, per_page: perPage }
      if (statusFilter) params.status = statusFilter
      if (q) params.q = q
      const data = await getInventory(params)
      const rows = Array.isArray(data) ? data : data.inventory || data.items || []
      const totalPages = data.pages || Math.ceil((data.total || 0) / perPage)
      allItems.push(...rows)
      if (data.pages != null) {
        if (pageNum >= totalPages) break
      } else if (rows.length < perPage) {
        break
      } else if (data.total && allItems.length >= data.total) {
        break
      }
      pageNum += 1
    }
    return allItems
  }, [statusFilter, searchQuery])

  const totalValue = items.reduce((sum, i) => sum + parseFloat(i.purchase_cost || 0), 0)

  const openAdd = () => {
    setEditing(null)
    setForm({ ...EMPTY_ITEM, date_purchased: toDatetimeLocal(new Date().toISOString()) })
    setBulkMode(true)
    setBulkItems([{ ...EMPTY_BULK_ITEM }])
    setSaveError(null)
    setModalOpen(true)
  }

  const openEdit = (item) => {
    setEditing(item)
    setForm({
      sku: item.sku ?? '',
      shoe_name: item.shoe_name ?? '',
      brand: item.brand ?? '',
      size: item.size ?? '',
      status: item.status ?? 'Available',
      purchase_cost: item.purchase_cost ?? '',
      listed_price: item.listed_price ?? '',
      date_purchased: toDatetimeLocal(item.date_purchased),
      source: item.source ?? '',
      notes: item.notes ?? '',
    })
    setBulkMode(false)
    setBulkItems([{ ...EMPTY_BULK_ITEM }])
    setSaveError(null)
    setModalOpen(true)
  }

  const openAddShoe = () => {
    setShoeForm(EMPTY_SHOE_ITEM)
    setShoeSaveError(null)
    setShoeModalOpen(true)
  }

  const setField = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))
  const setBulkField = (idx, field) => (e) => {
    setBulkItems(items => items.map((item, i) => (i === idx ? { ...item, [field]: e.target.value } : item)))
  }
  const setShoeField = (field) => (e) => setShoeForm(f => ({ ...f, [field]: e.target.value }))
  const addBulkItem = () => setBulkItems(items => [...items, { ...EMPTY_BULK_ITEM }])
  const removeBulkItem = (idx) => setBulkItems(items => items.length === 1 ? items : items.filter((_, i) => i !== idx))
  const autofillPurchaseCostFromSku = async (sku) => {
    if (editing) return
    if (!sku) return
    if (form.purchase_cost !== '') return
    try {
      const suggestion = await getPricingSuggestion({ sku })
      const estimated = suggestion?.estimated_purchase_cost
      if (estimated != null) {
        setForm(prev => ({ ...prev, purchase_cost: String(estimated) }))
      }
    } catch {
      // Non-blocking: keep manual value if no historical cost exists
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    try {
      if (editing) {
        const payload = {
          ...form,
          size: form.size !== '' ? Number(form.size) : undefined,
          purchase_cost: form.purchase_cost !== '' ? Number(form.purchase_cost) : undefined,
          listed_price: form.listed_price !== '' ? Number(form.listed_price) : undefined,
        }
        await updateInventoryItem(editing.inventory_id, payload)
        setModalOpen(false)
        fetchData()
      } else if (bulkMode) {
        const basePayload = {
          sku: form.sku.trim(),
          shoe_name: form.shoe_name.trim(),
          status: form.status,
          brand: form.brand.trim(),
          purchase_cost: form.purchase_cost !== '' ? Number(form.purchase_cost) : undefined,
          listed_price: form.listed_price !== '' ? Number(form.listed_price) : undefined,
          date_purchased: form.date_purchased,
          source: form.source.trim(),
          notes: form.notes.trim(),
        }
        const items = []
        for (const row of bulkItems) {
          const size = Number(row.size)
          const quantity = Number.parseInt(row.quantity, 10)
          if (!Number.isFinite(size)) {
            setSaveError('Size must be a valid number.')
            setSaving(false)
            return
          }
          if (!Number.isInteger(quantity) || quantity < 1) {
            setSaveError('Each quantity must be a positive integer.')
            setSaving(false)
            return
          }
          items.push({ size, quantity })
        }
        if (!items.length) {
          setSaveError('Add at least one size row.')
          setSaving(false)
          return
        }
        await createInventoryItems({ ...basePayload, items })
        setModalOpen(false)
        fetchData()
      } else {
        const payload = {
          ...form,
          size: form.size !== '' ? Number(form.size) : undefined,
          purchase_cost: form.purchase_cost !== '' ? Number(form.purchase_cost) : undefined,
          listed_price: form.listed_price !== '' ? Number(form.listed_price) : undefined,
        }
        await createInventoryItem(payload)
        setModalOpen(false)
        fetchData()
      }
    } catch (err) {
      setSaveError(err?.response?.data?.error || err?.response?.data?.errors?.join(', ') || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete ${item.shoe_name || item.sku || 'this item'}? This action cannot be undone.`)) return
    try {
      await deleteInventoryItem(item.inventory_id)
      fetchData()
    } catch (err) {
      setError(err?.response?.data?.error || 'Delete failed')
    }
  }

  const handleExport = () => {
    fetchAllInventoryForExport()
      .then(data => exportToCsv('inventory-export.csv', data, INVENTORY_CSV_COLUMNS))
      .catch((err) => setError(err?.response?.data?.error || 'Failed to export inventory data'))
  }

  const handleSaveShoe = async (e) => {
    e.preventDefault()
    setShoeSaving(true)
    setShoeSaveError(null)
    try {
      const payload = {
        sku: shoeForm.sku.trim(),
        name: shoeForm.name.trim(),
        brand: shoeForm.brand.trim(),
      }
      if (!payload.sku || !payload.name) {
        throw new Error('SKU and Shoe Name are required.')
      }

      await ensureShoe(payload)
      setShoeModalOpen(false)
      fetchData()
    } catch (err) {
      setShoeSaveError(err?.message || err?.response?.data?.error || 'Could not save shoe')
    } finally {
      setShoeSaving(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <TopBar title="Inventory" onRefresh={fetchData} loading={loading} />

      <div className="flex-1 p-4 space-y-6 sm:p-6">
        <div className="flex gap-2">
          <button
            onClick={() => { setActiveView('inventory'); setError(null) }}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${activeView === 'inventory' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
          >
            Inventory
          </button>
          <button
            onClick={() => { setActiveView('shoes'); setError(null) }}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${activeView === 'shoes' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
          >
            Shoes
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {activeView === 'inventory' ? (
            <>
              <KPICard label="Total Items" value={items.length} />
              <KPICard label="Available" value={items.filter(i => i.status === 'Available').length} valueClassName="text-green-600" />
              <KPICard label="Sold" value={items.filter(i => i.status === 'Sold').length} valueClassName="text-blue-600" />
              <KPICard label="Consigned" value={items.filter(i => i.status === 'Consigned').length} valueClassName="text-yellow-600" />
              <KPICard label="Total Cost Value" value={formatPHP(totalValue)} />
            </>
          ) : (
            <div className="col-span-full rounded-xl border border-gray-100 bg-white p-5 h-80">
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Shoes by Brand</h2>
              {shoeBrandData.length === 0 ? (
                <EmptyState title="No shoes" message="No shoes match this filter yet." />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={shoeBrandData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      innerRadius={45}
                      paddingAngle={2}
                    >
                      {shoeBrandData.map((entry, index) => (
                        <Cell
                          key={`shoe-brand-${entry.name}-${index}`}
                          fill={BRAND_COLORS[entry.name] || SHOE_CHART_FALLBACK[index % SHOE_CHART_FALLBACK.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <input type="text" placeholder="Search name or SKU…" value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 sm:w-auto" />
          {activeView === 'inventory' ? (
            <>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 sm:w-auto">
                <option value="">All Statuses</option>
                {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={handleExport}
                className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors sm:w-auto">
                Export CSV
              </button>
            </>
          ) : (
            <select value={shoeBrandFilter} onChange={e => setShoeBrandFilter(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 sm:w-auto">
              <option value="">All Brands</option>
              {ALL_BRANDS.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
            </select>
          )}
          <button onClick={activeView === 'shoes' ? openAddShoe : openAdd}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors sm:ml-auto sm:w-auto">
            {activeView === 'shoes' ? '+ Add Shoe' : '+ Add Item'}
          </button>
        </div>

        <div className="rounded-xl shadow-sm border border-gray-100 bg-white overflow-hidden">
          {loading ? <LoadingSpinner className="py-12" />
          : error ? <p className="p-6 text-sm text-red-500">{error}</p>
          : activeView === 'inventory'
          ? (!items.length ? <EmptyState title="No inventory items" message="Try adjusting your filters." />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['SKU','Shoe Name','Size','Status','Purchase Cost','Listed Price','Date Purchased','Source','Linked Sale',''].map(col => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((item, idx) => {
                    const aging = item.status === 'Available' && isOldItem(item.date_purchased)
                    return (
                      <tr key={item.inventory_id || idx} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">{item.sku || '—'}</td>
                        <td className="px-4 py-3 max-w-xs">
                          <span className="font-medium text-gray-900 truncate block">{item.shoe_name || '—'}</span>
                          {aging && (
                            <span className="text-xs text-orange-600 font-medium">
                              Aging ({Math.floor((Date.now() - new Date(item.date_purchased).getTime()) / 86400000)}d)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500">{item.size || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[item.status] || 'bg-gray-100 text-gray-600'}`}>
                            {item.status || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{item.purchase_cost != null ? formatPHP(item.purchase_cost) : '—'}</td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{item.listed_price != null ? formatUSD(item.listed_price) : '—'}</td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(item.date_purchased)}</td>
                        <td className="px-4 py-3 text-gray-500">{item.source || '—'}</td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">{item.linked_sale_id || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <button onClick={() => openEdit(item)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Edit</button>
                            <button onClick={() => handleDelete(item)} className="text-xs text-red-600 hover:text-red-800 font-medium">Delete</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))
          : (!shoes.length ? <EmptyState title="No shoes" message="Try adjusting your filters." />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['SKU', 'Brand', 'Shoe Name'].map(col => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {shoes.map((shoe, idx) => (
                    <tr key={shoe.shoe_id || idx} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">{shoe.sku || '—'}</td>
                      <td className="px-4 py-3 text-gray-700">{shoe.brand || '—'}</td>
                      <td className="px-4 py-3 text-gray-900 max-w-xs">{shoe.name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>

      {modalOpen && (
        <Modal title={editing ? `Edit — ${editing.shoe_name}` : 'Add Inventory Item'} onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSave} className="space-y-4">
            <Field label="Shoe Name">
              <input type="text" required value={form.shoe_name} onChange={setField('shoe_name')} className={INPUT} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Brand">
                <input type="text" value={form.brand} onChange={setField('brand')} className={INPUT} />
              </Field>
              <Field label="SKU">
                <input
                  type="text"
                  required
                  value={form.sku}
                  onChange={setField('sku')}
                   onBlur={async () => {
                     const sku = String(form.sku || '').trim()
                     if (!sku) return
                     try {
                       const shoe = await getShoeBySku(sku)
                      setForm((prev) => ({
                        ...prev,
                        shoe_name: prev.shoe_name || shoe.name || prev.shoe_name,
                        brand: prev.brand || shoe.brand || prev.brand || '',
                      }))
                     } catch {
                       // no-op: allow adding new model without existing shoe row
                     }
                     await autofillPurchaseCostFromSku(sku)
                    }}
                    className={INPUT}
                  />
              </Field>
              {!editing ? (
                <Field label="Bulk add sizes">
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={bulkMode}
                      onChange={(e) => setBulkMode(e.target.checked)}
                    />
                    Add multiple sizes in one go
                  </label>
                </Field>
              ) : (
                <Field label="Size">
                  <input type="number" step="0.5" required value={form.size} onChange={setField('size')} className={INPUT} />
                </Field>
              )}
              {!editing && !bulkMode ? (
                <Field label="Size">
                  <input type="number" step="0.5" required value={form.size} onChange={setField('size')} className={INPUT} />
                </Field>
              ) : null}
            </div>

            {!editing && bulkMode && (
              <div className="space-y-3 border border-gray-100 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-600">Size / Quantity Rows</p>
                  <button type="button" onClick={addBulkItem} className="text-xs text-indigo-700 hover:text-indigo-900 font-medium">
                    + Add row
                  </button>
                </div>
                {bulkItems.map((row, idx) => (
                  <div key={`${idx}-${row.size}-${row.quantity}`} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label={`Size #${idx + 1}`}>
                      <input
                        type="number"
                        step="0.5"
                        required
                        value={row.size}
                        onChange={setBulkField(idx, 'size')}
                        className={INPUT}
                      />
                    </Field>
                    <Field label="Quantity">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        required
                        value={row.quantity}
                        onChange={setBulkField(idx, 'quantity')}
                        className={INPUT}
                      />
                    </Field>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => removeBulkItem(idx)}
                        className="mb-2 rounded-lg border border-red-200 text-red-700 px-3 py-2 text-xs hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Purchase Cost (PHP)">
                <input type="number" step="0.01" required value={form.purchase_cost} onChange={setField('purchase_cost')} className={INPUT} />
              </Field>
              <Field label="Listed Price (USD)">
                <input type="number" step="0.01" value={form.listed_price} onChange={setField('listed_price')} className={INPUT} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Date Purchased">
                <input type="datetime-local" required value={form.date_purchased} onChange={setField('date_purchased')} className={INPUT} />
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={setField('status')} className={INPUT}>
                  {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Source">
              <input type="text" value={form.source} onChange={setField('source')} placeholder="e.g. Shopee, Nike PH" className={INPUT} />
            </Field>
            <Field label="Notes">
              <textarea rows={2} value={form.notes} onChange={setField('notes')} className={INPUT} />
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

      {shoeModalOpen && (
        <Modal title="Add Shoe" onClose={() => setShoeModalOpen(false)}>
          <form onSubmit={handleSaveShoe} className="space-y-4">
            <Field label="Shoe Name">
              <input
                type="text"
                required
                value={shoeForm.name}
                onChange={setShoeField('name')}
                className={INPUT}
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Brand">
                <select value={shoeForm.brand} onChange={setShoeField('brand')} className={INPUT}>
                  <option value="">Auto-detect / Other</option>
                  {ALL_BRANDS.map(brand => <option key={brand} value={brand}>{brand}</option>)}
                </select>
              </Field>
              <Field label="SKU">
                <input
                  type="text"
                  required
                  value={shoeForm.sku}
                  onChange={setShoeField('sku')}
                  className={INPUT}
                />
              </Field>
            </div>
            {shoeSaveError && <p className="text-sm text-red-500">{shoeSaveError}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShoeModalOpen(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={shoeSaving}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                {shoeSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

