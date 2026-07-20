import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import TopBar from '../components/layout/TopBar'
import KPICard from '../components/common/KPICard'
import LoadingSpinner from '../components/common/LoadingSpinner'
import EmptyState from '../components/common/EmptyState'
import Modal from '../components/common/Modal'
import ImageDropInput from '../components/common/ImageDropInput'
import BarcodeScannerModal from '../components/common/BarcodeScannerModal'
import { exportToCsv } from '../utils/csv'
import { exportSellingWorkbook } from '../utils/excel'
import { useDebounce } from '../utils/useDebounce'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import {
  getInventory,
  getInventorySummary,
  createInventoryItem,
  createInventoryItems,
  createSale,
  updateInventoryItem,
  deleteInventoryItem,
  getShoeBySku,
  getPricingSuggestion,
  getShoes,
  ensureShoe,
  ensureShoeWithImage,
  getPurchaseCosts,
  linkInventoryToSale,
} from '../services/api'

function formatPHP(value) {
  const num = parseFloat(value) || 0
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(num)
}
function formatSizeLabel(size) {
  const num = Number(size)
  if (!Number.isFinite(num)) return String(size ?? '')
  return Number.isInteger(num) ? String(num) : String(num)
}
function normalizeSizeValue(size) {
  if (size == null) return ''
  const trimmed = String(size).trim()
  if (!trimmed) return ''
  const num = Number(trimmed)
  return Number.isFinite(num) ? String(num) : trimmed
}
function sortSizeValues(a, b) {
  const aNum = Number(a)
  const bNum = Number(b)
  const aIsNum = Number.isFinite(aNum)
  const bIsNum = Number.isFinite(bNum)
  if (aIsNum && bIsNum) return aNum - bNum
  if (aIsNum) return -1
  if (bIsNum) return 1
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}
function hasStandaloneToken(text, token) {
  return new RegExp(`(^|[^A-Za-z0-9])${token}([^A-Za-z0-9]|$)`, 'i').test(String(text || ''))
}
function isWomensInventoryItem(row) {
  const name = String(row?.shoe_name || '')
  return /\bWmns\b/i.test(name) || /\bWomen's\b/i.test(name) || /\bWomens\b/i.test(name)
}
function isPsTdInventoryItem(row) {
  return hasStandaloneToken(row?.shoe_name, 'PS') || hasStandaloneToken(row?.shoe_name, 'TD')
}
function toWomensSizeLabel(size) {
  const normalized = normalizeSizeValue(size)
  if (!normalized) return ''
  const numeric = Number(normalized)
  if (!Number.isFinite(numeric)) return `${normalized}W`
  return `${formatSizeLabel(numeric + 1.5)}W`
}
function getQuickSizeDisplayValue(row, { sizeMode = 'us', includeWomenSizes = false } = {}) {
  const normalized = normalizeSizeValue(row?.size)
  if (!normalized) return ''
  const numeric = Number(normalized)
  if (!Number.isFinite(numeric)) return normalized
  if (sizeMode === 'womens') {
    return isWomensInventoryItem(row) ? normalized : ''
  }
  if (includeWomenSizes && isWomensInventoryItem(row)) {
    return normalizeSizeValue(numeric - 1.5)
  }
  return normalized
}
function shouldIncludePsTdItem(row, mode = 'exclude') {
  const isPsTd = isPsTdInventoryItem(row)
  if (mode === 'only') return isPsTd
  if (mode === 'include') return true
  return !isPsTd
}
function shouldIncludeForQuickSizeMode(row, { sizeMode = 'us', includeWomenSizes = false } = {}) {
  if (sizeMode === 'womens') return isWomensInventoryItem(row)
  if (isWomensInventoryItem(row)) return includeWomenSizes
  return true
}
function collectQuickSizeOptions(rows, { sizeMode = 'us', includeWomenSizes = false, psTdMode = 'exclude' } = {}) {
  const uniqueSizes = new Set()
  rows.forEach((row) => {
    if (!shouldIncludePsTdItem(row, psTdMode)) return
    if (!shouldIncludeForQuickSizeMode(row, { sizeMode, includeWomenSizes })) return
    const normalized = getQuickSizeDisplayValue(row, { sizeMode, includeWomenSizes })
    if (normalized) uniqueSizes.add(normalized)
  })
  return Array.from(uniqueSizes)
    .sort(sortSizeValues)
    .map((value) => ({ value, label: formatSizeLabel(value) }))
}
function filterItemsBySelectedSizes(rows, selectedSizes, { sizeMode = 'us', includeWomenSizes = false, psTdMode = 'exclude' } = {}) {
  const filteredByPsTd = rows.filter((row) => (
    shouldIncludePsTdItem(row, psTdMode)
      && shouldIncludeForQuickSizeMode(row, { sizeMode, includeWomenSizes })
  ))
  if (!selectedSizes.length) return filteredByPsTd
  const selected = new Set(selectedSizes.map(normalizeSizeValue).filter(Boolean))
  return filteredByPsTd.filter((row) => selected.has(getQuickSizeDisplayValue(row, { sizeMode, includeWomenSizes })))
}
function formatDate(dateStr) {
  if (!dateStr) return '—'
  try { return new Date(dateStr).toLocaleDateString('en-PH') } catch { return dateStr }
}
function isOldItem(dateStr) {
  if (!dateStr) return false
  try { return (Date.now() - new Date(dateStr).getTime()) / 86400000 > 90 } catch { return false }
}
function toDatetimeLocal(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    // Offset to local wall-clock so the datetime-local input doesn't shift by the timezone.
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  } catch { return '' }
}

const STATUS_STYLES = {
  Available: 'bg-green-100 text-green-700',
  Sold:      'bg-blue-100 text-blue-700',
  Consigned: 'bg-yellow-100 text-yellow-700',
}
const ALL_STATUSES = ['Available', 'Sold', 'Consigned']
const ALL_BRANDS = [
  'Air Jordan', 'New Balance', 'Adidas', 'Nike', 'Puma',
  'Asics', 'Converse', 'Hoka', 'Reebok', 'Other',
]
const BRAND_COLORS = {
  Nike: '#22c55e',
  Adidas: '#3b82f6',
  Other: '#9ca3af',
  'Air Jordan': '#f59e0b',
  'New Balance': '#8b5cf6',
  Puma: '#14b8a6',
  Asics: '#ef4444',
  Converse: '#64748b',
  Hoka: '#f97316',
  Reebok: '#06b6d4',
}
const SHOE_CHART_FALLBACK = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#14b8a6', '#8b5cf6', '#f97316', '#06b6d4', '#64748b', '#3b82f6']
const INVENTORY_TAG_OPTIONS = ['Returned', 'Molds', 'Dirty', 'Used', 'No Box', 'Damaged Box', 'Mismatched Sizes', 'Yellowing', 'Discoloration']

const INPUT = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400'
const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
    {children}
  </div>
)

function parseInventoryTags(notes) {
  try {
    if (!notes) return []
    const parsed = JSON.parse(notes)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((tag) => String(tag).trim())
      .filter((tag) => tag)
  } catch {
    return []
  }
}

function buildInPersonSaleNotes(amountMadePhp) {
  return JSON.stringify({
    in_person_sale: true,
    amount_made_php: amountMadePhp,
  })
}

function tagsFromFormValue(value) {
  return Array.isArray(value) ? value.filter((tag) => String(tag).trim()) : []
}

function inferBrandFromSku(rawSku) {
  const trimmed = String(rawSku || '').trim()
  if (!trimmed) return ''

  const normalized = trimmed.replace(/\s+/g, ' ').trim()
  const parts = normalized.split(' ').filter(Boolean)

  if (parts.length >= 2) {
    const [first, second] = parts
    if (first.length === 6 && second.length === 2) return 'Puma'
    if (first.length === 6 && second.length === 3) return 'Nike'
    if (first.length === 7) return 'Hoka'
    if (first.length === 8) return 'Asics'
  }

  const compact = normalized.replace(/\s+/g, '')
  if (compact.length === 7 && /c$/i.test(compact)) return 'Converse'
  if (compact.length === 6) return 'Adidas'

  const nbMatch = compact.match(/^([A-Za-z]+)(\d+)([A-Za-z]+)$/)
  if (nbMatch && !/c$/i.test(compact)) return 'New Balance'

  return ''
}

