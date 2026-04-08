import { NavLink } from 'react-router-dom'

const navItems = [
  {
    to: '/',
    label: 'Dashboard',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    to: '/sales',
    label: 'Sales',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    to: '/inventory',
    label: 'Inventory',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
  },
  {
    to: '/financial',
    label: 'Financial',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M11.25 3.75l.53 2.16a2 2 0 001.97 1.56h2.09a2 2 0 011.9 2.56l-.5 2.16a2 2 0 01-.57 1.03l-1.53 1.53a2 2 0 000 2.83l1.53 1.53a2 2 0 01.57 1.03l.5 2.16a2 2 0 01-1.9 2.56h-2.1a2 2 0 00-1.96 1.57l-.53 2.16a2 2 0 01-1.9 1.56h-2.1a2 2 0 01-1.9-1.56l-.53-2.16A2 2 0 007.17 18.5H5.08a2 2 0 01-1.9-2.56l.5-2.16a2 2 0 01.57-1.03L5.3 11.5a2 2 0 000-2.83L3.77 7.14A2 2 0 013.2 6.11l-.5-2.16A2 2 0 014.6 1.39H6.7A2 2 0 008.67 3zm1.75 6.75a3.25 3.25 0 100 6.5 3.25 3.25 0 000-6.5z" />
      </svg>
    ),
  },
]

export default function Sidebar({ isOpen = false, onClose = () => {} }) {
  return (
    <aside
      className={`${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      } fixed left-0 top-0 bottom-0 z-40 flex w-72 max-w-[85vw] min-w-0 flex-col overflow-hidden bg-gray-900 text-white transition-transform duration-200 lg:translate-x-0 lg:z-10`}
    >
      {/* Logo */}
      <div className="flex items-center justify-between gap-2 px-6 py-5 border-b border-gray-800">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
          <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <span className="text-lg font-bold tracking-tight">aCount</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-700 px-2 py-1 text-sm text-gray-200 lg:hidden"
          aria-label="Close navigation"
        >
        </button>
      </div>

      {/* Nav */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`
            }
            onClick={onClose}
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-gray-800">
        <p className="text-xs text-gray-500">Sneaker Resale Accounting</p>
      </div>
    </aside>
  )
}


