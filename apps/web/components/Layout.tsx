'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Activity, ShieldAlert, Cpu, Settings, LogOut, type LucideIcon } from 'lucide-react';

interface NavItem {
  name: string;
  icon: LucideIcon;
  href?: string;
  availableFrom?: string;
}

const navItems: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: Activity },
  { name: 'Interceptação', href: '/interceptacao', icon: ShieldAlert },
  { name: 'Console de Ataque', icon: Cpu, availableFrom: 'Fase 4' },
  { name: 'Sensores', href: '/sensors', icon: Settings },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === '/login') {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen bg-base font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-panel border-r border-border hidden md:flex flex-col">
        <div className="h-14 flex items-center px-5 border-b border-border">
          <h1 className="text-sm font-semibold tracking-tight text-primary">IoT StressBed</h1>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-px overflow-y-auto">
          {navItems.map((item) => {
            if (!item.href) {
              return (
                <span
                  key={item.name}
                  aria-disabled="true"
                  title={`Disponível na ${item.availableFrom}`}
                  className="flex cursor-not-allowed items-center gap-3 rounded border-l-2 border-transparent px-3 py-2 text-sm text-muted opacity-40"
                >
                  <item.icon className="h-4 w-4 flex-shrink-0 text-muted" aria-hidden="true" />
                  {item.name}
                </span>
              );
            }

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
            onClick={() => signOut({ redirectTo: '/login' })}
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
