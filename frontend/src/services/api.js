import axios from 'axios'

const client = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Dashboard
export const getDashboardSummary = () => client.get('/dashboard/summary').then(r => r.data)
export const getDashboardAlerts = () => client.get('/dashboard/alerts').then(r => r.data)

// Sales
export const getSales = (params = {}) => client.get('/sales', { params }).then(r => r.data)
export const getSalesSummary = () => client.get('/sales/summary').then(r => r.data)

// Inventory
export const getInventory = (params = {}) => client.get('/inventory', { params }).then(r => r.data)

// Bank Transfers
export const getBankTransfers = (params = {}) => client.get('/bank-transfers', { params }).then(r => r.data)
export const getBankTransfersSummary = () => client.get('/bank-transfers/summary').then(r => r.data)

// Expenses
export const getExpenses = (params = {}) => client.get('/expenses', { params }).then(r => r.data)
export const getExpensesSummary = () => client.get('/expenses/summary').then(r => r.data)

// Subscriptions
export const getSubscriptions = () => client.get('/subscriptions').then(r => r.data)

// Email Log
export const getEmailLog = (params = {}) => client.get('/email-log', { params }).then(r => r.data)

export default client
