import { useCallback, useEffect, useRef, useState } from 'react'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import wasmFileUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import Modal from './Modal'
import { lookupBarcode, confirmBarcodeAdd } from '../../services/api'

// Serve the WASM from our own bundle instead of the package's CDN default.
prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmFileUrl : prefix + path),
  },
})

// Shoe boxes carry retail 1D codes; restricting formats avoids grabbing the
// marketing QR code printed next to them (e.g. qr.nike.com).
const SCAN_FORMATS = ['EAN13', 'UPCA', 'EAN8', 'UPCE']
const SCAN_INTERVAL_MS = 280

const ALL_BRANDS = [
  'Air Jordan', 'New Balance', 'Adidas', 'Nike', 'Puma',
  'Asics', 'Converse', 'Hoka', 'Reebok', 'Other',
]
const INPUT = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400'
const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
    {children}
  </div>
)

function nowDatetimeLocal() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

const EMPTY_FORM = () => ({
  shoe_name: '', brand: '', sku: '', size: '',
  purchase_cost: '', listed_price: '',
  date_purchased: nowDatetimeLocal(), source: '',
})

async function fileToImageData(file, maxDim) {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return ctx.getImageData(0, 0, canvas.width, canvas.height)
  } finally {
    bitmap.close()
  }
}

async function decodeImageFile(file) {
  const options = { formats: SCAN_FORMATS, tryHarder: true }
  // Fast pass on a downscaled frame, then full resolution for small/far codes.
  for (const maxDim of [2200, Infinity]) {
    try {
      const results = await readBarcodes(await fileToImageData(file, maxDim), options)
      if (results.length && results[0].text) return results[0].text
      if (maxDim === Infinity) break
    } catch {
      break // browser can't rasterize this format — try raw bytes below
    }
  }
  // Last resort: let zxing parse the file bytes itself (PNG/JPEG).
  try {
    const results = await readBarcodes(file, options)
    if (results.length && results[0].text) return results[0].text
  } catch {
    // fall through
  }
  return null
}

