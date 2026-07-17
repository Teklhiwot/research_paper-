import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useDarkMode } from '../hooks';
import Navigation from './Navigation';
import MobileBottomNav from './MobileBottomNav';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { isDark } = useDarkMode();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <div className={`min-h-screen w-full ${isDark ? 'dark' : ''}`}>
      <div className="flex h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
        {!isMobile && <Navigation />}
        <main className="flex-1 overflow-auto pb-20 md:pb-0">
          {children}
        </main>
        {isMobile && <MobileBottomNav />}
      </div>
    </div>
  );
}