const EMPTY_ITEM = {
  sku: '', shoe_name: '', size: '', status: 'Available',
  brand: '',
  purchase_cost: '', listed_price: '', date_purchased: '',
  source: '', tags: [],
}
const EMPTY_BULK_ITEM = { size: '', quantity: 1 }
const EMPTY_SHOE_ITEM = {
  sku: '',
  name: '',
  brand: '',
  image_url: '',
}
const EMPTY_SOLD_FORM = {
  amount_made_php: '',
}
const INVENTORY_CSV_COLUMNS = [
  { key: 'sku', label: 'SKU' },
  { key: 'shoe_name', label: 'Shoe Name' },
  { key: 'size', label: 'Size' },
  { key: 'status', label: 'Status' },
  { key: 'purchase_cost', label: 'Purchase Cost' },
  { key: 'listed_price', label: 'Listed Price' },
  { key: 'date_purchased', label: 'Date Purchased' },
  { key: 'source', label: 'Source' },
  { key: 'notes', label: 'Notes' },
  { key: 'linked_sale_id', label: 'Linked Sale ID' },
]
export default function Inventory() {
  const INVENTORY_PER_PAGE = 100
  const [items, setItems] = useState([])
  const [sellingItems, setSellingItems] = useState([])
  const [shoes, setShoes] = useState([])
  const [inventorySummary, setInventorySummary] = useState({
    total_items: 0,
    active_count: 0,
    active_value_php: 0,
    by_status: {},
  })
  const [inventoryVisibleTotal, setInventoryVisibleTotal] = useState(0)
  const [inventoryPage, setInventoryPage] = useState(1)
  const [inventoryPages, setInventoryPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [sizeFilter, setSizeFilter] = useState('')
  const [selectedSizeFilters, setSelectedSizeFilters] = useState([])
  const [quickSizeMode, setQuickSizeMode] = useState('us')
  const [includeWomenSizes, setIncludeWomenSizes] = useState(false)
  const [psTdMode, setPsTdMode] = useState('exclude')
  const [quickSizeRows, setQuickSizeRows] = useState([])
  const [quickSizeOptionsLoaded, setQuickSizeOptionsLoaded] = useState(false)
  const [sizeTypeFilter, setSizeTypeFilter] = useState('')
  const [activeView, setActiveView] = useState('inventory')
  const [shoeBrandFilter, setShoeBrandFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSellingIds, setSelectedSellingIds] = useState([])
  const [sellingExportBusy, setSellingExportBusy] = useState(false)
  const [sellingExportShowQuantity, setSellingExportShowQuantity] = useState(true)
  const [sellingExportSizeBase, setSellingExportSizeBase] = useState('us')

  const [modalOpen, setModalOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_ITEM)
  const [itemShoeImageInfo, setItemShoeImageInfo] = useState(null)
  const [itemShoeImageFile, setItemShoeImageFile] = useState(null)
  const [itemShoeImageUrl, setItemShoeImageUrl] = useState('')
  const [itemShoeImagePreview, setItemShoeImagePreview] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkItems, setBulkItems] = useState([EMPTY_BULK_ITEM])
  const [availablePurchaseCosts, setAvailablePurchaseCosts] = useState([])

  const [shoeModalOpen, setShoeModalOpen] = useState(false)
  const [editingShoe, setEditingShoe] = useState(null)
  const [shoeForm, setShoeForm] = useState(EMPTY_SHOE_ITEM)
  const [shoeImageFile, setShoeImageFile] = useState(null)
  const [shoeImageUrl, setShoeImageUrl] = useState('')
  const [shoeImagePreview, setShoeImagePreview] = useState('')
  const [shoeSaving, setShoeSaving] = useState(false)
  const [shoeSaveError, setShoeSaveError] = useState(null)
  const [markSoldOpen, setMarkSoldOpen] = useState(false)
  const [markingSoldItem, setMarkingSoldItem] = useState(null)
  const [markSoldForm, setMarkSoldForm] = useState(EMPTY_SOLD_FORM)
  const [markSoldSaving, setMarkSoldSaving] = useState(false)
  const [markSoldError, setMarkSoldError] = useState(null)

  const debouncedSearch = useDebounce(searchQuery)
  const fetchReqId = useRef(0)

  const refreshQuickSizeOptions = useCallback(async () => {
    const allRows = []
    let pageNum = 1
    const perPage = 100

    try {
      while (true) {
        const data = await getInventory({ status: 'Available', page: pageNum, per_page: perPage })
        const rows = Array.isArray(data) ? data : data.inventory || data.items || []
        const totalPages = data?.pages || Math.ceil((data?.total || 0) / perPage)
        allRows.push(...rows)

        if (data?.pages != null) {
          if (pageNum >= totalPages) break
        } else if (rows.length < perPage) {
          break
        } else if (data?.total && allRows.length >= data.total) {
          break
        }

        pageNum += 1
      }

      setQuickSizeRows(allRows)
      setQuickSizeOptionsLoaded(true)
    } catch {
      setQuickSizeOptionsLoaded(true)
    }
  }, [])

  const fetchData = useCallback(async () => {
    const reqId = ++fetchReqId.current
    setLoading(true)
    setError(null)

    const fetchAllPages = async (requestFn, baseParams, { forceAllPages = false } = {}) => {
      const perPage = 100
      const allRows = []
      let pageNum = 1
      const q = debouncedSearch.trim()
      const shouldFetchAll = Boolean(q)
      if (!forceAllPages && !shouldFetchAll) {
        const firstData = await requestFn({ ...baseParams, page: pageNum, per_page: 200 })
        return Array.isArray(firstData) ? firstData : firstData.inventory || firstData.shoes || firstData.items || []
      }

      while (true) {
        const data = await requestFn({ ...baseParams, page: pageNum, per_page: perPage })
        const rows = Array.isArray(data) ? data : data.inventory || data.shoes || data.items || []
        const totalPages = data.pages || Math.ceil((data.total || 0) / perPage)
        allRows.push(...rows)
        if (data.pages != null) {
          if (pageNum >= totalPages) break
        } else if (rows.length < perPage) {
          break
        } else if (data.total && allRows.length >= data.total) {
          break
        }
        pageNum += 1
      }
      return allRows
    }

    if (activeView === 'shoes') {
      try {
        const params = {
          sort_by: 'sku',
          order: 'asc',
        }
        if (shoeBrandFilter) params.brand = shoeBrandFilter
        const q = debouncedSearch.trim()
        if (q) params.q = q
        const rows = await fetchAllPages((requestParams) => getShoes(requestParams), params)
        if (reqId !== fetchReqId.current) return
        setShoes(rows)
      } catch (err) {
        setError(err?.response?.data?.error || 'Failed to load shoes')
      } finally {
        if (reqId === fetchReqId.current) setLoading(false)
      }
      return
    }

    if (activeView === 'selling') {
      try {
        const params = {}
        if (statusFilter) params.status = statusFilter
        if (sizeFilter !== '') params.size = sizeFilter
        if (sizeTypeFilter) params.size_type = sizeTypeFilter
        const q = debouncedSearch.trim()
        if (q) params.q = q
        const rows = await fetchAllPages((requestParams) => getInventory(requestParams), params, { forceAllPages: true })
        if (reqId !== fetchReqId.current) return
        setSellingItems(Array.isArray(rows) ? rows : [])
      } catch (err) {
        setError(err?.response?.data?.error || 'Failed to load selling inventory')
      } finally {
        if (reqId === fetchReqId.current) setLoading(false)
      }
      return
    }

    try {
      const params = {}
      if (statusFilter) params.status = statusFilter
      if (sizeFilter !== '') params.size = sizeFilter
      if (sizeTypeFilter) params.size_type = sizeTypeFilter
      const q = debouncedSearch.trim()
      if (q) params.q = q

      const shouldApplyQuickSizeAcrossInventory = selectedSizeFilters.length > 0
      if (shouldApplyQuickSizeAcrossInventory) {
        const [allInventoryRows, summaryData] = await Promise.all([
          fetchAllPages((requestParams) => getInventory(requestParams), params, { forceAllPages: true }),
          getInventorySummary(params),
        ])
        if (reqId !== fetchReqId.current) return
        const filteredRows = filterItemsBySelectedSizes(Array.isArray(allInventoryRows) ? allInventoryRows : [], selectedSizeFilters, {
          sizeMode: quickSizeMode,
          includeWomenSizes,
          psTdMode,
        })
        const totalFilteredPages = Math.max(1, Math.ceil(filteredRows.length / INVENTORY_PER_PAGE))
        const nextPage = Math.min(inventoryPage, totalFilteredPages)
        const pageStart = (nextPage - 1) * INVENTORY_PER_PAGE
        const pageRows = filteredRows.slice(pageStart, pageStart + INVENTORY_PER_PAGE)

        setItems(pageRows)
        setInventoryVisibleTotal(filteredRows.length)
        setInventoryPages(totalFilteredPages)
        if (nextPage !== inventoryPage) {
          setInventoryPage(nextPage)
        }
        setSellingItems([])
        setInventorySummary(summaryData || {
          total_items: 0,
          active_count: 0,
          active_value_php: 0,
          by_status: {},
        })
      } else {
        const [inventoryData, summaryData] = await Promise.all([
          getInventory({ ...params, page: inventoryPage, per_page: INVENTORY_PER_PAGE }),
          getInventorySummary(params),
        ])
        if (reqId !== fetchReqId.current) return
        const rows = Array.isArray(inventoryData) ? inventoryData : inventoryData.inventory || inventoryData.items || []
        setItems(Array.isArray(rows) ? rows : [])
        setInventoryVisibleTotal(Array.isArray(rows) ? rows.length : 0)
        setInventoryPages(Math.max(1, inventoryData?.pages || 1))
        setSellingItems([])
        setInventorySummary(summaryData || {
          total_items: 0,
          active_count: 0,
          active_value_php: 0,
          by_status: {},
        })
      }

    } catch (err) {
      if (reqId !== fetchReqId.current) return
      setError(err?.response?.data?.error || 'Failed to load inventory')
    } finally {
      if (reqId === fetchReqId.current) setLoading(false)
    }
  }, [statusFilter, sizeFilter, sizeTypeFilter, activeView, shoeBrandFilter, debouncedSearch, inventoryPage, selectedSizeFilters, quickSizeMode, includeWomenSizes, psTdMode])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    setInventoryPage(1)
  }, [statusFilter, sizeFilter, sizeTypeFilter, debouncedSearch, activeView, selectedSizeFilters, quickSizeMode, includeWomenSizes, psTdMode])

  useEffect(() => {
    setSelectedSizeFilters([])
  }, [quickSizeMode])

  useEffect(() => {
    void refreshQuickSizeOptions()
  }, [refreshQuickSizeOptions])

  useEffect(() => {
    if (!itemShoeImageFile) return undefined
    const previewUrl = URL.createObjectURL(itemShoeImageFile)
    setItemShoeImagePreview(previewUrl)
    return () => URL.revokeObjectURL(previewUrl)
  }, [itemShoeImageFile])

  useEffect(() => {
    if (!shoeImageFile) return undefined
    const previewUrl = URL.createObjectURL(shoeImageFile)
    setShoeImagePreview(previewUrl)
    return () => URL.revokeObjectURL(previewUrl)
  }, [shoeImageFile])

  const shoeBrandData = useMemo(() => Object.entries(
    shoes.reduce((acc, item) => {
      const brand = item.brand || 'Other'
      acc[brand] = (acc[brand] || 0) + 1
      return acc
    }, {})
  ).map(([brand, count]) => ({
    name: brand,
    value: count,
  })), [shoes])

  const fetchAllInventoryForExport = useCallback(async () => {
    let pageNum = 1
    const allItems = []
    const perPage = 100
    const q = searchQuery.trim()
    while (true) {
      const params = { page: pageNum, per_page: perPage }
      if (statusFilter) params.status = statusFilter
      if (sizeFilter !== '') params.size = sizeFilter
      if (sizeTypeFilter) params.size_type = sizeTypeFilter
      if (q) params.q = q
      const data = await getInventory(params)
      const rows = Array.isArray(data) ? data : data.inventory || data.items || []
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
    return filterItemsBySelectedSizes(allItems, selectedSizeFilters, { sizeMode: quickSizeMode, includeWomenSizes, psTdMode })
  }, [statusFilter, sizeFilter, sizeTypeFilter, searchQuery, selectedSizeFilters, quickSizeMode, includeWomenSizes, psTdMode])

  const inventoryRows = useMemo(
    () => filterItemsBySelectedSizes(items, selectedSizeFilters, { sizeMode: quickSizeMode, includeWomenSizes, psTdMode }),
    [items, selectedSizeFilters, quickSizeMode, includeWomenSizes, psTdMode],
  )
  const sellingRows = useMemo(
    () => filterItemsBySelectedSizes(sellingItems, selectedSizeFilters, { sizeMode: quickSizeMode, includeWomenSizes, psTdMode }),
    [sellingItems, selectedSizeFilters, quickSizeMode, includeWomenSizes, psTdMode],
  )
  const sellingRowIdsKey = sellingRows.map((item) => item.inventory_id).join('|')
  const fallbackQuickSizeOptions = useMemo(
    () => collectQuickSizeOptions([
      ...items.filter((item) => item?.status === 'Available'),
      ...sellingItems.filter((item) => item?.status === 'Available'),
    ], { sizeMode: quickSizeMode, includeWomenSizes, psTdMode }),
    [items, sellingItems, quickSizeMode, includeWomenSizes, psTdMode],
  )
  const visibleQuickSizeOptions = useMemo(
    () => (quickSizeRows.length
      ? collectQuickSizeOptions(quickSizeRows, { sizeMode: quickSizeMode, includeWomenSizes, psTdMode })
      : fallbackQuickSizeOptions),
    [quickSizeRows, fallbackQuickSizeOptions, quickSizeMode, includeWomenSizes, psTdMode],
  )
  const totalValue = inventorySummary?.active_value_php || 0
  const hasInventoryTags = inventoryRows.some((item) => parseInventoryTags(item.notes).length > 0)
  const sellingHasInventoryTags = sellingRows.some((item) => parseInventoryTags(item.notes).length > 0)
  const sellableItems = sellingRows.filter((item) => item.status === 'Available' && item.listed_price != null)
  const sellableItemIds = new Set(sellableItems.map((item) => item.inventory_id))
  const selectedSellingItems = sellingRows.filter((item) => selectedSellingIds.includes(item.inventory_id) && item.status === 'Available' && item.listed_price != null)
  const selectedSellableCount = selectedSellingItems.length
  const selectedSellingRevenue = selectedSellingItems.reduce((sum, item) => sum + (parseFloat(item.listed_price || 0) || 0), 0)
  const selectedSellingProfit = selectedSellingItems.reduce((sum, item) => sum + ((parseFloat(item.listed_price || 0) || 0) - (parseFloat(item.purchase_cost || 0) || 0)), 0)

  const openAdd = () => {
    setEditing(null)
    setForm({ ...EMPTY_ITEM, date_purchased: toDatetimeLocal(new Date().toISOString()) })
    setItemShoeImageInfo(null)
    setItemShoeImageFile(null)
    setItemShoeImagePreview('')
    setBulkMode(true)
    setBulkItems([{ ...EMPTY_BULK_ITEM }])
    setAvailablePurchaseCosts([])
    setSaveError(null)
    setModalOpen(true)
  }

  const openEdit = (item) => {
    setEditing(item)
    setForm({
      sku: item.sku ?? '',
      shoe_name: item.shoe_name ?? '',
      brand: item.brand ?? '',
      size: item.size ?? '',
      status: item.status ?? 'Available',
      purchase_cost: item.purchase_cost ?? '',
      listed_price: item.listed_price ?? '',
      date_purchased: toDatetimeLocal(item.date_purchased),
      source: item.source ?? '',
      tags: parseInventoryTags(item.notes),
    })
    setItemShoeImageInfo(null)
    setItemShoeImageFile(null)
    setItemShoeImageUrl('')
    setItemShoeImagePreview('')
    setBulkMode(false)
    setBulkItems([{ ...EMPTY_BULK_ITEM }])
    setAvailablePurchaseCosts([])
    setSaveError(null)
    setModalOpen(true)
    void checkInventoryShoeImageStatus({ sku: item.sku, shoeName: item.shoe_name })
  }

  const openAddShoe = () => {
    setEditingShoe(null)
    setShoeForm(EMPTY_SHOE_ITEM)
    setShoeImageFile(null)
    setShoeImageUrl('')
    setShoeImagePreview('')
    setShoeSaveError(null)
    setShoeModalOpen(true)
  }

  const closeInventoryModal = () => {
    setModalOpen(false)
    setEditing(null)
    setItemShoeImageInfo(null)
    setItemShoeImageFile(null)
    setItemShoeImageUrl('')
    setItemShoeImagePreview('')
    setSaveError(null)
  }

  const closeShoeModal = () => {
    setShoeModalOpen(false)
    setEditingShoe(null)
    setShoeImageFile(null)
    setShoeImageUrl('')
    setShoeImagePreview('')
    setShoeSaveError(null)
  }

  const openEditShoe = (shoe) => {
    setEditingShoe(shoe)
    setShoeForm({
      sku: shoe.sku ?? '',
      name: shoe.name ?? '',
      brand: shoe.brand ?? '',
      image_url: shoe.image_url ?? '',
    })
    setShoeImageFile(null)
    setShoeImageUrl('')
    setShoeImagePreview('')
    setShoeSaveError(null)
    setShoeModalOpen(true)
  }

  const setField = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))
  const getPreferredInventoryBrand = (fallbackBrand = '') => {
    const explicitBrand = String(form.brand || '').trim()
    return explicitBrand || String(fallbackBrand || '').trim()
  }
  const setInventoryShoeImageFile = (file) => {
    setItemShoeImageFile(file)
    setItemShoeImageUrl('')
    if (!file) {
      setItemShoeImagePreview('')
    }
  }
  const setInventoryShoeImageFromUrl = (url) => {
    setItemShoeImageFile(null)
    setItemShoeImageUrl(url)
    setItemShoeImagePreview(url)
  }
  const setTag = (tag) => setForm(f => ({
    ...f,
    tags: f.tags.includes(tag) ? f.tags.filter((item) => item !== tag) : [...f.tags, tag],
  }))
  const toggleSizeFilterChip = (size) => {
    setSelectedSizeFilters((current) => (
      current.includes(size)
        ? current.filter((item) => item !== size)
        : [...current, size].sort(sortSizeValues)
    ))
  }
  const setBulkField = (idx, field) => (e) => {
    setBulkItems(items => items.map((item, i) => (i === idx ? { ...item, [field]: e.target.value } : item)))
  }
  const setShoeField = (field) => (e) => setShoeForm(f => ({ ...f, [field]: e.target.value }))
  const setShoeImageFileDirect = (file) => {
    setShoeImageFile(file)
    setShoeImageUrl('')
    if (!file) {
      setShoeImagePreview('')
    }
  }
  const setShoeImageFromUrl = (url) => {
    setShoeImageFile(null)
    setShoeImageUrl(url)
    setShoeImagePreview(url)
  }
  const addBulkItem = () => setBulkItems(items => [...items, { ...EMPTY_BULK_ITEM }])
  const removeBulkItem = (idx) => setBulkItems(items => items.length === 1 ? items : items.filter((_, i) => i !== idx))
  const checkInventoryShoeImageStatus = async ({ sku, shoeName }) => {
    const trimmedSku = String(sku || '').trim()
    const trimmedName = String(shoeName || '').trim()

    if (!trimmedSku) {
      setItemShoeImageInfo(null)
      return
    }

    try {
      const shoe = await getShoeBySku(trimmedSku)
      setItemShoeImageInfo({
        sku: shoe?.sku || trimmedSku,
        name: shoe?.name || trimmedName,
        brand: shoe?.brand || '',
        hasImage: Boolean(shoe?.exact_match && shoe?.image_url),
        exists: Boolean(shoe?.exact_match),
        imageUrl: shoe?.exact_match ? (shoe?.image_url || '') : '',
        exactMatch: Boolean(shoe?.exact_match),
      })
    } catch {
      const inferredBrand = inferBrandFromSku(trimmedSku)
      setItemShoeImageInfo({
        sku: trimmedSku,
        name: trimmedName,
        brand: inferredBrand,
        hasImage: false,
        exists: false,
        imageUrl: '',
        exactMatch: false,
      })
    }
  }
  const autofillPurchaseCostFromSku = async (sku) => {
    if (editing) return
    if (!sku) return
    try {
      const costsData = await getPurchaseCosts({ sku }).catch(() => ({ costs: [], listed_price: null }))
      const costs = costsData.costs || []
      setAvailablePurchaseCosts(costs)
      if (form.listed_price === '' && costsData?.listed_price != null) {
        setForm(prev => (
          prev.listed_price !== ''
            ? prev
            : { ...prev, listed_price: String(costsData.listed_price) }
        ))
      }
      if (form.purchase_cost !== '') return  // don't overwrite what the user typed
      if (costs.length === 1) {
        setForm(prev => ({ ...prev, purchase_cost: String(costs[0]) }))
      } else if (costs.length === 0) {
        const suggestion = await getPricingSuggestion({ sku })
        const estimated = suggestion?.estimated_purchase_cost
        if (estimated != null) {
          setForm(prev => ({ ...prev, purchase_cost: String(estimated) }))
        }
      }
      // costs.length > 1 → leave blank, user picks from selector
    } catch {
      // Non-blocking
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    try {
      if (editing) {
        const payload = {
          ...form,
          size: form.size !== '' ? Number(form.size) : undefined,
          purchase_cost: form.purchase_cost !== '' ? Number(form.purchase_cost) : undefined,
          listed_price: form.listed_price !== '' ? Number(form.listed_price) : null,
          notes: tagsFromFormValue(form.tags).length ? JSON.stringify(tagsFromFormValue(form.tags)) : '',
        }
        await updateInventoryItem(editing.inventory_id, payload)
        if ((itemShoeImageFile || itemShoeImageUrl) && payload.sku && payload.shoe_name) {
          try {
            const preferredBrand = getPreferredInventoryBrand(itemShoeImageInfo?.brand)
            if (itemShoeImageFile) {
              const formData = new FormData()
              formData.append('sku', String(payload.sku).trim())
              formData.append('name', String(payload.shoe_name).trim())
              formData.append('image', itemShoeImageFile)
              if (preferredBrand) formData.append('brand', preferredBrand)
              await ensureShoeWithImage(formData)
            } else {
              await ensureShoe({
                sku: String(payload.sku).trim(),
                name: String(payload.shoe_name).trim(),
                brand: preferredBrand,
                image_url: itemShoeImageUrl,
              })
            }
          } catch (uploadErr) {
            setError(uploadErr?.response?.data?.error || 'Inventory item saved, but shoe image upload failed.')
          }
        }
        closeInventoryModal()
        await refreshQuickSizeOptions()
        fetchData()
      } else if (bulkMode) {
        const basePayload = {
          sku: form.sku.trim(),
          shoe_name: form.shoe_name.trim(),
          status: form.status,
          brand: form.brand.trim(),
          purchase_cost: form.purchase_cost !== '' ? Number(form.purchase_cost) : undefined,
          listed_price: form.listed_price !== '' ? Number(form.listed_price) : undefined,
          date_purchased: form.date_purchased,
          source: form.source.trim(),
          notes: tagsFromFormValue(form.tags).length ? JSON.stringify(tagsFromFormValue(form.tags)) : '',
        }
        const items = []
        for (const row of bulkItems) {
          const size = Number(row.size)
          const quantity = Number.parseInt(row.quantity, 10)
          if (!Number.isFinite(size)) {
            setSaveError('Size must be a valid number.')
            setSaving(false)
            return
          }
          if (!Number.isInteger(quantity) || quantity < 1) {
            setSaveError('Each quantity must be a positive integer.')
            setSaving(false)
            return
          }
          items.push({ size, quantity })
        }
        if (!items.length) {
          setSaveError('Add at least one size row.')
          setSaving(false)
          return
        }
        await createInventoryItems({ ...basePayload, items })
        if ((itemShoeImageFile || itemShoeImageUrl) && basePayload.sku && basePayload.shoe_name) {
          try {
            const preferredBrand = getPreferredInventoryBrand(itemShoeImageInfo?.brand)
            if (itemShoeImageFile) {
              const formData = new FormData()
              formData.append('sku', String(basePayload.sku).trim())
              formData.append('name', String(basePayload.shoe_name).trim())
              formData.append('image', itemShoeImageFile)
              if (preferredBrand) formData.append('brand', preferredBrand)
              await ensureShoeWithImage(formData)
            } else {
              await ensureShoe({
                sku: String(basePayload.sku).trim(),
                name: String(basePayload.shoe_name).trim(),
                brand: preferredBrand,
                image_url: itemShoeImageUrl,
              })
            }
          } catch (uploadErr) {
            setError(uploadErr?.response?.data?.error || 'Inventory item saved, but shoe image upload failed.')
          }
        }
        closeInventoryModal()
        await refreshQuickSizeOptions()
        fetchData()
      } else {
        const payload = {
          ...form,
          size: form.size !== '' ? Number(form.size) : undefined,
          purchase_cost: form.purchase_cost !== '' ? Number(form.purchase_cost) : undefined,
          listed_price: form.listed_price !== '' ? Number(form.listed_price) : undefined,
          notes: tagsFromFormValue(form.tags).length ? JSON.stringify(tagsFromFormValue(form.tags)) : '',
        }
        await createInventoryItem(payload)
        if ((itemShoeImageFile || itemShoeImageUrl) && payload.sku && payload.shoe_name) {
          try {
            const preferredBrand = getPreferredInventoryBrand(itemShoeImageInfo?.brand)
            if (itemShoeImageFile) {
              const formData = new FormData()
              formData.append('sku', String(payload.sku).trim())
              formData.append('name', String(payload.shoe_name).trim())
              formData.append('image', itemShoeImageFile)
              if (preferredBrand) formData.append('brand', preferredBrand)
              await ensureShoeWithImage(formData)
            } else {
              await ensureShoe({
                sku: String(payload.sku).trim(),
                name: String(payload.shoe_name).trim(),
                brand: preferredBrand,
                image_url: itemShoeImageUrl,
              })
            }
          } catch (uploadErr) {
            setError(uploadErr?.response?.data?.error || 'Inventory item saved, but shoe image upload failed.')
          }
        }
        closeInventoryModal()
        await refreshQuickSizeOptions()
        fetchData()
      }
    } catch (err) {
      setSaveError(err?.response?.data?.error || err?.response?.data?.errors?.join(', ') || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete ${item.shoe_name || item.sku || 'this item'}? This action cannot be undone.`)) return
    try {
      await deleteInventoryItem(item.inventory_id)
      await refreshQuickSizeOptions()
      fetchData()
    } catch (err) {
      setError(err?.response?.data?.error || 'Delete failed')
    }
  }

  const handleExport = () => {
    fetchAllInventoryForExport()
      .then(data => exportToCsv('inventory-export.csv', data, INVENTORY_CSV_COLUMNS))
      .catch((err) => setError(err?.response?.data?.error || 'Failed to export inventory data'))
  }

  const toggleSellingSelection = (inventoryId) => {
    setSelectedSellingIds((current) => (
      current.includes(inventoryId)
        ? current.filter((id) => id !== inventoryId)
        : [...current, inventoryId]
    ))
  }

  const toggleSelectAllSellable = () => {
    const allEligibleIds = sellableItems.map((item) => item.inventory_id)
    if (selectedSellableCount === allEligibleIds.length && allEligibleIds.length > 0) {
      setSelectedSellingIds((current) => current.filter((id) => !sellableItemIds.has(id)))
      return
    }
    setSelectedSellingIds((current) => {
      const next = new Set(current)
      allEligibleIds.forEach((id) => next.add(id))
      return Array.from(next)
    })
  }

  useEffect(() => {
    if (activeView !== 'selling') return
    const visibleIds = new Set(sellingRows.map((item) => item.inventory_id))
    setSelectedSellingIds((current) => {
      const next = current.filter((id) => visibleIds.has(id))
      return next.length === current.length ? current : next
    })
    // sellingRowIdsKey is a stable string proxy for sellingRows' id set — the
    // only part of sellingRows this effect reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, sellingRowIdsKey])

  const formatSellingExportSizeLabel = (item, sizeBase = 'us') => {
    const normalized = normalizeSizeValue(item?.size)
    if (!normalized) return ''
    const baseLabel = formatSizeLabel(normalized)
    const womensLabel = isWomensInventoryItem(item) ? `${baseLabel}W` : toWomensSizeLabel(normalized)

    if (sizeBase === 'womens') {
      if (isWomensInventoryItem(item)) return womensLabel
      return `${baseLabel} (${womensLabel})`
    }

    if (isWomensInventoryItem(item)) {
      const usValue = normalizeSizeValue(Number(normalized) - 1.5)
      return `${womensLabel} (${formatSizeLabel(usValue)} US)`
    }

    return baseLabel
  }

  const buildSellingCsvRows = (selectedItems, { showQuantity = true, sizeBase = 'us' } = {}) => {
    const grouped = new Map()

    selectedItems.forEach((item) => {
      const tags = parseInventoryTags(item.notes)
      const key = [
        item.image_url || '',
        item.sku || '',
        item.shoe_name || '',
        item.brand || '',
        item.listed_price ?? '',
        tags.join(' | '),
      ].join('||')

      if (!grouped.has(key)) {
        grouped.set(key, {
          image: item.image_url || '',
          sku: item.sku || '',
          shoe_name: item.shoe_name || '',
          brand: item.brand || '',
          listed_price: item.listed_price != null ? parseFloat(item.listed_price) : '',
          tags_notes: tags.join(', '),
          sizeCounts: new Map(),
        })
      }

      const group = grouped.get(key)
      const sizeLabel = formatSellingExportSizeLabel(item, sizeBase)
      group.sizeCounts.set(sizeLabel, (group.sizeCounts.get(sizeLabel) || 0) + 1)
    })

    return Array.from(grouped.values()).map((group) => ({
      image: group.image,
      sku: group.sku,
      shoe_name: group.shoe_name,
      brand: group.brand,
      available_sizes: Array.from(group.sizeCounts.entries())
        .sort((a, b) => sortSizeValues(a[0], b[0]))
        .map(([size, quantity]) => showQuantity ? `${size} - ${quantity}` : size)
        .join(', '),
      listed_price: group.listed_price,
      tags_notes: group.tags_notes,
    }))
  }

  const handleExportSellingWorkbook = async () => {
    const selectedItems = sellingRows.filter((item) => selectedSellingIds.includes(item.inventory_id) && item.status === 'Available' && item.listed_price != null)
    if (!selectedItems.length) {
      setError('Select at least one available item with a listed price to export a selling Excel file.')
      return
    }
    setSellingExportBusy(true)
    setError(null)
    try {
      const rows = buildSellingCsvRows(selectedItems, {
        showQuantity: sellingExportShowQuantity,
        sizeBase: sellingExportSizeBase,
      })
      await exportSellingWorkbook('inventory-selling-export.xlsx', rows, {
        showQuantity: sellingExportShowQuantity,
      })
    } catch (err) {
      setError(err?.message || 'Failed to export selling Excel file.')
    } finally {
      setSellingExportBusy(false)
    }
  }

  const openMarkSold = (item) => {
    setMarkingSoldItem(item)
    setMarkSoldForm({
      amount_made_php: item?.listed_price != null ? String(item.listed_price) : '',
    })
    setMarkSoldError(null)
    setMarkSoldOpen(true)
  }

  const closeMarkSold = () => {
    setMarkSoldOpen(false)
    setMarkingSoldItem(null)
    setMarkSoldForm(EMPTY_SOLD_FORM)
    setMarkSoldSaving(false)
    setMarkSoldError(null)
  }

  const handleConfirmMarkSold = async (e) => {
    e.preventDefault()
    if (!markingSoldItem) return

    const amountMadePhp = Number(markSoldForm.amount_made_php)
    if (!Number.isFinite(amountMadePhp) || amountMadePhp < 0) {
      setMarkSoldError('Enter a valid amount made in PHP.')
      return
    }

    setMarkSoldSaving(true)
    setMarkSoldError(null)

    try {
      const sale = await createSale({
        platform: 'In Person',
        sale_type: 'In Person',
        sku: markingSoldItem.sku,
        shoe_name: markingSoldItem.shoe_name,
        size: Number(markingSoldItem.size),
        sale_date: new Date().toISOString(),
        status: 'Completed',
        selling_price: null,
        amount_made: null,
        condition: null,
        box_condition: null,
        notes: buildInPersonSaleNotes(amountMadePhp),
      })

      await linkInventoryToSale(markingSoldItem.inventory_id, sale.sale_id)
      closeMarkSold()
      await refreshQuickSizeOptions()
      fetchData()
    } catch (err) {
      setMarkSoldError(err?.response?.data?.error || err?.response?.data?.errors?.join(', ') || 'Failed to mark item as sold.')
    } finally {
      setMarkSoldSaving(false)
    }
  }

  const handleSaveShoe = async (e) => {
    e.preventDefault()
    setShoeSaving(true)
    setShoeSaveError(null)
    try {
      const payload = {
        sku: shoeForm.sku.trim(),
        name: shoeForm.name.trim(),
        brand: shoeForm.brand.trim(),
      }
      if (!payload.sku || !payload.name) {
        throw new Error('SKU and Shoe Name are required.')
      }

      if (shoeImageFile) {
        const formData = new FormData()
        formData.append('sku', payload.sku)
        formData.append('name', payload.name)
        formData.append('brand', payload.brand)
        formData.append('image', shoeImageFile)
        await ensureShoeWithImage(formData)
      } else if (shoeImageUrl) {
        await ensureShoe({ ...payload, image_url: shoeImageUrl })
      } else {
        await ensureShoe(payload)
      }
      closeShoeModal()
      fetchData()
    } catch (err) {
      setShoeSaveError(err?.message || err?.response?.data?.error || 'Could not save shoe')
    } finally {
      setShoeSaving(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <TopBar title="Inventory" onRefresh={fetchData} loading={loading} />

      <div className="flex-1 p-4 space-y-6 sm:p-6">
        <div className="flex gap-2">
          <button
            onClick={() => { setActiveView('inventory'); setError(null) }}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${activeView === 'inventory' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
          >
            Inventory
          </button>
          <button
            onClick={() => { setActiveView('selling'); setError(null) }}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${activeView === 'selling' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
          >
            Selling
          </button>
          <button
            onClick={() => { setActiveView('shoes'); setError(null) }}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${activeView === 'shoes' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
          >
            Shoes
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {activeView === 'inventory' ? (
            <>
              <KPICard label="Total Items" value={inventorySummary?.total_items || 0} />
              <KPICard label="Available" value={inventorySummary?.by_status?.Available?.count || 0} valueClassName="text-green-600" />
              <KPICard label="Sold" value={inventorySummary?.by_status?.Sold?.count || 0} valueClassName="text-blue-600" />
              <KPICard label="Consigned" value={inventorySummary?.by_status?.Consigned?.count || 0} valueClassName="text-yellow-600" />
              <KPICard label="Total Cost Value" value={formatPHP(totalValue)} />
            </>
          ) : activeView === 'selling' ? (
            <>
              <KPICard label="Selected For Sale" value={selectedSellableCount} />
              <KPICard label="Total Revenue" value={formatPHP(selectedSellingRevenue)} valueClassName="text-emerald-600" />
              <KPICard label="Projected Profit" value={formatPHP(selectedSellingProfit)} valueClassName="text-indigo-600" />
              <KPICard label="Loaded Inventory Rows" value={sellingRows.length} />
              <KPICard label="Sellable With Price" value={sellableItems.length} valueClassName="text-amber-600" />
            </>
          ) : (
            <div className="col-span-full rounded-xl border border-gray-100 bg-white p-5 h-80">
              <h2 className="mb-3 font-display text-base uppercase tracking-wide text-gray-700">Shoes by Brand</h2>
              {shoeBrandData.length === 0 ? (
                <EmptyState title="No shoes" message="No shoes match this filter yet." />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={shoeBrandData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      innerRadius={45}
                      paddingAngle={2}
                    >
                      {shoeBrandData.map((entry, index) => (
                        <Cell
                          key={`shoe-brand-${entry.name}-${index}`}
                          fill={BRAND_COLORS[entry.name] || SHOE_CHART_FALLBACK[index % SHOE_CHART_FALLBACK.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <input type="text" placeholder="Search name or SKU…" value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 sm:w-auto" />
          {activeView === 'inventory' || activeView === 'selling' ? (
            <>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 sm:w-auto">
                <option value="">All Statuses</option>
                {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={sizeTypeFilter} onChange={e => setSizeTypeFilter(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 sm:w-auto">
                <option value="">All Types</option>
                <option value="mens">Standard / Mens</option>
                <option value="womens">Women's</option>
                <option value="kids">Kids (GS)</option>
              </select>
              <input
                type="number"
                step="0.5"
                min="1"
                placeholder="Size…"
                value={sizeFilter}
                onChange={e => setSizeFilter(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 sm:w-24"
              />
              {selectedSizeFilters.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedSizeFilters([])}
                  className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors sm:w-auto"
                >
                  Clear size chips
                </button>
              )}
              {activeView === 'inventory' && (
                <button onClick={handleExport}
                  className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors sm:w-auto">
                  Export CSV
                </button>
              )}
              {activeView === 'selling' && (
                <>
                  <button
                    type="button"
                    onClick={() => setSellingExportShowQuantity((current) => !current)}
                    className={`w-full rounded-lg border px-4 py-2 text-sm font-medium transition-colors sm:w-auto ${
                      sellingExportShowQuantity
                        ? 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                        : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {sellingExportShowQuantity ? 'Show quantity' : 'Hide quantity'}
                  </button>
                  <select value={sellingExportSizeBase} onChange={e => setSellingExportSizeBase(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 sm:w-auto">
                    <option value="us">Translate sizes: US</option>
                    <option value="womens">Translate sizes: Womens</option>
                  </select>
                  <button onClick={handleExportSellingWorkbook}
                    disabled={sellingExportBusy}
                    className="w-full rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-50 sm:w-auto">
                    {sellingExportBusy ? 'Exporting Selling Excel…' : 'Export Selling Excel'}
                  </button>
                </>
              )}
            </>
          ) : (
            <select value={shoeBrandFilter} onChange={e => setShoeBrandFilter(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 sm:w-auto">
              <option value="">All Brands</option>
              {ALL_BRANDS.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
            </select>
          )}
          <button onClick={activeView === 'shoes' ? openAddShoe : openAdd}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors sm:ml-auto sm:w-auto">
            {activeView === 'shoes' ? '+ Add Shoe' : '+ Add Item'}
          </button>
          {activeView !== 'shoes' && (
            <button onClick={() => setScannerOpen(true)}
              className="w-full rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 transition-colors sm:w-auto">
              ▤ Scan Barcode
            </button>
          )}
        </div>

        {(activeView === 'inventory' || activeView === 'selling') && (visibleQuickSizeOptions.length > 0 || !quickSizeOptionsLoaded) && (
          <div className="rounded-xl border border-gray-100 bg-white px-4 py-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              Quick size filter
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setQuickSizeMode('us')}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  quickSizeMode === 'us'
                    ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                US size
              </button>
              <button
                type="button"
                onClick={() => setQuickSizeMode('womens')}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  quickSizeMode === 'womens'
                    ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                Women size
              </button>
              {quickSizeMode === 'us' && (
                <button
                  type="button"
                  onClick={() => setIncludeWomenSizes((current) => !current)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    includeWomenSizes
                      ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  Include women sizes
                </button>
              )}
              <button
                type="button"
                onClick={() => setPsTdMode((current) => (current === 'include' ? 'exclude' : 'include'))}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  psTdMode === 'include'
                    ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                Include PS / TD sizes
              </button>
              <button
                type="button"
                onClick={() => setPsTdMode((current) => (current === 'only' ? 'exclude' : 'only'))}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  psTdMode === 'only'
                    ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                Only PS / TD sizes
              </button>
            </div>
            <div className="mb-2 text-[11px] text-gray-500">
              {quickSizeMode === 'us'
                ? 'US size mode matches mens and GS directly. When enabled, women pairs match chip size plus 1.5.'
                : 'Women size mode only shows women pairs and matches the exact women size on the shoe.'} PS / TD is detected from the shoe name.
            </div>
            <div className="flex flex-wrap gap-2">
              {visibleQuickSizeOptions.map((option) => {
                const active = selectedSizeFilters.includes(option.value)
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleSizeFilterChip(option.value)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      active
                        ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {option.label}
                  </button>
                )
              })}
              {!visibleQuickSizeOptions.length && (
                <span className="text-xs text-gray-400">Loading sizes…</span>
              )}
            </div>
          </div>
        )}

        <div className="rounded-xl shadow-sm border border-gray-100 bg-white overflow-hidden">
          {loading ? <LoadingSpinner className="py-12" />
          : error ? <p className="p-6 text-sm text-red-500">{error}</p>
          : activeView === 'inventory'
          ? (!inventoryRows.length ? <EmptyState title="No inventory items" message="Try adjusting your filters." />
          : (
            <div className="overflow-x-auto">
              <div className="border-b border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                Showing page {inventoryPage} of {inventoryPages} • {inventoryRows.length} rows on this page • {inventoryVisibleTotal} visible rows • {inventorySummary?.total_items || 0} total matching items
              </div>
              <table className="w-full text-xs sm:text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {[
                      'SKU', 'Shoe Name', 'Brand', 'Size', 'Status', 'Purchase Cost', 'Listed Price', 'Date Purchased',
                      'Source', 'Linked Sale',
                      ...(hasInventoryTags ? ['Tags'] : []),
                      ''
                    ].map(col => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {inventoryRows.map((item, idx) => {
                    const aging = item.status === 'Available' && isOldItem(item.date_purchased)
                    return (
                      <tr key={item.inventory_id || idx} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">{item.sku || '—'}</td>
                        <td className="px-4 py-3 max-w-xs">
                          <span className="font-medium text-gray-900 truncate block">{item.shoe_name || '—'}</span>
                          {aging && (
                            <span className="text-xs text-orange-600 font-medium">
                              Aging ({Math.floor((Date.now() - new Date(item.date_purchased).getTime()) / 86400000)}d)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{item.brand || '—'}</td>
                        <td className="px-4 py-3 text-gray-500">{item.size || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[item.status] || 'bg-gray-100 text-gray-600'}`}>
                            {item.status || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{item.purchase_cost != null ? formatPHP(item.purchase_cost) : '—'}</td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          {item.listed_price != null ? (
                            formatPHP(item.listed_price)
                          ) : (
                            item.status === 'Available' ? (
                              <button
                                type="button"
                                onClick={() => openEdit(item)}
                                className="text-xs font-medium text-amber-700 hover:text-amber-900"
                              >
                                Add price
                              </button>
                            ) : '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(item.date_purchased)}</td>
                        <td className="px-4 py-3 text-gray-500">{item.source || '—'}</td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">{item.linked_sale_id || '—'}</td>
                        {hasInventoryTags && (
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              {(parseInventoryTags(item.notes) || []).map((tag) => (
                                <span key={`${item.inventory_id}-${tag}`} className="inline-flex rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {item.status === 'Available' && (
                              <button onClick={() => openMarkSold(item)} className="text-xs text-emerald-600 hover:text-emerald-800 font-medium">Mark as Sold</button>
                            )}
                            <button onClick={() => openEdit(item)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Edit</button>
                            <button onClick={() => handleDelete(item)} className="text-xs text-red-600 hover:text-red-800 font-medium">Delete</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="flex items-center justify-between border-t border-gray-100 bg-white px-4 py-3 text-xs text-gray-600">
                <span>
                  Page {inventoryPage} of {inventoryPages}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setInventoryPage((page) => Math.max(1, page - 1))}
                    disabled={inventoryPage <= 1}
                    className="rounded-lg border border-gray-200 px-3 py-2 font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setInventoryPage((page) => Math.min(inventoryPages, page + 1))}
                    disabled={inventoryPage >= inventoryPages}
                    className="rounded-lg border border-gray-200 px-3 py-2 font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          ))
          : activeView === 'selling'
          ? (!sellingRows.length ? <EmptyState title="No selling inventory" message="Try adjusting your filters." />
          : (
            <div className="overflow-x-auto">
              <div className="flex flex-col gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-600 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div>
                    Choose inventory rows to include in the selling Excel export. Only available items with a listed price can be selected.
                  </div>
                  <div className="text-[11px] text-gray-500">
                    Loaded {sellingRows.length} matching rows with no page cap.
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={toggleSelectAllSellable}
                    className="font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    {sellableItems.length > 0 && selectedSellableCount === sellableItems.length ? 'Clear selection' : 'Select all sellable'}
                  </button>
                  <span>{selectedSellableCount} selected</span>
                </div>
              </div>
              <table className="w-full text-xs sm:text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {[
                      '', 'SKU', 'Shoe Name', 'Brand', 'Size', 'Status', 'Purchase Cost', 'Listed Price', 'Potential Profit', 'Date Purchased',
                      'Source', 'Linked Sale',
                      ...(sellingHasInventoryTags ? ['Tags'] : []),
                      ''
                    ].map(col => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {sellingRows.map((item, idx) => {
                    const aging = item.status === 'Available' && isOldItem(item.date_purchased)
                    const isSellable = item.status === 'Available' && item.listed_price != null
                    const isSelected = selectedSellingIds.includes(item.inventory_id)
                    const rowProfit = (parseFloat(item.listed_price || 0) || 0) - (parseFloat(item.purchase_cost || 0) || 0)
                    return (
                      <tr key={item.inventory_id || idx} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={!isSellable}
                            onChange={() => toggleSellingSelection(item.inventory_id)}
                            title={isSellable ? 'Include in selling Excel export' : 'Only available items with listed prices can be exported'}
                            className="h-4 w-4 accent-indigo-600 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">{item.sku || '—'}</td>
                        <td className="px-4 py-3 max-w-xs">
                          <span className="font-medium text-gray-900 truncate block">{item.shoe_name || '—'}</span>
                          {aging && (
                            <span className="text-xs text-orange-600 font-medium">
                              Aging ({Math.floor((Date.now() - new Date(item.date_purchased).getTime()) / 86400000)}d)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{item.brand || '—'}</td>
                        <td className="px-4 py-3 text-gray-500">{item.size || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[item.status] || 'bg-gray-100 text-gray-600'}`}>
                            {item.status || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{item.purchase_cost != null ? formatPHP(item.purchase_cost) : '—'}</td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          {item.listed_price != null ? (
                            formatPHP(item.listed_price)
                          ) : (
                            item.status === 'Available' ? (
                              <button
                                type="button"
                                onClick={() => openEdit(item)}
                                className="text-xs font-medium text-amber-700 hover:text-amber-900"
                              >
                                Add price
                              </button>
                            ) : '—'
                          )}
                        </td>
                        <td className={`px-4 py-3 whitespace-nowrap ${rowProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          {item.listed_price != null ? formatPHP(rowProfit) : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(item.date_purchased)}</td>
                        <td className="px-4 py-3 text-gray-500">{item.source || '—'}</td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">{item.linked_sale_id || '—'}</td>
                        {sellingHasInventoryTags && (
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              {(parseInventoryTags(item.notes) || []).map((tag) => (
                                <span key={`${item.inventory_id}-${tag}`} className="inline-flex rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {item.status === 'Available' && (
                              <button onClick={() => openMarkSold(item)} className="text-xs text-emerald-600 hover:text-emerald-800 font-medium">Mark as Sold</button>
                            )}
                            <button onClick={() => openEdit(item)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Edit</button>
                            <button onClick={() => handleDelete(item)} className="text-xs text-red-600 hover:text-red-800 font-medium">Delete</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))
          : (!shoes.length ? <EmptyState title="No shoes" message="Try adjusting your filters." />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['Image', 'SKU', 'Brand', 'Shoe Name', ''].map(col => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {shoes.map((shoe, idx) => (
                    <tr key={shoe.shoe_id || idx} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        {shoe.image_url ? (
                          <img
                            src={shoe.image_url}
                            alt={shoe.name || shoe.sku || 'Shoe'}
                            className="h-24 w-24 rounded-lg border border-gray-200 bg-gray-100 object-cover"
                          />
                        ) : (
                          <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-400">
                            No Image
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">{shoe.sku || '—'}</td>
                      <td className="px-4 py-3 text-gray-700">{shoe.brand || '—'}</td>
                      <td className="px-4 py-3 text-gray-900 max-w-xs">{shoe.name || '—'}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => openEditShoe(shoe)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>

      {scannerOpen && (
        <BarcodeScannerModal
          onClose={() => setScannerOpen(false)}
          onItemAdded={async () => {
            await refreshQuickSizeOptions()
            fetchData()
          }}
        />
      )}

      {modalOpen && (
        <Modal title={editing ? `Edit — ${editing.shoe_name}` : 'Add Inventory Item'} onClose={closeInventoryModal}>
          <form onSubmit={handleSave} className="space-y-4">
            <Field label="Shoe Name">
              <input
                type="text"
                required
                value={form.shoe_name}
                onChange={setField('shoe_name')}
                onBlur={() => checkInventoryShoeImageStatus({ sku: form.sku, shoeName: form.shoe_name })}
                className={INPUT}
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Brand">
                <select value={form.brand} onChange={setField('brand')} className={INPUT}>
                  <option value="">Auto-detect / Other</option>
                  {ALL_BRANDS.map(brand => <option key={brand} value={brand}>{brand}</option>)}
                </select>
              </Field>
              <Field label="SKU">
                <input
                  type="text"
                  required
                  value={form.sku}
                  onChange={(e) => {
                    setField('sku')(e)
                    setItemShoeImageInfo(null)
                    setItemShoeImageFile(null)
                    setItemShoeImagePreview('')
                  }}
                  onBlur={async () => {
                    const sku = String(form.sku || '').trim()
                     if (!sku) return
                     try {
                       const shoe = await getShoeBySku(sku)
                      const inferredBrand = inferBrandFromSku(sku)
                      setForm((prev) => ({
                        ...prev,
                        shoe_name: String(prev.shoe_name || '').trim()
                          ? prev.shoe_name
                          : (shoe?.name || ''),
                        brand: String(prev.brand || '').trim()
                          ? prev.brand
                          : (shoe?.brand || inferredBrand || ''),
                      }))
                      setItemShoeImageInfo({
                        sku: shoe?.sku || sku,
                        name: shoe?.name || form.shoe_name || '',
                        brand: getPreferredInventoryBrand(shoe?.brand || inferredBrand || ''),
                        hasImage: Boolean(shoe?.exact_match && shoe?.image_url),
                        exists: Boolean(shoe?.exact_match),
                        imageUrl: shoe?.exact_match ? (shoe?.image_url || '') : '',
                        exactMatch: Boolean(shoe?.exact_match),
                      })
                     } catch {
                       // no-op: allow adding new model without existing shoe row
                      const inferredBrand = inferBrandFromSku(sku)
                      setForm((prev) => (prev.brand ? prev : { ...prev, brand: inferredBrand }))
                      setItemShoeImageInfo({
                        sku,
                        name: form.shoe_name || '',
                        brand: inferredBrand,
                        hasImage: false,
                        exists: false,
                        imageUrl: '',
                        exactMatch: false,
                      })
                     }
                     await autofillPurchaseCostFromSku(sku)
                    }}
                    className={INPUT}
                  />
              </Field>
              {!editing ? (
                <Field label="Bulk add sizes">
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={bulkMode}
                      onChange={(e) => setBulkMode(e.target.checked)}
                    />
                    Add multiple sizes in one go
                  </label>
                </Field>
              ) : (
                <Field label="Size">
                  <input type="number" step="0.5" required value={form.size} onChange={setField('size')} className={INPUT} />
                </Field>
              )}
              {!editing && !bulkMode ? (
                <Field label="Size">
                  <input type="number" step="0.5" required value={form.size} onChange={setField('size')} className={INPUT} />
                </Field>
              ) : null}
            </div>

            {form.sku.trim() && itemShoeImageInfo && !itemShoeImageInfo.hasImage && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-900">
                  {itemShoeImageInfo.exists
                    ? 'This shoe record does not have an image yet.'
                    : 'No shoe image was found for this SKU yet.'}
                </p>
                <p className="mt-1 text-xs text-amber-800">
                  Uploading here will save the image to the shoe database while you save this inventory item.
                </p>
                <div className="mt-3">
                  <ImageDropInput
                    previewUrl={itemShoeImagePreview || itemShoeImageInfo.imageUrl}
                    onFileChange={setInventoryShoeImageFile}
                    onImageUrl={setInventoryShoeImageFromUrl}
                  />
                </div>
              </div>
            )}

            {!editing && bulkMode && (
              <div className="space-y-3 border border-gray-100 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-600">Size / Quantity Rows</p>
                  <button type="button" onClick={addBulkItem} className="text-xs text-indigo-700 hover:text-indigo-900 font-medium">
                    + Add row
                  </button>
                </div>
                {bulkItems.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label={`Size #${idx + 1}`}>
                      <input
                        type="number"
                        step="0.5"
                        required
                        value={row.size}
                        onChange={setBulkField(idx, 'size')}
                        className={INPUT}
                      />
                    </Field>
                    <Field label="Quantity">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        required
                        value={row.quantity}
                        onChange={setBulkField(idx, 'quantity')}
                        className={INPUT}
                      />
                    </Field>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => removeBulkItem(idx)}
                        className="mb-2 rounded-lg border border-red-200 text-red-700 px-3 py-2 text-xs hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!editing && availablePurchaseCosts.length > 1 && (
              <Field label="Recorded Purchase Costs for this SKU">
                <select
                  value={form.purchase_cost}
                  onChange={setField('purchase_cost')}
                  className={INPUT}
                >
                  <option value="">— Pick a recorded cost —</option>
                  {availablePurchaseCosts.map(cost => (
                    <option key={cost} value={cost}>{formatPHP(cost)}</option>
                  ))}
                </select>
              </Field>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={!editing && availablePurchaseCosts.length > 1 ? 'Or enter a custom cost (PHP)' : 'Purchase Cost (PHP)'}>
                <input type="number" step="0.01" required value={form.purchase_cost} onChange={setField('purchase_cost')} className={INPUT} />
              </Field>
              <Field label="Listed Price (PHP)">
                <input type="number" step="0.01" value={form.listed_price} onChange={setField('listed_price')} className={INPUT} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Date Purchased">
                <input type="datetime-local" required value={form.date_purchased} onChange={setField('date_purchased')} className={INPUT} />
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={setField('status')} className={INPUT}>
                  {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Source">
              <input type="text" value={form.source} onChange={setField('source')} placeholder="e.g. Shopee, Nike PH" className={INPUT} />
            </Field>
            <Field label="Tags">
              <div className="flex flex-wrap gap-2">
                {INVENTORY_TAG_OPTIONS.map((tag) => {
                  const active = form.tags.includes(tag)
                  return (
                    <button
                      type="button"
                      key={tag}
                      onClick={() => setTag(tag)}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        active
                          ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {tag}
                    </button>
                  )
                })}
              </div>
            </Field>
            {saveError && <p className="text-sm text-red-500">{saveError}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={closeInventoryModal}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {shoeModalOpen && (
        <Modal title={editingShoe ? `Edit Shoe — ${editingShoe.sku}` : 'Add Shoe'} onClose={closeShoeModal}>
          <form onSubmit={handleSaveShoe} className="space-y-4">
            <Field label="Shoe Name">
              <input
                type="text"
                required
                value={shoeForm.name}
                onChange={setShoeField('name')}
                className={INPUT}
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Brand">
                <select value={shoeForm.brand} onChange={setShoeField('brand')} className={INPUT}>
                  <option value="">Auto-detect / Other</option>
                  {ALL_BRANDS.map(brand => <option key={brand} value={brand}>{brand}</option>)}
                </select>
              </Field>
              <Field label="SKU">
                <input
                  type="text"
                  required
                  value={shoeForm.sku}
                  onChange={setShoeField('sku')}
                  className={INPUT}
                />
              </Field>
            </div>
            <Field label="Shoe Image">
              <ImageDropInput
                previewUrl={shoeImagePreview || shoeForm.image_url}
                onFileChange={setShoeImageFileDirect}
                onImageUrl={setShoeImageFromUrl}
              />
            </Field>
            {shoeSaveError && <p className="text-sm text-red-500">{shoeSaveError}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={closeShoeModal}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={shoeSaving}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                {shoeSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {markSoldOpen && markingSoldItem && (
        <Modal title={`Mark as Sold — ${markingSoldItem.shoe_name || markingSoldItem.sku}`} onClose={closeMarkSold}>
          <form onSubmit={handleConfirmMarkSold} className="space-y-4">
            <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-600">
              This will create a completed sale tagged as <span className="font-medium text-gray-900">In Person</span> and link this exact inventory item.
            </div>
            <Field label="Amount Made (PHP)">
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={markSoldForm.amount_made_php}
                onChange={(e) => setMarkSoldForm((current) => ({ ...current, amount_made_php: e.target.value }))}
                className={INPUT}
              />
            </Field>
            {markSoldError && <p className="text-sm text-red-500">{markSoldError}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeMarkSold}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={markSoldSaving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {markSoldSaving ? 'Saving...' : 'Confirm'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
