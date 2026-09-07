'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { removeToken } from '../lib/auth';
import { Activity, ShieldAlert, Cpu, Settings, LogOut } from 'lucide-react';

const navItems = [
  { name: 'Dashboard', href: '/dashboard', icon: Activity },
  { name: 'Interceptação', href: '/interception', icon: ShieldAlert },
  { name: 'Console de Ataque', href: '/attack', icon: Cpu },
  { name: 'Sensores', href: '/sensors', icon: Settings },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === '/login') {
    return <>{children}</>;
  }

  const handleLogout = () => {
    removeToken();
    router.push('/login');
  };

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-zinc-900">
      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-zinc-800 border-r border-gray-200 dark:border-zinc-700 hidden md:flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-gray-200 dark:border-zinc-700">
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">IoT StressBed</h1>
        </div>
        
        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center px-2 py-2 text-sm font-medium rounded-md ${
                  isActive
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-100'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-zinc-700 dark:hover:text-white'
                }`}
              >
                <item.icon
                  className={`mr-3 flex-shrink-0 h-5 w-5 ${
                    isActive ? 'text-blue-700 dark:text-blue-100' : 'text-gray-400 group-hover:text-gray-500 dark:text-gray-400'
                  }`}
                  aria-hidden="true"
                />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-200 dark:border-zinc-700">
          <button
            onClick={handleLogout}
            className="flex items-center w-full px-2 py-2 text-sm font-medium text-red-600 rounded-md hover:bg-red-50 dark:text-red-400 dark:hover:bg-zinc-700"
          >
            <LogOut className="mr-3 h-5 w-5" />
            Sair
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700 md:hidden flex items-center justify-between px-4">
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">IoT StressBed</h1>
        </header>
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-zinc-900">
          {children}
        </div>
      </main>
    </div>
  );
}
