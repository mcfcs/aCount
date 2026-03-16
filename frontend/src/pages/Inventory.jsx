import { useState, useEffect, useCallback } from 'react'
import TopBar from '../components/layout/TopBar'
import KPICard from '../components/common/KPICard'
import LoadingSpinner from '../components/common/LoadingSpinner'
import EmptyState from '../components/common/EmptyState'
import Modal from '../components/common/Modal'
import { getInventory, createInventoryItem, updateInventoryItem, deleteInventoryItem } from '../services/api'

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

const INPUT = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400'
const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
    {children}
  </div>
)

const EMPTY_ITEM = {
  sku: '', shoe_name: '', size: '', status: 'Available',
  purchase_cost: '', listed_price: '', date_purchased: '',
  source: '', notes: '',
}

export default function Inventory() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_ITEM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = {}
      if (statusFilter) params.status = statusFilter
      const data = await getInventory(params)
      setItems(Array.isArray(data) ? data : data.inventory || data.items || [])
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
        return (item.shoe_name || '').toLowerCase().includes(q) || (item.sku || '').toLowerCase().includes(q)
      })
    : items

  const totalValue = items.reduce((sum, i) => sum + parseFloat(i.purchase_cost || 0), 0)

  const openAdd = () => {
    setEditing(null)
    setForm({ ...EMPTY_ITEM, date_purchased: toDatetimeLocal(new Date().toISOString()) })
    setSaveError(null)
    setModalOpen(true)
  }

  const openEdit = (item) => {
    setEditing(item)
    setForm({
      sku: item.sku ?? '',
      shoe_name: item.shoe_name ?? '',
      size: item.size ?? '',
      status: item.status ?? 'Available',
      purchase_cost: item.purchase_cost ?? '',
      listed_price: item.listed_price ?? '',
      date_purchased: toDatetimeLocal(item.date_purchased),
      source: item.source ?? '',
      notes: item.notes ?? '',
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
        size: form.size !== '' ? Number(form.size) : undefined,
        purchase_cost: form.purchase_cost !== '' ? Number(form.purchase_cost) : undefined,
        listed_price: form.listed_price !== '' ? Number(form.listed_price) : undefined,
      }
      if (editing) {
        await updateInventoryItem(editing.inventory_id, payload)
      } else {
        await createInventoryItem(payload)
      }
      setModalOpen(false)
      fetchData()
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

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <TopBar title="Inventory" onRefresh={fetchData} loading={loading} />

      <div className="flex-1 p-6 space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <KPICard label="Total Items" value={items.length} />
          <KPICard label="Available" value={items.filter(i => i.status === 'Available').length} valueClassName="text-green-600" />
          <KPICard label="Sold" value={items.filter(i => i.status === 'Sold').length} valueClassName="text-blue-600" />
          <KPICard label="Consigned" value={items.filter(i => i.status === 'Consigned').length} valueClassName="text-yellow-600" />
          <KPICard label="Total Cost Value" value={formatPHP(totalValue)} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input type="text" placeholder="Search name or SKU…" value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400">
            <option value="">All Statuses</option>
            {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={openAdd}
            className="ml-auto rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors">
            + Add Item
          </button>
        </div>

        <div className="rounded-xl shadow-sm border border-gray-100 bg-white overflow-hidden">
          {loading ? <LoadingSpinner className="py-12" />
          : error ? <p className="p-6 text-sm text-red-500">{error}</p>
          : !filtered.length ? <EmptyState title="No inventory items" message="Try adjusting your filters." />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['SKU','Shoe Name','Size','Status','Purchase Cost','Listed Price','Date Purchased','Source','Linked Sale',''].map(col => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((item, idx) => {
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
                        <button onClick={() => openEdit(item)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Edit</button>
                        <button onClick={() => handleDelete(item)} className="ml-3 text-xs text-red-600 hover:text-red-800 font-medium">Delete</button>
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

      {modalOpen && (
        <Modal title={editing ? `Edit — ${editing.shoe_name}` : 'Add Inventory Item'} onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSave} className="space-y-4">
            <Field label="Shoe Name">
              <input type="text" required value={form.shoe_name} onChange={set('shoe_name')} className={INPUT} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="SKU">
                <input type="text" required value={form.sku} onChange={set('sku')} className={INPUT} />
              </Field>
              <Field label="Size">
                <input type="number" step="0.5" required value={form.size} onChange={set('size')} className={INPUT} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Purchase Cost (PHP)">
                <input type="number" step="0.01" required value={form.purchase_cost} onChange={set('purchase_cost')} className={INPUT} />
              </Field>
              <Field label="Listed Price (USD)">
                <input type="number" step="0.01" value={form.listed_price} onChange={set('listed_price')} className={INPUT} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date Purchased">
                <input type="datetime-local" required value={form.date_purchased} onChange={set('date_purchased')} className={INPUT} />
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={set('status')} className={INPUT}>
                  {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Source">
              <input type="text" value={form.source} onChange={set('source')} placeholder="e.g. Shopee, Nike PH" className={INPUT} />
            </Field>
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
