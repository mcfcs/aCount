export default function KPICard({ label, value, subtitle, valueClassName = '' }) {
  return (
    <div className="group relative h-full overflow-hidden rounded-xl border border-gray-100 bg-white p-5 transition-all duration-300 hover:border-indigo-400/60 hover:-translate-y-0.5">
      {/* accent edge that ignites on hover */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-indigo-600 to-transparent opacity-40 transition-opacity duration-300 group-hover:opacity-100" />
      <span className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-indigo-600/0 blur-2xl transition-all duration-500 group-hover:bg-indigo-600/20" />

      <p className="kicker flex items-center gap-2">
        <span className="inline-block h-1 w-1 rounded-full bg-gray-400 transition-colors duration-300 group-hover:bg-indigo-600" />
        {label}
      </p>
      <p className={`mt-3 font-mono text-2xl font-bold tracking-tight text-gray-900 tabular-nums ${valueClassName}`}>
        {value}
      </p>
      {subtitle && <p className="mt-1 text-xs text-gray-400">{subtitle}</p>}
    </div>
  )
}
