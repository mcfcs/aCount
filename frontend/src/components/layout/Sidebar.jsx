import { NavLink } from 'react-router-dom'

const navItems = [
  {
    to: '/',
    label: 'Dashboard',
    icon: (
      <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    to: '/sales',
    label: 'Sales',
    icon: (
      <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    to: '/inventory',
    label: 'Inventory',
    icon: (
      <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
  },
  {
    to: '/financial',
    label: 'Financial',
    icon: (
      <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    to: '/labels',
    label: 'Labels',
    icon: (
      <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M7 4v3H4a1 1 0 00-1 1v10a1 1 0 001 1h16a1 1 0 001-1V8a1 1 0 00-1-1h-3V4M7 4h10M7 4v0m10 0v0M8 11h8M8 15h5" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 4h1a1 1 0 011 1v2H6V5a1 1 0 011-1h1" />
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: (
      <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

export default function Sidebar({ isOpen = false, onClose = () => {} }) {
  return (
    <aside
      className={`${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      } fixed left-0 top-0 bottom-0 z-40 flex w-72 max-w-[85vw] min-w-0 flex-col overflow-hidden border-r border-[#1d1d23] bg-[#0c0c0e] transition-transform duration-300 lg:translate-x-0 lg:z-10`}
    >
      {/* accent seam down the inner edge */}
      <span className="pointer-events-none absolute right-0 top-0 h-full w-px bg-linear-to-b from-accent/40 via-transparent to-transparent" />

      {/* Brand */}
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-white shadow-[0_0_22px_-4px_rgba(177,77,255,0.8)]">
          <span className="font-display text-xl leading-none">₳</span>
        </div>
        <div className="min-w-0">
          <p className="font-display text-2xl uppercase leading-none text-[#f4f4f6]">aCount</p>
          <p className="kicker mt-1">Resale&nbsp;Ledger</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-md border border-[#2a2a31] px-2 py-1 text-xs text-gray-500 hover:text-[#f4f4f6] lg:hidden"
          aria-label="Close navigation"
        >
          ✕
        </button>
      </div>

      <div className="mx-6 mb-2 h-px bg-[#1d1d23]" />

      {/* Nav */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-1">
        {navItems.map((item, idx) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `group relative flex items-center gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${
                isActive
                  ? 'bg-accent/8 text-accent'
                  : 'text-[#74747f] hover:bg-[#ffffff]/4 hover:text-[#f4f4f6]'
              }`
            }
            onClick={onClose}
          >
            {({ isActive }) => (
              <>
                <span
                  className={`absolute left-0 top-1/2 h-5 w-0.75 -translate-y-1/2 rounded-r bg-accent transition-all duration-200 ${
                    isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'
                  }`}
                />
                <span className={`transition-colors ${isActive ? 'text-accent' : 'text-[#5a5a64] group-hover:text-[#f4f4f6]'}`}>
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                <span className="font-mono text-[10px] tabular-nums text-[#3f3f48] group-hover:text-[#6a6a76]">
                  {String(idx + 1).padStart(2, '0')}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-[#1d1d23] px-6 py-5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-60 animate-accent-pulse" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          <p className="kicker">System&nbsp;Live</p>
        </div>
        <p className="mt-2 text-xs text-[#56565f]">Sneaker resale accounting</p>
      </div>
    </aside>
  )
}
