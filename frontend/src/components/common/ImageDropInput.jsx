import { useRef, useState } from 'react'

const DROPZONE =
  'rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600 transition-colors'

function extractImageUrl(text) {
  const value = String(text || '').trim()
  if (!value) return ''

  const srcMatch = value.match(/src=["']([^"']+)["']/i)
  const candidate = srcMatch ? srcMatch[1] : value
  if (/^https?:\/\//i.test(candidate)) return candidate
  return ''
}

async function readDropPayload(event) {
  const files = Array.from(event.dataTransfer?.files || [])
  const imageFile = files.find((file) => String(file.type || '').startsWith('image/'))
  if (imageFile) {
    return { file: imageFile, imageUrl: '' }
  }

  const uriList = event.dataTransfer?.getData('text/uri-list')
  const html = event.dataTransfer?.getData('text/html')
  const plain = event.dataTransfer?.getData('text/plain')
  const imageUrl = extractImageUrl(uriList) || extractImageUrl(html) || extractImageUrl(plain)
  return { file: null, imageUrl }
}

export default function ImageDropInput({
  previewUrl,
  onFileChange,
  onImageUrl,
}) {
  const inputRef = useRef(null)
  const [dragActive, setDragActive] = useState(false)

  const handleFiles = (file) => {
    onFileChange?.(file || null)
  }

  const handleUrl = (url) => {
    if (!url) return
    onImageUrl?.(url)
  }

  return (
    <div className="space-y-3">
      <div
        className={`${DROPZONE} ${dragActive ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={(event) => {
          event.preventDefault()
          setDragActive(false)
        }}
        onDrop={async (event) => {
          event.preventDefault()
          setDragActive(false)
          const { file, imageUrl } = await readDropPayload(event)
          if (file) {
            handleFiles(file)
            return
          }
          if (imageUrl) {
            handleUrl(imageUrl)
          }
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-gray-800">Drop an image here</p>
            <p className="text-xs text-gray-500">
              Supports local files, dragged browser images, and dropped image URLs.
            </p>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
          >
            Choose File
          </button>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
        onChange={(event) => handleFiles(event.target.files?.[0] || null)}
        className="hidden"
      />

      {previewUrl && (
        <div className="mt-3">
          <img
            src={previewUrl}
            alt="Shoe preview"
            className="h-32 w-32 rounded-lg border border-gray-200 bg-gray-100 object-cover"
          />
        </div>
      )}
    </div>
  )
}
