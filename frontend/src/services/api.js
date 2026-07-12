import axios from 'axios'

const client = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
    // Sent only when configured; the backend enforces it when API_KEY is set.
    ...(import.meta.env.VITE_API_KEY ? { 'X-API-Key': import.meta.env.VITE_API_KEY } : {}),
  },
})

// Dashboard
export const getDashboardSummary = () => client.get('/dashboard/summary').then(r => r.data)
export const getDashboardAlerts = () => client.get('/dashboard/alerts').then(r => r.data)

// Sales
export const getSales = (params = {}) => client.get('/sales', { params }).then(r => r.data)
export const getSalesSummary = (params = {}) => client.get('/sales/summary', { params }).then(r => r.data)
export const getPricingSuggestion = (params = {}) => client.get('/sales/pricing-suggestion', { params }).then(r => r.data)
export const createSale = (data) => client.post('/sales', data).then(r => r.data)
export const updateSale = (id, data) => client.patch(`/sales/${id}`, data).then(r => r.data)
export const deleteSale = (id) => client.delete(`/sales/${id}`).then(r => r.data)
export const unmatchSale = (id) => client.post(`/sales/${id}/unmatch`).then(r => r.data)

// Inventory
export const getShoes = (params = {}) => client.get('/shoes', { params }).then(r => r.data)
export const getInventory = (params = {}) => client.get('/inventory', { params }).then(r => r.data)
export const getInventorySummary = (params = {}) => client.get('/inventory/summary', { params }).then(r => r.data)
export const createInventoryItem = (data) => client.post('/inventory', data).then(r => r.data)
export const createInventoryItems = (data) => client.post('/inventory/bulk', data).then(r => r.data)
export const updateInventoryItem = (id, data) => client.patch(`/inventory/${id}`, data).then(r => r.data)
export const deleteInventoryItem = (id) => client.delete(`/inventory/${id}`).then(r => r.data)
export const linkInventoryToSale = (inventoryId, saleId) => client.post(`/inventory/${inventoryId}/link-sale/${saleId}`).then(r => r.data)
export const getPurchaseCosts = (params = {}) => client.get('/inventory/purchase-costs', { params }).then(r => r.data)
export const getShoeBySku = (sku) => client.get(`/shoes/by-sku/${encodeURIComponent(sku)}`).then(r => r.data)
export const ensureShoe = (data) => client.post('/shoes/ensure', data).then(r => r.data)
export const ensureShoeWithImage = (formData) => client.post('/shoes/ensure', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
}).then(r => r.data)

// Barcode scanning
export const lookupBarcode = (code) => client.get(`/barcodes/lookup/${encodeURIComponent(code)}`).then(r => r.data)
export const confirmBarcodeAdd = (data) => client.post('/barcodes/confirm', data).then(r => r.data)

// Bank Transfers
export const getBankTransfers = (params = {}) => client.get('/bank-transfers', { params }).then(r => r.data)
export const getBankTransfersSummary = () => client.get('/bank-transfers/summary').then(r => r.data)
export const createBankTransfer = (data) => client.post('/bank-transfers', data).then(r => r.data)
export const updateBankTransfer = (id, data) => client.patch(`/bank-transfers/${id}`, data).then(r => r.data)
export const deleteBankTransfer = (id) => client.delete(`/bank-transfers/${id}`).then(r => r.data)

// Expenses
export const getExpenses = (params = {}) => client.get('/expenses', { params }).then(r => r.data)
export const getExpensesSummary = () => client.get('/expenses/summary').then(r => r.data)
export const createExpense = (data) => client.post('/expenses', data).then(r => r.data)
export const updateExpense = (id, data) => client.patch(`/expenses/${id}`, data).then(r => r.data)
export const deleteExpense = (id) => client.delete(`/expenses/${id}`).then(r => r.data)

// Subscriptions
export const getSubscriptions = (params = {}) => client.get('/subscriptions', { params }).then(r => r.data)
export const createSubscription = (data) => client.post('/subscriptions', data).then(r => r.data)
export const updateSubscription = (id, data) => client.patch(`/subscriptions/${id}`, data).then(r => r.data)
export const deleteSubscription = (id) => client.delete(`/subscriptions/${id}`).then(r => r.data)

// Email Log
export const getEmailLog = (params = {}) => client.get('/email-log', { params }).then(r => r.data)

// Shipping Labels
export const getLabels = (params = {}) => client.get('/labels', { params }).then(r => r.data)
export const refreshLabels = (limit = 10) => client.post('/labels/refresh', { limit }).then(r => r.data)
// Returns the full axios response so callers can read the PDF blob (r.data)
// and the X-Labels-Skipped header.
export const printLabels = (payload) => client.post('/labels/print', payload, { responseType: 'blob' })

// Settings
export const scrapeEmails = (payload) => client.post('/gmail/scrape', payload).then(r => r.data)
export const getScrapeStatus = () => client.get('/gmail/scrape-status').then(r => r.data)
export const cancelScrape = () => client.post('/gmail/scrape-cancel').then(r => r.data)
export const resetDatabase = (payload) => client.post('/settings/reset', payload).then(r => r.data)
export const getPhpRate = () => client.get('/settings/php-rate').then(r => r.data)
export const setPhpRate = (payload) => client.put('/settings/php-rate', payload).then(r => r.data)

export default client
