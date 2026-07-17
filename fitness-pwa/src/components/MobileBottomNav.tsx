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

export default function MobileBottomNav() {
  const location = useLocation();
  const { isDark, toggleDarkMode } = useDarkMode();

  const isActive = (path: string) => location.pathname === path;

  const navItems = [
    { path: '/', label: 'Home', icon: HomeIcon },
    { path: '/workout', label: 'Workout', icon: FireIcon },
    { path: '/weight', label: 'Weight', icon: ScaleIcon },
    { path: '/statistics', label: 'Stats', icon: ChartBarIcon },
    { path: '/settings', label: 'Settings', icon: CogIcon },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 md:hidden bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-2 py-3 shadow-lg shadow-slate-900/5 dark:shadow-slate-950/20">
      <div className="flex justify-around items-center">
        {navItems.map(({ path, label, icon: Icon }) => (
          <Link
            key={path}
            to={path}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all duration-200 ${
              isActive(path)
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-slate-600 dark:text-slate-400'
            }`}
            title={label}
          >
            <Icon className="w-6 h-6" />
            <span className="text-xs font-medium">{label}</span>
          </Link>
        ))}
      </div>

      {/* Dark mode toggle - small version */}
      <button
        onClick={toggleDarkMode}
        className="absolute top-2 right-2 p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
        aria-label="Toggle dark mode"
      >
        {isDark ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}
      </button>
    </nav>
  );
}
