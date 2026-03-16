function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function getValue(obj, keyPath) {
  if (keyPath == null || obj == null) return ''
  return keyPath
    .split('.')
    .reduce((value, part) => (value == null ? '' : value[part]), obj)
}

export function exportToCsv(filename, rows, columns) {
  const safeColumns = Array.isArray(columns) ? columns : []
  const headerNames = safeColumns.map(col => csvEscape(col.label || col.key))
  const headerLine = headerNames.join(',')
  const allRows = (Array.isArray(rows) ? rows : [])
    .map((row) => safeColumns.map(col => csvEscape(getValue(row, col.key))).join(','))

  const csv = [headerLine, ...allRows].join('\r\n')
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
