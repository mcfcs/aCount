export default function LoadingSpinner({ size = 'md', className = '' }) {
  const sizes = {
    sm: 'h-4 w-4 border-2',
    md: 'h-8 w-8 border-[3px]',
    lg: 'h-12 w-12 border-4',
  }
  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <div
        className={`${sizes[size]} animate-spin rounded-full border-gray-200 border-t-indigo-600`}
        style={{ filter: 'drop-shadow(0 0 6px rgba(177,77,255,0.45))' }}
        role="status"
        aria-label="Loading"
      />
      {size !== 'sm' && <span className="kicker">Loading</span>}
    </div>
  )
}