export default function BarcodeScannerModal({ onClose, onItemAdded }) {
  const [step, setStep] = useState('scan') // scan | details | done
  const [cameraState, setCameraState] = useState('starting') // starting | active | denied | unavailable
  const [uploadBusy, setUploadBusy] = useState(false)
  const [scanError, setScanError] = useState(null)
  const [manualCode, setManualCode] = useState('')

  const [barcode, setBarcode] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupResult, setLookupResult] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [addedItem, setAddedItem] = useState(null)

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const canvasRef = useRef(null)
  const timerRef = useRef(null)
  const decodingRef = useRef(false)
  const handledRef = useRef(false)
  const cameraSessionRef = useRef(0)

  const setField = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  const stopCamera = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const runLookup = useCallback(async (code) => {
    setLookupLoading(true)
    setLookupResult(null)
    try {
      const result = await lookupBarcode(code)
      setLookupResult(result)
      setForm(prev => ({
        ...prev,
        shoe_name: result?.name || prev.shoe_name,
        brand: result?.brand || prev.brand,
        sku: result?.sku || prev.sku,
        size: result?.size != null ? String(result.size) : prev.size,
      }))
    } catch (err) {
      setLookupResult({
        found: false,
        message: err?.response?.data?.error || 'Lookup failed — enter the details manually.',
      })
    } finally {
      setLookupLoading(false)
    }
  }, [])

  const handleDecoded = useCallback((code) => {
    if (handledRef.current) return
    handledRef.current = true
    stopCamera()
    setBarcode(code)
    setStep('details')
    void runLookup(code)
  }, [stopCamera, runLookup])

  const captureFrame = useCallback(async () => {
    const video = videoRef.current
    if (!video || video.readyState < 2 || decodingRef.current || handledRef.current) return
    decodingRef.current = true
    try {
      if (!canvasRef.current) canvasRef.current = document.createElement('canvas')
      const canvas = canvasRef.current
      const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight))
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const results = await readBarcodes(imageData, {
        formats: SCAN_FORMATS,
        tryHarder: true,
        maxNumberOfSymbols: 1,
      })
      if (results.length && results[0].text) handleDecoded(results[0].text)
    } catch {
      // keep scanning; transient frames can fail to decode
    } finally {
      decodingRef.current = false
    }
  }, [handleDecoded])

  const startCamera = useCallback(async (session) => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraState('unavailable')
      return
    }
    setCameraState('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      // The modal may have been closed (or remounted) while the permission
      // prompt was up — release the late stream instead of leaking it.
      const video = videoRef.current
      if (session !== cameraSessionRef.current || !video) {
        stream.getTracks().forEach(track => track.stop())
        return
      }
      streamRef.current = stream
      video.srcObject = stream
      await video.play()
      if (session !== cameraSessionRef.current) return
      setCameraState('active')
      if (!timerRef.current) timerRef.current = setInterval(captureFrame, SCAN_INTERVAL_MS)
    } catch (err) {
      if (session !== cameraSessionRef.current) return
      stopCamera()
      setCameraState(err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError' ? 'denied' : 'unavailable')
    }
  }, [captureFrame, stopCamera])

  useEffect(() => {
    if (step !== 'scan') return undefined
    handledRef.current = false
    const session = ++cameraSessionRef.current
    void startCamera(session)
    return () => {
      cameraSessionRef.current += 1
      stopCamera()
    }
  }, [step, startCamera, stopCamera])

  const handleFileChosen = async (file) => {
    if (!file || uploadBusy) return
    setScanError(null)
    setUploadBusy(true)
    try {
      const code = await decodeImageFile(file)
      if (code) handleDecoded(code)
      else setScanError('No shoe barcode found in that photo. Try a closer, sharper shot of the box label (JPG/PNG).')
    } finally {
      setUploadBusy(false)
    }
  }

  const handleManualLookup = () => {
    const digits = manualCode.replace(/\D/g, '')
    if (digits.length < 8 || digits.length > 14) {
      setScanError('Enter the number printed under the barcode (8–14 digits, usually 12 or 13).')
      return
    }
    setScanError(null)
    handleDecoded(digits)
  }

  const handleRescan = () => {
    setBarcode('')
    setLookupResult(null)
    setSaveError(null)
    setManualCode('')
    setScanError(null)
    setForm(EMPTY_FORM())
    setStep('scan')
  }

  const handleConfirm = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    try {
      const payload = {
        barcode: barcode || undefined,
        sku: form.sku.trim(),
        shoe_name: form.shoe_name.trim(),
        brand: form.brand.trim(),
        size: form.size !== '' ? Number(form.size) : undefined,
        purchase_cost: form.purchase_cost !== '' ? Number(form.purchase_cost) : undefined,
        listed_price: form.listed_price !== '' ? Number(form.listed_price) : undefined,
        date_purchased: form.date_purchased,
        source: form.source.trim() || undefined,
        image_url: lookupResult?.image_url || undefined,
      }
      const result = await confirmBarcodeAdd(payload)
      setAddedItem(result?.item || null)
      setStep('done')
      onItemAdded?.(result?.item)
    } catch (err) {
      setSaveError(err?.response?.data?.error || err?.response?.data?.errors?.join(', ') || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const lookupBanner = () => {
    if (lookupLoading) {
      return (
        <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          Looking up barcode <span className="font-mono">{barcode}</span>…
        </div>
      )
    }
    if (!lookupResult) return null
    if (lookupResult.found) {
      return (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {lookupResult.verified
            ? 'Matched from a previous confirmed scan. Verify the details below, then add.'
            : 'Details found. Please confirm they match the box label before adding.'}
        </div>
      )
    }
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {lookupResult.message || 'Barcode not found. Enter the details from the box label — they\'ll be remembered for next time.'}
      </div>
    )
  }

  return (
    <Modal title="Scan Shoe Barcode" onClose={() => { stopCamera(); onClose() }}>
      {step === 'scan' && (
        <div className="space-y-4">
          <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-900">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
            />
            {cameraState === 'active' && (
              <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 rounded bg-red-500/80 shadow-[0_0_12px_2px_rgba(239,68,68,0.7)]" />
            )}
            {cameraState !== 'active' && (
              <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-gray-300">
                {cameraState === 'starting' && 'Starting camera…'}
                {cameraState === 'denied' && 'Camera permission was denied. Allow camera access, or upload a photo below.'}
                {cameraState === 'unavailable' && (window.isSecureContext
                  ? 'No camera available on this device. Upload a photo of the barcode instead.'
                  : 'Camera needs HTTPS (or localhost). Upload a photo instead, or restart the dev server with VITE_HTTPS=1.')}
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500">
            Point the camera at the UPC/EAN barcode on the shoe box label. It scans automatically.
          </p>

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-gray-100" />
            <span className="text-[11px] uppercase tracking-wide text-gray-400">or</span>
            <span className="h-px flex-1 bg-gray-100" />
          </div>

          <Field label="Upload a photo of the barcode">
            <input
              type="file"
              accept="image/*"
              disabled={uploadBusy}
              onChange={(e) => {
                void handleFileChosen(e.target.files?.[0])
                e.target.value = ''
              }}
              className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
            />
          </Field>
          {uploadBusy && <p className="text-sm text-gray-500">Reading photo…</p>}

          <Field label="Or type the barcode number">
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                placeholder="e.g. 196604191005"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleManualLookup() } }}
                className={INPUT}
              />
              <button
                type="button"
                onClick={handleManualLookup}
                className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
              >
                Look up
              </button>
            </div>
          </Field>
          {scanError && <p className="text-sm text-red-500">{scanError}</p>}
        </div>
      )}

      {step === 'details' && (
        <form onSubmit={handleConfirm} className="space-y-4">
          {barcode && (
            <div className="flex items-center justify-between gap-3">
              <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 font-mono text-xs text-gray-600">
                {barcode}
              </span>
              <button type="button" onClick={handleRescan} className="text-xs font-medium text-indigo-700 hover:text-indigo-900">
                ↺ Rescan
              </button>
            </div>
          )}
          {lookupBanner()}
          {lookupResult?.image_url && (
            <div className="flex justify-center">
              <img
                src={lookupResult.image_url}
                alt="Shoe preview"
                className="h-28 rounded-lg border border-gray-100 object-contain"
                onError={(e) => { e.currentTarget.style.display = 'none' }}
              />
            </div>
          )}
          <Field label="Shoe Name">
            <input type="text" required value={form.shoe_name} onChange={setField('shoe_name')} className={INPUT} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Brand">
              <select value={form.brand} onChange={setField('brand')} className={INPUT}>
                <option value="">Auto-detect / Other</option>
                {ALL_BRANDS.map(brand => <option key={brand} value={brand}>{brand}</option>)}
              </select>
            </Field>
            <Field label="SKU / Style Code">
              <input type="text" required value={form.sku} onChange={setField('sku')} placeholder="e.g. DV3950 001" className={INPUT} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Size (as printed on the box)">
              <input type="number" step="0.5" required value={form.size} onChange={setField('size')} className={INPUT} />
            </Field>
            <Field label="Purchase Cost (PHP)">
              <input type="number" step="0.01" required value={form.purchase_cost} onChange={setField('purchase_cost')} className={INPUT} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Listed Price (PHP)">
              <input type="number" step="0.01" value={form.listed_price} onChange={setField('listed_price')} className={INPUT} />
            </Field>
            <Field label="Date Purchased">
              <input type="datetime-local" required value={form.date_purchased} onChange={setField('date_purchased')} className={INPUT} />
            </Field>
          </div>
          <Field label="Source">
            <input type="text" value={form.source} onChange={setField('source')} placeholder="e.g. Shopee, Nike PH" className={INPUT} />
          </Field>
          {saveError && <p className="text-sm text-red-500">{saveError}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => { stopCamera(); onClose() }}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || lookupLoading}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Adding…' : 'Confirm & Add to Inventory'}
            </button>
          </div>
        </form>
      )}

      {step === 'done' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            Added to inventory: <span className="font-medium">{addedItem?.shoe_name}</span>
            {addedItem?.size != null && <> — size {addedItem.size}</>}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleRescan}
              className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
            >
              Scan another
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
