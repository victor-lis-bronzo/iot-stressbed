'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getToken } from '../lib/auth';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const token = getToken();
    if (!token && pathname !== '/login') {
      router.push('/login');
    } else {
      setIsAuthenticated(!!token);
    }
  }, [pathname, router]);

  // Don't render anything while checking auth, unless we are on the login page
  if (pathname === '/login') {
    return <>{children}</>;
  }

  if (isAuthenticated === null || !isAuthenticated) {
    return null; // or a loading spinner
  }

  return <>{children}</>;
}
