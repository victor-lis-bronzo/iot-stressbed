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
    <div className="flex h-screen bg-base font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-panel border-r border-border hidden md:flex flex-col">
        <div className="h-14 flex items-center px-5 border-b border-border">
          <h1 className="text-sm font-semibold tracking-tight text-primary">IoT StressBed</h1>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-px overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-3 rounded border-l-2 px-3 py-2 text-sm ${
                  isActive
                    ? 'border-border bg-base font-medium text-primary'
                    : 'border-transparent text-muted hover:bg-base hover:text-primary'
                }`}
              >
                <item.icon
                  className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-primary' : 'text-muted'}`}
                  aria-hidden="true"
                />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-2 border-t border-border">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded px-3 py-2 text-sm text-muted hover:bg-base hover:text-critical"
          >
            <LogOut className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            Sair
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 bg-panel border-b border-border md:hidden flex items-center justify-between px-4">
          <h1 className="text-sm font-semibold tracking-tight text-primary">IoT StressBed</h1>
        </header>
        <div className="flex-1 overflow-y-auto bg-base p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
