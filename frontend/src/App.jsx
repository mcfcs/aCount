import { useEffect, useState, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/layout/Sidebar'
import LoadingSpinner from './components/common/LoadingSpinner'
import { cancelScrape, getScrapeStatus } from './services/api'

// Each page is its own async chunk — the heavy charting (recharts) and a page's
// code only download when that route is first visited, shrinking initial load.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Sales = lazy(() => import('./pages/Sales'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Financial = lazy(() => import('./pages/Financial'))
const Labels = lazy(() => import('./pages/Labels'))
const Settings = lazy(() => import('./pages/Settings'))

function ScrapeProgressIndicator() {
  const [status, setStatus] = useState(null)
  const [isCancelling, setIsCancelling] = useState(false)

  useEffect(() => {
    let mounted = true
    let timer = null

    const schedule = (delay) => {
      timer = window.setTimeout(tick, delay)
    }

    const tick = async () => {
      if (!mounted) return
      // Don't poll while the tab is backgrounded; re-check a little later.
      if (typeof document !== 'undefined' && document.hidden) {
        schedule(5000)
        return
      }
      let running = false
      try {
        const data = await getScrapeStatus()
        if (!mounted) return
        setStatus(data)
        running = Boolean(data?.running)
      } catch {
        if (!mounted) return
        setStatus(null)
      }
      // Poll quickly while a scrape is active, slowly when idle.
      if (mounted) schedule(running ? 2500 : 20000)
    }

    tick()

    return () => {
      mounted = false
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  if (!status || !status.running) return null

  const handleCancel = async () => {
    setIsCancelling(true)
    try {
      await cancelScrape()
    } finally {
      setIsCancelling(false)
    }
  }

  const processed = Number(status.processed || 0)
  const skipped = Number(status.skipped || 0)
  const total = Number(status.total_fetched || 0)

  return (
    <div className="fixed left-3 right-3 bottom-4 z-50 mx-auto max-w-[95vw] rounded-lg border border-blue-200 bg-white px-3 py-2 text-[11px] text-blue-700 shadow-md sm:left-4 sm:right-auto sm:text-xs">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-blue-600" />
        <span>
          Gmail scrape {status.cancelling ? 'cancelling' : 'running'} -
          {processed} {total ? `of ${total} ` : ''}emails processed, {skipped} skipped.
        </span>
        <button
          type="button"
          onClick={handleCancel}
          disabled={isCancelling || status.cancelling}
          className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          {isCancelling || status.cancelling ? 'Cancelling...' : 'Cancel scrape'}
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024) {
        setMobileMenuOpen(false)
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <BrowserRouter>
      <div className="flex min-h-screen bg-gray-50">
        <button
          type="button"
          aria-label="Open navigation"
          className="lg:hidden fixed left-3 bottom-3 z-50 rounded-lg border border-gray-200 bg-white px-2 py-2 text-gray-700 shadow-sm"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {mobileMenuOpen && (
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        <Sidebar
          isOpen={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
        />
        {/* Main content offset by sidebar width */}
        <div className="flex-1 min-w-0 lg:ml-72">
          <Suspense
            fallback={
              <div className="flex min-h-screen items-center justify-center bg-gray-50">
                <LoadingSpinner size="lg" />
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/sales" element={<Sales />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/financial" element={<Financial />} />
              <Route path="/labels" element={<Labels />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Suspense>
        </div>
      </div>
      <ScrapeProgressIndicator />
    </BrowserRouter>
  )
}

