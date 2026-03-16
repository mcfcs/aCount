import { useState } from 'react'
import TopBar from '../components/layout/TopBar'

import { scrapeEmails, resetDatabase } from '../services/api'
import { readPhpEstimateRate, writePhpEstimateRate } from '../utils/exchangeRate'

const FIELD = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400'

function Card({ title, children }) {
  return (
    <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

function StatusPill({ tone = 'blue', children }) {
  const map = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    red: 'bg-red-50 text-red-700 border-red-200',
  }

  return (
    <div className={`inline-flex rounded-lg border px-3 py-2 text-sm ${map[tone]}`}>
      {children}
    </div>
  )
}

export default function Settings() {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [forceScrape, setForceScrape] = useState(false)
  const [scrapeBusy, setScrapeBusy] = useState(false)
  const [scrapeResult, setScrapeResult] = useState(null)
  const [scrapeError, setScrapeError] = useState('')

  const [confirmText, setConfirmText] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [resetResult, setResetResult] = useState(null)
  const [resetError, setResetError] = useState('')
  const [phpRate, setPhpRate] = useState(() => {
    const saved = readPhpEstimateRate()
    return String(saved)
  })
  const [rateSaved, setRateSaved] = useState(false)

  const canReset = confirmText === 'RESET'

  const refresh = () => {
    setScrapeResult(null)
    setScrapeError('')
    setResetResult(null)
    setResetError('')
  }

  const handleScrape = async (event) => {
    event.preventDefault()
    setScrapeBusy(true)
    setScrapeError('')
    setScrapeResult(null)

    if (!startDate) {
      setScrapeError('Start date is required.')
      setScrapeBusy(false)
      return
    }

    if (endDate && startDate > endDate) {
      setScrapeError('Start date cannot be after end date.')
      setScrapeBusy(false)
      return
    }

    try {
      const payload = { after: startDate, force: forceScrape, async: true }
      if (endDate) payload.before = endDate

      const result = await scrapeEmails(payload)
      if (result?.status === 'started') {
        setScrapeResult({ status: 'started', message: result.message })
      } else {
        setScrapeResult(result)
        setStartDate('')
        setEndDate('')
        setForceScrape(false)
      }
    } catch (err) {
      setScrapeError(err?.response?.data?.error || 'Scrape failed.')
    } finally {
      setScrapeBusy(false)
    }
  }

  const handleReset = async (event) => {
    event.preventDefault()
    if (!canReset) return
    setResetBusy(true)
    setResetError('')
    setResetResult(null)

    try {
      const result = await resetDatabase({ confirm: 'RESET', scope: 'all' })
      setResetResult(result)
      setConfirmText('')
    } catch (err) {
      setResetError(err?.response?.data?.error || 'Database reset failed.')
    } finally {
      setResetBusy(false)
    }
  }

  const saveRate = () => {
    const saved = writePhpEstimateRate(phpRate)
    if (!saved) {
      setRateSaved(false)
      return
    }
    setRateSaved(true)
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <TopBar title="Settings" onRefresh={refresh} />

      <div className="flex-1 space-y-6 p-6">
        <Card title="PHP Estimate Rate">
          <div className="max-w-sm space-y-2">
            <label className="mb-1 block text-xs font-medium text-gray-600">USD to PHP (est.)</label>
            <input
              type="number"
              step="0.0001"
              min="0"
              value={phpRate}
              onChange={(e) => {
                setRateSaved(false)
                setPhpRate(e.target.value)
              }}
              className={FIELD}
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={saveRate}
                disabled={!phpRate || Number(phpRate) <= 0}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Save Rate
              </button>
              {rateSaved && <span className="text-sm text-green-600">Saved</span>}
            </div>
            <p className="text-xs text-gray-500">
              This rate is used globally for PHP estimate conversion across Sales, Dashboard, and Financial KPI cards.
            </p>
          </div>
        </Card>

        <Card title="Gmail Date Range Scrape">
          <form onSubmit={handleScrape} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Start Date</label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={FIELD}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={FIELD}
                />
              </div>
              <label className="flex items-center gap-2 pt-6 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={forceScrape}
                  onChange={(e) => setForceScrape(e.target.checked)}
                />
                Force reprocess (re-scrape duplicates)
              </label>
            </div>
            <div className="flex items-center justify-between gap-3">
              <button
                type="submit"
                disabled={scrapeBusy}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {scrapeBusy ? 'Scraping...' : 'Run Scrape'}
              </button>
            <p className="text-xs text-gray-500">Includes all Alias dates in selected date window.</p>
          </div>
        </form>

        {scrapeResult && (
          <StatusPill tone="green">
            {scrapeResult.status === 'started'
              ? scrapeResult.message
              : `Scrape complete: ${scrapeResult.processed || 0} processed, ${scrapeResult.skipped || 0} skipped, total ${scrapeResult.total_fetched || 0}.`}
          </StatusPill>
        )}
          {scrapeError && <StatusPill tone="red">{scrapeError}</StatusPill>}
        </Card>

        <Card title="Reset / Clear Database">
          <p className="text-sm leading-relaxed text-gray-600">
            This action deletes all operational data and cannot be undone. Use this only when you want a full
            reset of Sales, Inventory, Financial records, and processed email history.
          </p>
          <form onSubmit={handleReset} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Type RESET to confirm
              </label>
              <input
                type="text"
                value={confirmText}
                placeholder="RESET"
                onChange={(e) => setConfirmText(e.target.value)}
                className={FIELD}
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={!canReset || resetBusy}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {resetBusy ? 'Resetting...' : 'Reset Database'}
              </button>
            </div>
          </form>

          {resetResult && (
            <StatusPill tone="green">
              {resetResult.message || 'Database reset completed.'}
            </StatusPill>
          )}
          {resetError && <StatusPill tone="red">{resetError}</StatusPill>}
          {resetResult?.counts && (
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 sm:grid-cols-3">
              <div>Sales cleared: {resetResult.counts.sales}</div>
              <div>Inventory cleared: {resetResult.counts.inventory}</div>
              <div>Bank Transfers: {resetResult.counts.bank_transfers}</div>
              <div>Allocations: {resetResult.counts.bank_transfer_allocations}</div>
              <div>Expenses: {resetResult.counts.expenses}</div>
              <div>Subscriptions: {resetResult.counts.subscriptions}</div>
              <div>Email logs: {resetResult.counts.email_processing_log}</div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
