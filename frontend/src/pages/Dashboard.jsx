import { useState, useEffect, useCallback } from 'react'
import TopBar from '../components/layout/TopBar'
import KPICard from '../components/common/KPICard'
import LoadingSpinner from '../components/common/LoadingSpinner'
import ActionItems from '../components/dashboard/ActionItems'
import RecentActivity from '../components/dashboard/RecentActivity'
import SalesByStatus from '../components/dashboard/SalesByStatus'
import ProfitOverTime from '../components/dashboard/ProfitOverTime'
import { getDashboardSummary, getDashboardAlerts, getSales, getEmailLog } from '../services/api'
import { usePhpEstimateRate, formatPhpRate } from '../utils/exchangeRate'

function formatPHP(value) {
  const num = parseFloat(value) || 0
  return `₱${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function Dashboard() {
  const [summary, setSummary] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [sales, setSales] = useState([])
  const [emailLog, setEmailLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [summaryError, setSummaryError] = useState(null)
  const [alertsError, setAlertsError] = useState(null)
  const [emailError, setEmailError] = useState(null)
  const phpRate = usePhpEstimateRate()

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setSummaryError(null)
    setAlertsError(null)
    setEmailError(null)

    await Promise.allSettled([
      getDashboardSummary()
        .then(data => setSummary(data))
        .catch(err => setSummaryError(err?.response?.data?.error || 'Failed to load summary')),

      getDashboardAlerts()
        .then(data => setAlerts(Array.isArray(data) ? data : data.alerts || []))
        .catch(err => setAlertsError(err?.response?.data?.error || 'Failed to load alerts')),

      getSales({ per_page: 200 })
        .then(data => setSales(Array.isArray(data) ? data : data.sales || data.items || []))
        .catch(() => setSales([])),

      getEmailLog({ per_page: 15 })
        .then(data => setEmailLog(Array.isArray(data) ? data : data.logs || data.items || []))
        .catch(err => setEmailError(err?.response?.data?.error || 'Failed to load activity')),
    ])

    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const netProfitValue = summary
    ? (parseFloat(summary.net_profit_php) || 0)
    : null

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <TopBar title="Dashboard" onRefresh={fetchAll} loading={loading} />

      <div className="flex-1 space-y-6 p-4 sm:p-6">
        {/* KPI Row */}
        {loading && !summary ? (
          <LoadingSpinner className="py-8" />
        ) : summaryError ? (
          <p className="text-sm text-red-500">{summaryError}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <KPICard
              label="Total Revenue"
              value={summary ? formatPHP(summary.total_revenue_php) : '—'}
            />
            <KPICard
              label="Total Expenses"
              value={summary ? formatPHP(summary.total_expenses_php) : '—'}
            />
            <KPICard
              label="Net Profit"
              value={summary ? formatPHP(summary.net_profit_php) : '—'}
              valueClassName={
                netProfitValue === null
                  ? ''
                  : netProfitValue >= 0
                  ? 'text-green-600'
                  : 'text-red-600'
              }
            />
            <KPICard
              label="Active Inventory"
              value={summary ? (summary.active_inventory_count ?? '—') : '—'}
              subtitle="items"
            />
            <KPICard
              label="Inventory Value"
              value={summary ? formatPHP(summary.active_inventory_value_php ?? 0) : '—'}
            />
            <KPICard
              label="USD→PHP (est.)"
              value={formatPhpRate(phpRate)}
            />
          </div>
        )}

        {/* Charts + Alerts Row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl shadow-sm border border-gray-100 bg-white p-5">
            <h2 className="mb-4 text-sm font-semibold text-gray-700">Sales by Status</h2>
            <SalesByStatus sales={sales} loading={loading} />
          </div>
          <div className="rounded-xl shadow-sm border border-gray-100 bg-white p-5">
            <h2 className="mb-4 text-sm font-semibold text-gray-700">Action Items</h2>
            <ActionItems alerts={alerts} loading={loading} error={alertsError} />
          </div>
        </div>

        {/* Profit Over Time placeholder */}
        <div className="rounded-xl shadow-sm border border-gray-100 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">Profit Over Time</h2>
          <ProfitOverTime />
        </div>

        {/* Recent Activity */}
        <div className="rounded-xl shadow-sm border border-gray-100 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">Recent Email Activity</h2>
          <RecentActivity entries={emailLog} loading={loading} error={emailError} />
        </div>
      </div>
    </div>
  )
}
