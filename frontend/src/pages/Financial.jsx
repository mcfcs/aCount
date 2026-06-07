import { useState, useEffect, useCallback } from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import TopBar from '../components/layout/TopBar'
import KPICard from '../components/common/KPICard'
import LoadingSpinner from '../components/common/LoadingSpinner'
import EmptyState from '../components/common/EmptyState'
import Modal from '../components/common/Modal'
import { exportToCsv } from '../utils/csv'
import { usePhpEstimateRate, formatPhpRate } from '../utils/exchangeRate'
import {
  getBankTransfers, getBankTransfersSummary, createBankTransfer, updateBankTransfer,
  getExpenses, getExpensesSummary, createExpense, updateExpense, deleteExpense, deleteBankTransfer,
  getSubscriptions, createSubscription, updateSubscription, deleteSubscription,
} from '../services/api'

function formatPHP(value) {
  const num = parseFloat(value) || 0
  return `₱${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function formatDate(dateStr) {
  if (!dateStr) return '—'
  try { return new Date(dateStr).toLocaleDateString('en-PH') } catch { return dateStr }
}
function toDatetimeLocal(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  } catch { return '' }
}
function toDateInput(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  } catch { return '' }
}

const INPUT = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400'
const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
    {children}
  </div>
)

// ─── Bank Transfers ───────────────────────────────────────────────────────────

const TRANSFER_STATUS_STYLES = {
  Reconciled:   'bg-green-100 text-green-700',
  Unreconciled: 'bg-red-100 text-red-700',
  'Partially Reconciled': 'bg-yellow-100 text-yellow-700',
}

const EMPTY_TRANSFER = { amount_php: '', bank_name: '', account_last4: '', transfer_date: '', reconciliation_status: 'Unreconciled' }
const BANK_TRANSFER_CSV_COLUMNS = [
  { key: 'transfer_date', label: 'Transfer Date' },
  { key: 'bank_name', label: 'Bank' },
  { key: 'account_last4', label: 'Account Last 4' },
  { key: 'amount_php', label: 'Amount (PHP)' },
  { key: 'reconciliation_status', label: 'Reconciliation Status' },
]

function BankTransfersTab() {
  const [transfers, setTransfers] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_TRANSFER)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const phpRate = usePhpEstimateRate()

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [tData, sData] = await Promise.all([getBankTransfers(), getBankTransfersSummary()])
      setTransfers(Array.isArray(tData) ? tData : tData.transfers || tData.items || [])
      setSummary(sData)
    } catch (err) { setError(err?.response?.data?.error || 'Failed to load bank transfers') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const fetchAllTransfersForExport = useCallback(async () => {
    let pageNum = 1
    const allItems = []
    const perPage = 100
    while (true) {
      const tData = await getBankTransfers({ page: pageNum, per_page: perPage })
      const items = Array.isArray(tData) ? tData : tData.transfers || tData.items || []
      const totalPages = tData.pages || Math.ceil((tData.total || 0) / perPage)
      allItems.push(...items)
      if (tData.pages != null) {
        if (pageNum >= totalPages) break
      } else if (items.length < perPage) {
        break
      } else if (tData.total && allItems.length >= tData.total) {
        break
      }
      pageNum += 1
    }
    return allItems
  }, [])

  const handleDelete = async (transfer) => {
    if (!window.confirm(`Delete transfer of ${formatPHP(transfer.amount_php)} on ${formatDate(transfer.transfer_date)}? This action cannot be undone.`)) return
    try {
      await deleteBankTransfer(transfer.transfer_id)
      fetchData()
    } catch (err) {
      setError(err?.response?.data?.error || 'Delete failed')
    }
  }

  const handleExport = () => {
    fetchAllTransfersForExport()
      .then((data) => exportToCsv('bank-transfers-export.csv', data, BANK_TRANSFER_CSV_COLUMNS))
      .catch((err) => setError(err?.response?.data?.error || 'Failed to export bank transfers'))
  }

  const set = (f) => (e) => setForm(prev => ({ ...prev, [f]: e.target.value }))

  const openAdd = () => {
    setEditing(null)
    setForm({ ...EMPTY_TRANSFER, transfer_date: toDatetimeLocal(new Date().toISOString()) })
    setSaveError(null); setModalOpen(true)
  }
  const openEdit = (t) => {
    setEditing(t)
    setForm({
      amount_php: t.amount_php ?? '',
      bank_name: t.bank_name ?? '',
      account_last4: t.account_last4 ?? '',
      transfer_date: toDatetimeLocal(t.transfer_date),
      reconciliation_status: t.reconciliation_status ?? 'Unreconciled',
    })
    setSaveError(null); setModalOpen(true)
  }

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true); setSaveError(null)
    try {
      const payload = { ...form, amount_php: Number(form.amount_php) }
      editing ? await updateBankTransfer(editing.transfer_id, payload) : await createBankTransfer(payload)
      setModalOpen(false); fetchData()
    } catch (err) { setSaveError(err?.response?.data?.error || 'Save failed') }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner className="py-12" />
  if (error) return <p className="py-6 text-sm text-red-500">{error}</p>

  const totalReceived = summary?.total_php ?? transfers.reduce((s, t) => s + parseFloat(t.amount_php || 0), 0)

  return (
      <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KPICard label="Total Received" value={formatPHP(totalReceived)} />
        <KPICard label="Reconciled" value={transfers.filter(t => t.reconciliation_status === 'Reconciled').length} valueClassName="text-green-600" />
        <KPICard label="Unreconciled" value={transfers.filter(t => t.reconciliation_status === 'Unreconciled').length} valueClassName="text-red-600" />
        <KPICard label="USD→PHP (est.)" value={formatPhpRate(phpRate)} />
      </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button onClick={handleExport} className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors sm:w-auto">
            Export CSV
          </button>
          <button onClick={openAdd} className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors sm:w-auto">
            + Add Transfer
          </button>
        </div>

      <div className="rounded-xl shadow-sm border border-gray-100 bg-white overflow-hidden">
        {!transfers.length ? <EmptyState title="No bank transfers" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Transfer Date','Bank','Account Last 4','Amount (PHP)','Status',''].map(col => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {transfers.map((t, idx) => (
                  <tr key={t.transfer_id || idx} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(t.transfer_date)}</td>
                    <td className="px-4 py-3 text-gray-700">{t.bank_name || '—'}</td>
                    <td className="px-4 py-3 font-mono text-gray-600">{t.account_last4 || '—'}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatPHP(t.amount_php)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TRANSFER_STATUS_STYLES[t.reconciliation_status] || 'bg-gray-100 text-gray-600'}`}>
                        {t.reconciliation_status || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button onClick={() => openEdit(t)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Edit</button>
                        <button onClick={() => handleDelete(t)} className="text-xs text-red-600 hover:text-red-800 font-medium">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <Modal title={editing ? 'Edit Bank Transfer' : 'Add Bank Transfer'} onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Amount (PHP)">
                <input type="number" step="0.01" required value={form.amount_php} onChange={set('amount_php')} className={INPUT} />
              </Field>
              <Field label="Transfer Date">
                <input type="datetime-local" required value={form.transfer_date} onChange={set('transfer_date')} className={INPUT} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Bank Name">
                <input type="text" value={form.bank_name} onChange={set('bank_name')} className={INPUT} />
              </Field>
              <Field label="Account Last 4">
                <input type="text" maxLength={4} value={form.account_last4} onChange={set('account_last4')} className={INPUT} />
              </Field>
            </div>
            <Field label="Reconciliation Status">
              <select value={form.reconciliation_status} onChange={set('reconciliation_status')} className={INPUT}>
                <option>Unreconciled</option>
                <option>Reconciled</option>
                <option>Partially Reconciled</option>
              </select>
            </Field>
            {saveError && <p className="text-sm text-red-500">{saveError}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

const EXPENSE_COLORS = ['#6366f1','#22c55e','#3b82f6','#f59e0b','#ef4444','#a855f7','#14b8a6','#f97316','#64748b']
const EXPENSE_CATEGORIES = ['Platform Fee','Shipping','Storage','Supplies','Subscription','Other']
const EXPENSE_CSV_COLUMNS = [
  { key: 'expense_date', label: 'Expense Date' },
  { key: 'category', label: 'Category' },
  { key: 'description', label: 'Description' },
  { key: 'amount_php', label: 'Amount (PHP)' },
  { key: 'source', label: 'Source' },
  { key: 'linked_sale_id', label: 'Linked Sale ID' },
]

const EMPTY_EXPENSE = { category: 'Platform Fee', description: '', amount_php: '', expense_date: '', source: '' }

function ExpensesTab() {
  const [expenses, setExpenses] = useState([])
  const [categoryData, setCategoryData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_EXPENSE)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [eData, sData] = await Promise.all([getExpenses(), getExpensesSummary()])
      const arr = Array.isArray(eData) ? eData : eData.expenses || eData.items || []
      setExpenses(arr)
      if (sData?.by_category) {
        setCategoryData(Object.entries(sData.by_category).map(([name, value]) => ({ name, value: parseFloat(value) })))
      } else {
        const cats = {}
        for (const e of arr) { const c = e.category || 'Other'; cats[c] = (cats[c] || 0) + parseFloat(e.amount_php || 0) }
        setCategoryData(Object.entries(cats).map(([name, value]) => ({ name, value })))
      }
    } catch (err) { setError(err?.response?.data?.error || 'Failed to load expenses') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const fetchAllExpensesForExport = useCallback(async () => {
    let pageNum = 1
    const allItems = []
    const perPage = 100
    while (true) {
      const eData = await getExpenses({ page: pageNum, per_page: perPage })
      const rows = Array.isArray(eData) ? eData : eData.expenses || eData.items || []
      const totalPages = eData.pages || Math.ceil((eData.total || 0) / perPage)
      allItems.push(...rows)
      if (eData.pages != null) {
        if (pageNum >= totalPages) break
      } else if (rows.length < perPage) {
        break
      } else if (eData.total && allItems.length >= eData.total) {
        break
      }
      pageNum += 1
    }
    return allItems
  }, [])

  const handleDelete = async (expense) => {
    if (!window.confirm(`Delete expense "${expense.description || expense.category}"? This action cannot be undone.`)) return
    try {
      await deleteExpense(expense.expense_id)
      fetchData()
    } catch (err) {
      setError(err?.response?.data?.error || 'Delete failed')
    }
  }

  const handleExport = () => {
    fetchAllExpensesForExport()
      .then((data) => exportToCsv('expenses-export.csv', data, EXPENSE_CSV_COLUMNS))
      .catch((err) => setError(err?.response?.data?.error || 'Failed to export expenses'))
  }

  const set = (f) => (e) => setForm(prev => ({ ...prev, [f]: e.target.value }))

  const openAdd = () => {
    setEditing(null)
    setForm({ ...EMPTY_EXPENSE, expense_date: toDateInput(new Date().toISOString()) })
    setSaveError(null); setModalOpen(true)
  }
  const openEdit = (exp) => {
    setEditing(exp)
    setForm({
      category: exp.category ?? 'Platform Fee',
      description: exp.description ?? '',
      amount_php: exp.amount_php ?? '',
      expense_date: toDateInput(exp.expense_date),
      source: exp.source ?? '',
    })
    setSaveError(null); setModalOpen(true)
  }

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true); setSaveError(null)
    try {
      const payload = { ...form, amount_php: Number(form.amount_php) }
      editing ? await updateExpense(editing.expense_id, payload) : await createExpense(payload)
      setModalOpen(false); fetchData()
    } catch (err) { setSaveError(err?.response?.data?.error || 'Save failed') }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner className="py-12" />
  if (error) return <p className="py-6 text-sm text-red-500">{error}</p>

  return (
    <div className="space-y-6">
      {categoryData.length > 0 && (
        <div className="rounded-xl shadow-sm border border-gray-100 bg-white p-5">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">Expenses by Category</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={categoryData} cx="50%" cy="50%" innerRadius={70} outerRadius={110} paddingAngle={2} dataKey="value">
                {categoryData.map((_, i) => <Cell key={i} fill={EXPENSE_COLORS[i % EXPENSE_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => formatPHP(v)} />
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span className="text-xs text-gray-600">{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button onClick={handleExport} className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors sm:w-auto">
          Export CSV
        </button>
        <button onClick={openAdd} className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors sm:w-auto">
          + Add Expense
        </button>
      </div>

      <div className="rounded-xl shadow-sm border border-gray-100 bg-white overflow-hidden">
        {!expenses.length ? <EmptyState title="No expenses recorded" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Date','Category','Description','Amount (PHP)','Source',''].map(col => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {expenses.map((exp, idx) => (
                  <tr key={exp.expense_id || idx} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(exp.expense_date)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">{exp.category || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-xs truncate">{exp.description || '—'}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatPHP(exp.amount_php)}</td>
                    <td className="px-4 py-3 text-gray-500">{exp.source || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button onClick={() => openEdit(exp)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Edit</button>
                        <button onClick={() => handleDelete(exp)} className="text-xs text-red-600 hover:text-red-800 font-medium">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <Modal title={editing ? 'Edit Expense' : 'Add Expense'} onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Category">
                <select value={form.category} onChange={set('category')} className={INPUT}>
                  {EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Date">
                <input type="date" required value={form.expense_date} onChange={set('expense_date')} className={INPUT} />
              </Field>
            </div>
            <Field label="Description">
              <input type="text" value={form.description} onChange={set('description')} className={INPUT} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Amount (PHP)">
                <input type="number" step="0.01" required value={form.amount_php} onChange={set('amount_php')} className={INPUT} />
              </Field>
              <Field label="Source">
                <input type="text" value={form.source} onChange={set('source')} className={INPUT} />
              </Field>
            </div>
            {saveError && <p className="text-sm text-red-500">{saveError}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ─── Subscriptions ─────────────────────────────────────────────────────────────

const SUB_STATUS_STYLES = {
  active:    'bg-green-100 text-green-700',
  inactive:  'bg-gray-100 text-gray-500',
  paused:    'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-red-100 text-red-700',
}
const SUBSCRIPTION_CSV_COLUMNS = [
  { key: 'service_name', label: 'Service Name' },
  { key: 'amount_php', label: 'Amount (PHP)' },
  { key: 'billing_cycle', label: 'Billing Cycle' },
  { key: 'next_billing_date', label: 'Next Billing Date' },
  { key: 'status', label: 'Status' },
]

const EMPTY_SUB = { service_name: '', amount_php: '', billing_cycle: 'monthly', next_billing_date: '', status: 'active' }

function SubscriptionsTab() {
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_SUB)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const data = await getSubscriptions()
      setSubs(Array.isArray(data) ? data : data.subscriptions || data.items || [])
    } catch (err) { setError(err?.response?.data?.error || 'Failed to load subscriptions') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const fetchAllSubscriptionsForExport = useCallback(async () => {
    let pageNum = 1
    const allItems = []
    const perPage = 100
    while (true) {
      const data = await getSubscriptions({ page: pageNum, per_page: perPage })
      const rows = Array.isArray(data) ? data : data.subscriptions || data.items || []
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
  }, [])

  const handleDelete = async (subscription) => {
    if (!window.confirm(`Delete ${subscription.service_name || subscription.name}? This action cannot be undone.`)) return
    try {
      await deleteSubscription(subscription.subscription_id || subscription.id)
      fetchData()
    } catch (err) {
      setError(err?.response?.data?.error || 'Delete failed')
    }
  }

  const handleExport = () => {
    fetchAllSubscriptionsForExport()
      .then((data) => exportToCsv('subscriptions-export.csv', data, SUBSCRIPTION_CSV_COLUMNS))
      .catch((err) => setError(err?.response?.data?.error || 'Failed to export subscriptions'))
  }

  const set = (f) => (e) => setForm(prev => ({ ...prev, [f]: e.target.value }))

  const openAdd = () => {
    setEditing(null); setForm(EMPTY_SUB); setSaveError(null); setModalOpen(true)
  }
  const openEdit = (sub) => {
    setEditing(sub)
    setForm({
      service_name: sub.service_name ?? sub.name ?? '',
      amount_php: sub.amount_php ?? sub.amount ?? '',
      billing_cycle: sub.billing_cycle ?? sub.frequency ?? 'monthly',
      next_billing_date: toDateInput(sub.next_billing_date ?? sub.next_billing),
      status: sub.status ?? 'active',
    })
    setSaveError(null); setModalOpen(true)
  }

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true); setSaveError(null)
    try {
      const payload = { ...form, amount_php: Number(form.amount_php) }
      editing ? await updateSubscription(editing.subscription_id || editing.id, payload) : await createSubscription(payload)
      setModalOpen(false); fetchData()
    } catch (err) { setSaveError(err?.response?.data?.error || 'Save failed') }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner className="py-12" />
  if (error) return <p className="py-6 text-sm text-red-500">{error}</p>

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button onClick={handleExport} className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors sm:w-auto">
          Export CSV
        </button>
        <button onClick={openAdd} className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors sm:w-auto">
          + Add Subscription
        </button>
      </div>

      {!subs.length ? <EmptyState title="No subscriptions" message="No active subscriptions found." /> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subs.map((sub, idx) => (
            <div key={sub.subscription_id || sub.id || idx} className="rounded-xl shadow-sm border border-gray-100 bg-white p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-gray-900">{sub.service_name || sub.name || `Subscription #${idx+1}`}</p>
                  <p className="mt-1 text-2xl font-bold text-gray-800">{formatPHP(sub.amount_php || sub.amount)}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${SUB_STATUS_STYLES[sub.status?.toLowerCase()] || 'bg-gray-100 text-gray-600'}`}>
                    {sub.status || 'Unknown'}
                  </span>
                  <div className="flex items-center gap-3">
                    <button onClick={() => openEdit(sub)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Edit</button>
                    <button onClick={() => handleDelete(sub)} className="text-xs text-red-600 hover:text-red-800 font-medium">Delete</button>
                  </div>
                </div>
              </div>
              <div className="mt-3 space-y-1 text-sm text-gray-500">
                <p>Billing: <span className="text-gray-700 capitalize">{sub.billing_cycle || sub.frequency || '—'}</span></p>
                <p>Next billing: <span className="text-gray-700">{formatDate(sub.next_billing_date || sub.next_billing)}</span></p>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <Modal title={editing ? `Edit — ${editing.service_name || editing.name}` : 'Add Subscription'} onClose={() => setModalOpen(false)}>
          <form onSubmit={handleSave} className="space-y-4">
            <Field label="Service Name">
              <input type="text" required value={form.service_name} onChange={set('service_name')} className={INPUT} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Amount (PHP)">
                <input type="number" step="0.01" required value={form.amount_php} onChange={set('amount_php')} className={INPUT} />
              </Field>
              <Field label="Billing Cycle">
                <select value={form.billing_cycle} onChange={set('billing_cycle')} className={INPUT}>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Next Billing Date">
                <input type="date" value={form.next_billing_date} onChange={set('next_billing_date')} className={INPUT} />
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={set('status')} className={INPUT}>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="inactive">Inactive</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </Field>
            </div>
            {saveError && <p className="text-sm text-red-500">{saveError}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ─── Financial Page ────────────────────────────────────────────────────────────

const TABS = ['Bank Transfers', 'Expenses', 'Subscriptions']

export default function Financial() {
  const [activeTab, setActiveTab] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <TopBar title="Financial" onRefresh={() => setRefreshKey(k => k+1)} />
      <div className="flex-1 p-4 space-y-6 sm:p-6">
        <div className="flex overflow-x-auto border-b border-gray-200">
          {TABS.map((tab, idx) => (
            <button key={tab} onClick={() => setActiveTab(idx)}
               className={`-mb-px whitespace-nowrap border-b-2 px-5 py-3 text-sm font-semibold uppercase tracking-wide transition-colors ${
                activeTab === idx ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {tab}
            </button>
          ))}
        </div>
        {activeTab === 0 && <BankTransfersTab key={`bt-${refreshKey}`} />}
        {activeTab === 1 && <ExpensesTab key={`exp-${refreshKey}`} />}
        {activeTab === 2 && <SubscriptionsTab key={`sub-${refreshKey}`} />}
      </div>
    </div>
  )
}
