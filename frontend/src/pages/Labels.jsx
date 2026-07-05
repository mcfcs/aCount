import { useEffect, useMemo, useRef, useState } from 'react'
import TopBar from '../components/layout/TopBar'
import LoadingSpinner from '../components/common/LoadingSpinner'
import { getLabels, printLabels, refreshLabels } from '../services/api'

const LATEST_LABELS_LIMIT = 10

const FIELD = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400'

const STATUS_TONES = {
  Pending: 'bg-amber-50 text-amber-700 border-amber-200',
  Confirmed: 'bg-blue-50 text-blue-700 border-blue-200',
  Shipped: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  Completed: 'bg-green-50 text-green-700 border-green-200',
  Cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
}

function StatusPill({ status }) {
  const tone = STATUS_TONES[status] || 'bg-gray-50 text-gray-600 border-gray-200'
  return <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${tone}`}>{status}</span>
}

function formatDeadline(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function Labels() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(() => new Set())

  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState('')
  const [skipped, setSkipped] = useState([])
  const [pdfUrl, setPdfUrl] = useState('')
  const pdfUrlRef = useRef('')

  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState('')
  const [refreshErr, setRefreshErr] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getLabels()
      setRows(Array.isArray(data?.items) ? data.items : [])
    } catch {
      setError('Could not load shipping labels.')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // Revoke any object URL we created when the page unmounts.
    return () => {
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current)
    }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      String(r.order_number).includes(q) ||
      (r.shoe_name || '').toLowerCase().includes(q) ||
      (r.sku || '').toLowerCase().includes(q)
    )
  }, [rows, search])

  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.order_number))

  const toggleOne = (orderNumber) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(orderNumber)) next.delete(orderNumber)
      else next.add(orderNumber)
      return next
    })
  }

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        filtered.forEach((r) => next.delete(r.order_number))
      } else {
        filtered.forEach((r) => next.add(r.order_number))
      }
      return next
    })
  }

  const selectedOrderNumbers = useMemo(
    () => filtered.filter((r) => selected.has(r.order_number)).map((r) => r.order_number),
    [filtered, selected]
  )

  const setPdf = (url) => {
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current)
    pdfUrlRef.current = url
    setPdfUrl(url)
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    setRefreshMsg('')
    setRefreshErr('')
    try {
      const res = await refreshLabels(LATEST_LABELS_LIMIT)
      if (res?.status === 'ok') {
        setRefreshMsg(
          `Synced from Gmail: ${res.labels_captured ?? 0} new label(s), ` +
          `${res.tracking_backfilled ?? 0} tracking # added, ${res.statuses_updated ?? 0} status(es) updated.`
        )
        await load()
      } else {
        setRefreshErr(res?.error || 'Could not fetch labels from Gmail.')
      }
    } catch (err) {
      setRefreshErr(err?.response?.data?.error || 'Could not fetch labels from Gmail.')
    } finally {
      setRefreshing(false)
    }
  }

  const handlePrint = async () => {
    if (selectedOrderNumbers.length === 0) return
    setPrinting(true)
    setPrintError('')
    setSkipped([])
    setPdf('')

    try {
      const res = await printLabels({ order_numbers: selectedOrderNumbers })
      const skippedHeader = res.headers?.['x-labels-skipped'] || ''
      setSkipped(skippedHeader ? skippedHeader.split(',').filter(Boolean) : [])

      const blob = new Blob([res.data], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      setPdf(url)
      // Try to open the combined PDF in a new tab (may be blocked by the
      // popup blocker after the await — the on-screen button is the fallback).
      window.open(url, '_blank', 'noopener')
    } catch (err) {
      let msg = 'Failed to build the labels PDF.'
      const blob = err?.response?.data
      if (blob instanceof Blob) {
        try {
          const parsed = JSON.parse(await blob.text())
          if (parsed?.error) msg = parsed.error
        } catch {
          // keep default message
        }
      }
      setPrintError(msg)
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <TopBar title="Labels" onRefresh={load} loading={loading} />

      <div className="flex-1 space-y-5 p-4 sm:p-6">
        <p className="max-w-3xl text-sm leading-relaxed text-gray-600">
          Prepaid shipping labels captured from Alias{' '}
          <span className="font-medium text-gray-800">&ldquo;Shipping Label and Instructions&rdquo;</span> emails.
          Pick the ones you need and generate a single print-ready PDF — each order&rsquo;s label and QR code are
          placed side-by-side on one landscape page (2-up, fit to printable area).
        </p>

        {/* Controls */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-full items-center gap-2 sm:max-w-md">
            <input
              type="search"
              placeholder="Search order #, shoe, or SKU"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={FIELD}
            />
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:border-indigo-400 hover:text-gray-900 disabled:opacity-50"
            >
              {refreshing ? 'Fetching…' : 'Fetch latest 10'}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">
              {selectedOrderNumbers.length} selected
            </span>
            <button
              type="button"
              onClick={handlePrint}
              disabled={printing || selectedOrderNumbers.length === 0}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {printing ? 'Building PDF…' : 'Print selected'}
            </button>
          </div>
        </div>

        {refreshMsg && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">{refreshMsg}</div>
        )}
        {refreshErr && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{refreshErr}</div>
        )}

        {/* Result / warnings */}
        {pdfUrl && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            <span>Combined PDF ready.</span>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-green-300 bg-white px-2.5 py-1 font-medium text-green-700 hover:bg-green-100"
            >
              Open / Print
            </a>
            <a
              href={pdfUrl}
              download="shipping-labels.pdf"
              className="rounded-md border border-green-300 bg-white px-2.5 py-1 font-medium text-green-700 hover:bg-green-100"
            >
              Download
            </a>
          </div>
        )}
        {skipped.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Could not download labels for order(s): {skipped.join(', ')}. They were left out of the PDF.
          </div>
        )}
        {printError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{printError}</div>
        )}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        {/* Table */}
        <section className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <LoadingSpinner size="lg" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <p className="text-sm font-medium text-gray-700">No shipping labels found.</p>
              <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-gray-500">
                Labels appear here after the &ldquo;Shipping Label and Instructions&rdquo; emails are processed.
                Run a Gmail scrape for the relevant date range in{' '}
                <span className="font-medium text-gray-700">Settings</span> to import them (use force re-scrape if
                those emails were processed before this feature existed).
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        aria-label="Select all"
                      />
                    </th>
                    <th className="px-4 py-3 text-left font-semibold">Order #</th>
                    <th className="px-4 py-3 text-left font-semibold">JANIO Tracking #</th>
                    <th className="px-4 py-3 text-left font-semibold">Shoe</th>
                    <th className="px-4 py-3 text-left font-semibold">Size</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                    <th className="px-4 py-3 text-left font-semibold">Ship by</th>
                    <th className="px-4 py-3 text-left font-semibold">Label</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((r) => {
                    const isSel = selected.has(r.order_number)
                    return (
                      <tr
                        key={r.sale_id}
                        className={`cursor-pointer transition-colors ${isSel ? 'bg-indigo-50/60' : 'hover:bg-gray-50'}`}
                        onClick={() => toggleOne(r.order_number)}
                      >
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={isSel} onChange={() => toggleOne(r.order_number)} />
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-800">{r.order_number}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600" onClick={(e) => e.stopPropagation()}>
                          {r.tracking_number
                            ? <span className="select-all">{r.tracking_number}</span>
                            : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-800">{r.shoe_name}</td>
                        <td className="px-4 py-3 text-gray-600">{r.size ?? '—'}</td>
                        <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                        <td className="px-4 py-3 text-gray-600">{formatDeadline(r.shipment_deadline)}</td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <a
                            href={r.shipping_label_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-600 hover:text-indigo-800 hover:underline"
                          >
                            Raw PDF
                          </a>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
