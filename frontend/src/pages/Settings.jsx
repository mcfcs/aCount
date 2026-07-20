import { useEffect, useState } from 'react'
import TopBar from '../components/layout/TopBar'

import {
  scrapeEmails, resetDatabase,
  getPushStatus, getPushPublicKey, subscribePush, unsubscribePush, sendTestPush,
} from '../services/api'
import { readPhpEstimateRate, writePhpEstimateRate } from '../utils/exchangeRate'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map((ch) => ch.charCodeAt(0)))
}

const FIELD = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400'

function Card({ title, children }) {
  return (
    <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <h2 className="font-display text-xl uppercase tracking-wide text-gray-900">{title}</h2>
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

function pushSupportDiagnosis() {
  if (typeof window === 'undefined') return { supported: false, reasons: [], isIOS: false, standalone: false }
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches
    || window.navigator.standalone === true
  const reasons = []
  if (!window.isSecureContext) {
    reasons.push('Not a secure context — the app must be opened over HTTPS (e.g. the Tailscale https:// URL) or localhost.')
  }
  if (!('serviceWorker' in navigator)) {
    reasons.push('Service workers unavailable in this browser.')
  }
  if (!('PushManager' in window) || !('Notification' in window)) {
    if (isIOS && !standalone) {
      reasons.push('On iPhone, push only exists inside the installed app — open aCount from its Home Screen icon, not in Safari.')
    } else if (isIOS) {
      reasons.push('This iPhone exposes no Push API. It needs iOS 16.4 or newer — and if the Home Screen icon was added before the app became installable (or via a different URL), remove it and re-add it from the current HTTPS address.')
    } else {
      reasons.push('This browser has no Push API support.')
    }
  }
  return { supported: reasons.length === 0, reasons, isIOS, standalone }
}

function PushNotificationsCard() {
  const [diag] = useState(pushSupportDiagnosis)
  const supported = diag.supported

  const [serverStatus, setServerStatus] = useState(null)
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  useEffect(() => {
    getPushStatus().then(setServerStatus).catch(() => setServerStatus(null))
    if (!supported) return
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(Boolean(sub)))
      .catch(() => {})
  }, [supported])

  const enable = async () => {
    setBusy(true)
    setError('')
    setInfo('')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setError('Notification permission was denied. Allow notifications for this site in the browser settings.')
        return
      }
      const { public_key: publicKey } = await getPushPublicKey()
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      await subscribePush(subscription.toJSON())
      setSubscribed(true)
      setInfo('This device will now receive aCount notifications.')
      getPushStatus().then(setServerStatus).catch(() => {})
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not enable notifications on this device.')
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    setError('')
    setInfo('')
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await unsubscribePush({ endpoint: subscription.endpoint })
        await subscription.unsubscribe()
      }
      setSubscribed(false)
      setInfo('Notifications disabled on this device.')
      getPushStatus().then(setServerStatus).catch(() => {})
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not disable notifications.')
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    setError('')
    setInfo('')
    try {
      const result = await sendTestPush()
      setInfo(`Test notification sent to ${result.sent} device${result.sent === 1 ? '' : 's'}.`)
    } catch (err) {
      setError(err?.response?.data?.error || 'Test send failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Push Notifications">
      <p className="text-sm leading-relaxed text-gray-600">
        Get notified about new sales, confirmations with ship-by deadlines, completed cash-outs,
        payouts, and time-critical alerts (attention-needed 48h timer, shipment deadlines) — even
        when the app is closed. Enable per device; on iPhone, add the app to the Home Screen first.
      </p>
      {!supported && diag.reasons.map((reason) => (
        <StatusPill key={reason} tone="red">{reason}</StatusPill>
      ))}
      {!supported && diag.isIOS && (
        <p className="text-xs text-gray-500">
          Diagnostics: {diag.standalone ? 'running as installed app' : 'running in the browser (not installed)'} ·
          secure context: {String(typeof window !== 'undefined' && window.isSecureContext)}
        </p>
      )}
      {supported && serverStatus && !serverStatus.configured && (
        <StatusPill tone="red">Server push is not configured — set the VAPID keys in .env and restart the backend.</StatusPill>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {!subscribed ? (
          <button
            type="button"
            onClick={enable}
            disabled={busy || !supported}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Enable on this device'}
          </button>
        ) : (
          <button
            type="button"
            onClick={disable}
            disabled={busy}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Disable on this device'}
          </button>
        )}
        <button
          type="button"
          onClick={test}
          disabled={busy || !serverStatus?.configured || (serverStatus?.subscriptions ?? 0) === 0}
          className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
        >
          Send test notification
        </button>
        {serverStatus && (
          <span className="text-xs text-gray-500">
            {serverStatus.subscriptions} device{serverStatus.subscriptions === 1 ? '' : 's'} subscribed
          </span>
        )}
      </div>
      {info && <StatusPill tone="green">{info}</StatusPill>}
      {error && <StatusPill tone="red">{error}</StatusPill>}
    </Card>
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
  const [rateSaving, setRateSaving] = useState(false)

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

  const saveRate = async () => {
    setRateSaving(true)
    const saved = await writePhpEstimateRate(phpRate)
    setRateSaving(false)

    setRateSaved(Boolean(saved))
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <TopBar title="Settings" onRefresh={refresh} />

      <div className="flex-1 space-y-6 p-4 sm:p-6">
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
                disabled={rateSaving || !phpRate || Number(phpRate) <= 0}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {rateSaving ? 'Saving...' : 'Save Rate'}
              </button>
              {rateSaved && <span className="text-sm text-green-600">Saved</span>}
            </div>
            <p className="text-xs text-gray-500">
              This rate is used globally for PHP estimate conversion across Sales, Dashboard, and Financial KPI cards.
            </p>
          </div>
        </Card>

        <PushNotificationsCard />

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
                Force re-scrape previously processed emails
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
              <p className="text-xs text-gray-500">
                Includes all Alias emails in the selected date window. Turn on force re-scrape when old emails need to be processed again for image import fixes.
              </p>
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
