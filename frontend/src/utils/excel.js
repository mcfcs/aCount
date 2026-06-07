// exceljs is large (~1MB) and only needed when a user actually exports an Excel
// workbook. It is imported dynamically so it stays out of the initial bundle.

function arrayBufferToBase64(buffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function extensionFromContentType(contentType = '') {
  const normalized = String(contentType).toLowerCase()
  if (normalized.includes('png')) return 'png'
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpeg'
  if (normalized.includes('gif')) return 'gif'
  if (normalized.includes('webp')) return 'png'
  return 'png'
}

async function fetchImageAsBase64(url) {
  if (!url) return null
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const buffer = await response.arrayBuffer()
    const contentType = response.headers.get('content-type') || 'image/png'
    return {
      base64: `data:${contentType};base64,${arrayBufferToBase64(buffer)}`,
      extension: extensionFromContentType(contentType),
    }
  } catch {
    return null
  }
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export async function exportSellingWorkbook(filename, rows, options = {}) {
  const { showQuantity = true } = options
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'aCount'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Selling List', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  sheet.columns = [
    { header: 'Image', key: 'image', width: 18 },
    { header: 'Sku', key: 'sku', width: 18 },
    { header: 'Shoe Name', key: 'shoe_name', width: 36 },
    { header: 'Brand', key: 'brand', width: 18 },
    { header: showQuantity ? 'Available Sizes and quantity' : 'Available Sizes', key: 'available_sizes', width: 28 },
    { header: 'Listed Price (PHP)', key: 'listed_price', width: 18 },
    { header: 'Tags / Notes', key: 'tags_notes', width: 30 },
  ]

  const headerRow = sheet.getRow(1)
  headerRow.height = 24
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1D4ED8' },
  }
  headerRow.eachCell((cell) => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFC7D2FE' } },
      left: { style: 'thin', color: { argb: 'FFC7D2FE' } },
      bottom: { style: 'thin', color: { argb: 'FFC7D2FE' } },
      right: { style: 'thin', color: { argb: 'FFC7D2FE' } },
    }
  })

  for (const rowData of rows) {
    const row = sheet.addRow({
      image: rowData.image ? ' ' : 'No image',
      sku: rowData.sku,
      shoe_name: rowData.shoe_name,
      brand: rowData.brand,
      available_sizes: rowData.available_sizes,
      listed_price: rowData.listed_price,
      tags_notes: rowData.tags_notes,
    })
    row.height = 72
    row.alignment = { vertical: 'middle', wrapText: true }

    row.eachCell((cell, colNumber) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      }
      if (row.number % 2 === 0) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' },
        }
      }
      if (colNumber === 2) {
        cell.font = { bold: true, color: { argb: 'FF111827' } }
      }
    })

    row.getCell('E').value = String(rowData.available_sizes || '')
    row.getCell('E').numFmt = '@'
    row.getCell('E').alignment = { vertical: 'middle', wrapText: true }
    row.getCell('F').numFmt = '"PHP" #,##0.00'
    row.getCell('F').value = Number(rowData.listed_price || 0)
    row.getCell('F').alignment = { vertical: 'middle', horizontal: 'right' }
    row.getCell('A').alignment = { vertical: 'middle', horizontal: 'center' }

    if (rowData.image) {
      const imageData = await fetchImageAsBase64(rowData.image)
      if (imageData) {
        const imageId = workbook.addImage({
          base64: imageData.base64,
          extension: imageData.extension,
        })
        sheet.addImage(imageId, {
          tl: { col: 0.15, row: row.number - 0.85 },
          ext: { width: 76, height: 76 },
          editAs: 'oneCell',
        })
      } else {
        row.getCell('A').value = 'Image unavailable'
        row.getCell('A').font = { italic: true, color: { argb: 'FF6B7280' } }
      }
    } else {
      row.getCell('A').font = { italic: true, color: { argb: 'FF9CA3AF' } }
    }
  }

  sheet.autoFilter = {
    from: 'A1',
    to: 'G1',
  }

  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(filename, new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
}
