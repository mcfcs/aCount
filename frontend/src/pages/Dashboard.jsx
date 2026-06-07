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

function formatPHPCompact(value) {
  const num = parseFloat(value) || 0
  const abs = Math.abs(num)
  const sign = num < 0 ? '−' : ''
  if (abs >= 1_000_000) return `${sign}₱${(abs / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 })}M`
  if (abs >= 10_000) return `${sign}₱${(abs / 1_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}K`
  return `${sign}₱${abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

// Section frame with an editorial index marker + condensed display heading.
function Panel({ index, title, action, children, className = '' }) {
  return (
    <section className={`ledger-card overflow-hidden ${className}`}>
      <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs font-semibold tabular-nums text-indigo-600">{index}</span>
          <h2 className="font-display text-lg uppercase tracking-wide text-gray-900">{title}</h2>
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
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
        .catch(err => setAlertsError(
          err?.response?.data?.error || err?.response?.data?.message || 'Failed to load alerts'
        )),

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

  const netProfitValue = summary ? (parseFloat(summary.net_profit_php) || 0) : null
  const revenue = summary ? (parseFloat(summary.total_revenue_php) || 0) : 0
  const expenses = summary ? (parseFloat(summary.total_expenses_php) || 0) : 0
  const margin = revenue > 0 ? (netProfitValue ?? 0) / revenue * 100 : null
  const isPositive = netProfitValue == null ? true : netProfitValue >= 0
  const revShare = (revenue + expenses) > 0 ? Math.round((revenue / (revenue + expenses)) * 100) : 0

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <TopBar title="Dashboard" onRefresh={fetchAll} loading={loading} />

      <div className="flex-1 space-y-5 p-4 sm:p-6">
        {/* ── HERO: NET PROFIT ─────────────────────────────────────────── */}
        {loading && !summary ? (
          <div className="ledger-card py-16">
            <LoadingSpinner size="lg" />
          </div>
        ) : summaryError ? (
          <div className="ledger-card p-6">
            <p className="text-sm text-red-500">{summaryError}</p>
          </div>
        ) : (
          <section className="ledger-card scanlines relative grid animate-rise grid-cols-1 gap-6 overflow-hidden p-6 sm:p-8 lg:grid-cols-[1.6fr_1fr]">
            {/* corner volt bracket */}
            <span className="pointer-events-none absolute right-0 top-0 h-24 w-24 bg-indigo-600/10 blur-3xl" />

            {/* Net profit figure */}
            <div className="relative">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <p className="kicker">Net Profit&nbsp;·&nbsp;All Time</p>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${
                    isPositive
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                      : 'border-red-200 bg-red-50 text-red-600'
                  }`}
                >
                  <span>{isPositive ? '▲' : '▼'}</span>
                  {margin != null ? `${margin >= 0 ? '+' : ''}${margin.toFixed(1)}% margin` : 'no revenue yet'}
                </span>
              </div>

              <p
                className={`mt-3 font-mono text-5xl font-extrabold leading-none tracking-tighter tabular-nums sm:text-6xl lg:text-7xl ${
                  isPositive ? 'text-gray-900' : 'text-red-500'
                }`}
              >
                {summary ? formatPHP(summary.net_profit_php) : '—'}
              </p>
              <span
                className="mt-4 block h-1 w-28 rounded-full bg-indigo-600"
                style={{ boxShadow: '0 0 16px -2px rgba(212,255,63,0.6)' }}
              />

              {/* Revenue vs Expenses split bar */}
              <div className="mt-7 max-w-md">
                <div className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-wider">
                  <span className="text-emerald-600">Revenue {formatPHPCompact(revenue)}</span>
                  <span className="text-red-500">Expenses {formatPHPCompact(expenses)}</span>
                </div>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full bg-emerald-600 transition-all duration-700" style={{ width: `${revShare}%` }} />
                  <div className="h-full bg-red-500 transition-all duration-700" style={{ width: `${100 - revShare}%` }} />
                </div>
              </div>
            </div>

            {/* Side metrics rail */}
            <div className="relative grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-gray-100 bg-gray-100 lg:grid-cols-1">
              {[
                { label: 'Active Inventory', value: summary ? (summary.active_inventory_count ?? '—') : '—', tint: 'text-gray-900' },
                { label: 'Inventory Value', value: summary ? formatPHPCompact(summary.active_inventory_value_php ?? 0) : '—', tint: 'text-gray-900' },
                { label: 'USD → PHP (est.)', value: formatPhpRate(phpRate), tint: 'text-indigo-600' },
              ].map((m) => (
                <div key={m.label} className="bg-white px-5 py-4">
                  <p className="kicker">{m.label}</p>
                  <p className={`mt-1.5 font-mono text-xl font-bold tabular-nums ${m.tint}`}>{m.value}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── KPI TICKER ───────────────────────────────────────────────── */}
        {!summaryError && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KPICard label="Total Revenue" value={summary ? formatPHP(summary.total_revenue_php) : '—'} valueClassName="text-emerald-600" />
            <KPICard label="Total Expenses" value={summary ? formatPHP(summary.total_expenses_php) : '—'} valueClassName="text-red-500" />
            <KPICard label="Net Profit" value={summary ? formatPHP(summary.net_profit_php) : '—'}
              valueClassName={netProfitValue === null ? '' : netProfitValue >= 0 ? 'text-emerald-600' : 'text-red-500'} />
            <KPICard label="Active Inventory" value={summary ? (summary.active_inventory_count ?? '—') : '—'} subtitle="items in stock" />
          </div>
        )}

        {/* ── CHARTS + ALERTS ──────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Panel index="01" title="Sales by Status">
            <SalesByStatus sales={sales} loading={loading} />
          </Panel>
          <Panel index="02" title="Action Items">
            <ActionItems alerts={alerts} loading={loading} error={alertsError} />
          </Panel>
        </div>

        {/* ── PROFIT OVER TIME ─────────────────────────────────────────── */}
        <Panel index="03" title="Profit Over Time">
          <ProfitOverTime />
        </Panel>

        {/* ── RECENT ACTIVITY ──────────────────────────────────────────── */}
        <Panel index="04" title="Recent Email Activity">
          <RecentActivity entries={emailLog} loading={loading} error={emailError} />
        </Panel>
      </div>
    </div>
  )
}
