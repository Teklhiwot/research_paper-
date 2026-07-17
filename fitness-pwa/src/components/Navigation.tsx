import { Link, useLocation } from 'react-router-dom';
import { useDarkMode } from '../hooks';
import {
  HomeIcon,
  FireIcon,
  ScaleIcon,
  ChartBarIcon,
  CogIcon,
  MoonIcon,
  SunIcon,
} from './Icons';

export default function Navigation() {
  const location = useLocation();
  const { isDark, toggleDarkMode } = useDarkMode();

  const isActive = (path: string) => location.pathname === path;

  const navItems = [
    { path: '/', label: 'Dashboard', icon: HomeIcon },
    { path: '/workout', label: 'Workout', icon: FireIcon },
    { path: '/weight', label: 'Weight', icon: ScaleIcon },
    { path: '/statistics', label: 'Stats', icon: ChartBarIcon },
    { path: '/settings', label: 'Settings', icon: CogIcon },
  ];

  return (
    <nav className="hidden md:flex flex-col w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 p-6 shadow-sm">
      {/* Logo */}
      <div className="mb-8 pb-6 border-b border-slate-200 dark:border-slate-800">
        <h1 className="text-2xl font-bold text-blue-600 dark:text-blue-400">FitnessPWA</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Your personal coach</p>
      </div>

      {/* Navigation Items */}
      <div className="flex-1 space-y-2">
        {navItems.map(({ path, label, icon: Icon }) => (
          <Link
            key={path}
            to={path}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
              isActive(path)
                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Icon className="w-5 h-5" />
            <span>{label}</span>
          </Link>
        ))}
      </div>

      {/* Dark mode toggle */}
      <button
        onClick={toggleDarkMode}
        className="mt-8 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
        aria-label="Toggle dark mode"
      >
        {isDark ? (
          <>
            <SunIcon className="w-5 h-5" />
            <span>Light Mode</span>
          </>
        ) : (
          <>
            <MoonIcon className="w-5 h-5" />
            <span>Dark Mode</span>
          </>
        )}
      </button>
    </nav>
  );
}
