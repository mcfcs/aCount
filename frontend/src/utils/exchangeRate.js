import { useEffect, useState } from 'react'

export const FX_RATE_STORAGE_KEY = 'acount_php_estimate_rate'
export const DEFAULT_PHP_ESTIMATE_RATE = 56
export const FX_RATE_CHANGED_EVENT = 'acount:php-rate-changed'

export const toPhpRateNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PHP_ESTIMATE_RATE
}

export const readPhpEstimateRate = () => {
  if (typeof window === 'undefined') return DEFAULT_PHP_ESTIMATE_RATE
  return toPhpRateNumber(window.localStorage.getItem(FX_RATE_STORAGE_KEY))
}

export const writePhpEstimateRate = (value) => {
  if (typeof window === 'undefined') return false

  const rate = toPhpRateNumber(value)
  if (!Number.isFinite(rate) || rate <= 0) return false

  window.localStorage.setItem(FX_RATE_STORAGE_KEY, String(rate))
  window.dispatchEvent(new CustomEvent(FX_RATE_CHANGED_EVENT, { detail: { rate } }))
  return true
}

export const formatPhpRate = (value) => {
  const rate = toPhpRateNumber(value)
  return `\u20b1${rate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / $1`
}

export const usdToPhp = (usdValue, rate) => {
  const parsed = Number.parseFloat(usdValue)
  const fxRate = toPhpRateNumber(rate)
  if (!Number.isFinite(parsed)) return null
  return parsed * fxRate
}

export const usePhpEstimateRate = () => {
  const [rate, setRate] = useState(() => readPhpEstimateRate())

  useEffect(() => {
    const onStorageRate = (event) => {
      if (event.key && event.key !== FX_RATE_STORAGE_KEY) return
      setRate(readPhpEstimateRate())
    }

    const onCustomRate = (event) => {
      const nextRate = event?.detail?.rate
      if (nextRate === undefined) return
      setRate(toPhpRateNumber(nextRate))
    }

    window.addEventListener('storage', onStorageRate)
    window.addEventListener(FX_RATE_CHANGED_EVENT, onCustomRate)
    return () => {
      window.removeEventListener('storage', onStorageRate)
      window.removeEventListener(FX_RATE_CHANGED_EVENT, onCustomRate)
    }
  }, [])

  return rate
}
