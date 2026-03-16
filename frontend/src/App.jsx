import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/layout/Sidebar'
import Dashboard from './pages/Dashboard'
import Sales from './pages/Sales'
import Inventory from './pages/Inventory'
import Financial from './pages/Financial'
import Settings from './pages/Settings'
import { cancelScrape, getScrapeStatus } from './services/api'

function ScrapeProgressIndicator() {
  const [status, setStatus] = useState(null)
  const [isCancelling, setIsCancelling] = useState(false)

  useEffect(() => {
    let mounted = true
    let timer = null

    const poll = async () => {
      try {
        const data = await getScrapeStatus()
        if (!mounted) return
        setStatus(data)
      } catch {
        if (!mounted) return
        setStatus(null)
      }
    }

    poll()
    timer = window.setInterval(poll, 2500)

    return () => {
      mounted = false
      if (timer) window.clearInterval(timer)
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
    <div className="fixed left-4 bottom-4 z-50 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs text-blue-700 shadow-md">
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
  return (
    <BrowserRouter>
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        {/* Main content offset by sidebar width */}
        <div className="ml-60 flex-1 min-w-0">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/sales" element={<Sales />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/financial" element={<Financial />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </div>
      <ScrapeProgressIndicator />
    </BrowserRouter>
  )
}
