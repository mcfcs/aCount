export default function KPICard({ label, value, subtitle, valueClassName = '' }) {
  return (
    <div className="rounded-xl shadow-sm border border-gray-100 bg-white p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold text-gray-900 ${valueClassName}`}>{value}</p>
      {subtitle && <p className="mt-1 text-xs text-gray-400">{subtitle}</p>}
    </div>
  )
}
