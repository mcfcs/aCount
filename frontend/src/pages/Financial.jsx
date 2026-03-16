import { useState, useEffect, useCallback } from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import TopBar from '../components/layout/TopBar'
import KPICard from '../components/common/KPICard'
import LoadingSpinner from '../components/common/LoadingSpinner'
import EmptyState from '../components/common/EmptyState'
import { getBankTransfers, getBankTransfersSummary, getExpenses, getExpensesSummary, getSubscriptions } from '../services/api'

function formatPHP(value) {
  const num = parseFloat(value) || 0
  return `₱${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  try { return new Date(dateStr).toLocaleDateString('en-PH') } catch { return dateStr }
}

// ─── Bank Transfers ──────────────────────────────────────────────────────────

const TRANSFER_STATUS_STYLES = {
  Reconciled:           'bg-green-100 text-green-700',
  'Partially Reconciled': 'bg-yellow-100 text-yellow-700',
  Unreconciled:         'bg-red-100 text-red-700',
}

function BankTransfersTab() {
  const [transfers, setTransfers] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [tData, sData] = await Promise.all([
        getBankTransfers(),
        getBankTransfersSummary(),
      ])
      setTransfers(Array.isArray(tData) ? tData : tData.transfers || tData.items || [])
      setSummary(sData)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load bank transfers')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <LoadingSpinner className="py-12" />
  if (error) return <p className="py-6 text-sm text-red-500">{error}</p>

  const totalReceived = summary?.total_php
    ?? transfers.reduce((s, t) => s + (parseFloat(t.amount_php || 0)), 0)

  const reconciledCount = summary?.by_reconciliation_status?.Reconciled?.count
    ?? transfers.filter(t => t.reconciliation_status === 'Reconciled').length

  const unreconciledCount = summary?.by_reconciliation_status?.Unreconciled?.count
    ?? transfers.filter(t => t.reconciliation_status === 'Unreconciled').length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <KPICard label="Total Received" value={formatPHP(totalReceived)} />
        <KPICard label="Reconciled" value={reconciledCount} valueClassName="text-green-600" />
        <KPICard label="Unreconciled" value={unreconciledCount} valueClassName="text-red-600" />
      </div>

      <div className="rounded-xl shadow-sm border border-gray-100 bg-white overflow-hidden">
        {!transfers.length ? (
          <EmptyState title="No bank transfers" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Transfer Date', 'Bank', 'Account Last 4', 'Amount (PHP)', 'Status'].map(col => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {transfers.map((t, idx) => (
                  <tr key={t.id || idx} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {formatDate(t.transfer_date || t.date)}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{t.bank || t.bank_name || '—'}</td>
                    <td className="px-4 py-3 font-mono text-gray-600">
                      {t.account_last4 || t.last_4 || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {formatPHP(t.amount_php || t.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TRANSFER_STATUS_STYLES[t.reconciliation_status] || 'bg-gray-100 text-gray-600'}`}>
                        {t.reconciliation_status || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

const EXPENSE_COLORS = [
  '#6366f1', '#22c55e', '#3b82f6', '#f59e0b',
  '#ef4444', '#a855f7', '#14b8a6', '#f97316', '#64748b',
]

function CustomExpenseTooltip({ active, payload }) {
  if (active && payload && payload.length) {
    const { name, value } = payload[0]
    return (
      <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-md text-sm">
        <p className="font-medium text-gray-800">{name}</p>
        <p className="text-gray-500">{`₱${parseFloat(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</p>
      </div>
    )
  }
  return null
}

function ExpensesTab() {
  const [expenses, setExpenses] = useState([])
  const [categoryData, setCategoryData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [eData, sData] = await Promise.all([
        getExpenses(),
        getExpensesSummary(),
      ])
      const arr = Array.isArray(eData) ? eData : eData.expenses || eData.items || []
      setExpenses(arr)

      // Summary can be an array of {category, total} or an object {by_category: {}}
      if (Array.isArray(sData)) {
        setCategoryData(sData.map(d => ({ name: d.category, value: parseFloat(d.total || d.amount || 0) })))
      } else if (sData?.by_category) {
        setCategoryData(Object.entries(sData.by_category).map(([name, value]) => ({ name, value: parseFloat(value) })))
      } else {
        // Derive from expenses list
        const cats = {}
        for (const e of arr) {
          const cat = e.category || 'Other'
          cats[cat] = (cats[cat] || 0) + parseFloat(e.amount_php || e.amount || 0)
        }
        setCategoryData(Object.entries(cats).map(([name, value]) => ({ name, value })))
      }
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load expenses')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <LoadingSpinner className="py-12" />
  if (error) return <p className="py-6 text-sm text-red-500">{error}</p>

  return (
    <div className="space-y-6">
      {/* Pie chart */}
      {categoryData.length > 0 ? (
        <div className="rounded-xl shadow-sm border border-gray-100 bg-white p-5">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">Expenses by Category</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={categoryData}
                cx="50%"
                cy="50%"
                innerRadius={70}
                outerRadius={110}
                paddingAngle={2}
                dataKey="value"
              >
                {categoryData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={EXPENSE_COLORS[index % EXPENSE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomExpenseTooltip />} />
              <Legend
                iconType="circle"
                iconSize={8}
                formatter={(value) => <span className="text-xs text-gray-600">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {/* Expenses table */}
      <div className="rounded-xl shadow-sm border border-gray-100 bg-white overflow-hidden">
        {!expenses.length ? (
          <EmptyState title="No expenses recorded" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Date', 'Category', 'Description', 'Amount (PHP)', 'Source'].map(col => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {expenses.map((e, idx) => (
                  <tr key={e.id || idx} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {formatDate(e.date || e.expense_date)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                        {e.category || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-xs truncate">
                      {e.description || e.notes || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {formatPHP(e.amount_php || e.amount)}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{e.source || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

const SUB_STATUS_STYLES = {
  active:   'bg-green-100 text-green-700',
  inactive: 'bg-gray-100 text-gray-500',
  paused:   'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-red-100 text-red-700',
}

function SubscriptionsTab() {
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getSubscriptions()
      setSubs(Array.isArray(data) ? data : data.subscriptions || data.items || [])
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load subscriptions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <LoadingSpinner className="py-12" />
  if (error) return <p className="py-6 text-sm text-red-500">{error}</p>
  if (!subs.length) return <EmptyState title="No subscriptions" message="No active subscriptions found." />

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {subs.map((sub, idx) => (
        <div key={sub.id || idx} className="rounded-xl shadow-sm border border-gray-100 bg-white p-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-gray-900">{sub.name || sub.service_name || `Subscription #${idx + 1}`}</p>
              <p className="mt-1 text-2xl font-bold text-gray-800">{formatPHP(sub.amount_php || sub.amount)}</p>
            </div>
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${SUB_STATUS_STYLES[sub.status?.toLowerCase()] || 'bg-gray-100 text-gray-600'}`}>
              {sub.status || 'Unknown'}
            </span>
          </div>
          <div className="mt-3 space-y-1 text-sm text-gray-500">
            <p>Billing: <span className="text-gray-700 capitalize">{sub.billing_cycle || sub.frequency || '—'}</span></p>
            <p>Next billing: <span className="text-gray-700">{formatDate(sub.next_billing_date || sub.next_billing)}</span></p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Financial Page ───────────────────────────────────────────────────────────

const TABS = ['Bank Transfers', 'Expenses', 'Subscriptions']

export default function Financial() {
  const [activeTab, setActiveTab] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)

  const handleRefresh = () => setRefreshKey(k => k + 1)

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <TopBar title="Financial" onRefresh={handleRefresh} />

      <div className="flex-1 p-6 space-y-6">
        {/* Tab nav */}
        <div className="flex border-b border-gray-200">
          {TABS.map((tab, idx) => (
            <button
              key={tab}
              onClick={() => setActiveTab(idx)}
              className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === idx
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content — key forces remount on refresh */}
        {activeTab === 0 && <BankTransfersTab key={`bt-${refreshKey}`} />}
        {activeTab === 1 && <ExpensesTab key={`exp-${refreshKey}`} />}
        {activeTab === 2 && <SubscriptionsTab key={`sub-${refreshKey}`} />}
      </div>
    </div>
  )
}
