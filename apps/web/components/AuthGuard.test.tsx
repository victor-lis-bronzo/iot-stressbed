import { render } from '@testing-library/react';
import AuthGuard from './AuthGuard';

const push = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/dashboard',
}));

jest.mock('../lib/auth', () => ({
  getToken: jest.fn(),
}));

import { getToken } from '../lib/auth';

describe('AuthGuard', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('redirects to /login when there is no token', () => {
    (getToken as jest.Mock).mockReturnValue(null);

    render(
      <AuthGuard>
        <div>Protected content</div>
      </AuthGuard>
    );

    expect(push).toHaveBeenCalledWith('/login');
  });

  it('renders children when a token is present', () => {
    (getToken as jest.Mock).mockReturnValue('fake-token');

    const { getByText } = render(
      <AuthGuard>
        <div>Protected content</div>
      </AuthGuard>
    );

    expect(push).not.toHaveBeenCalled();
    expect(getByText('Protected content')).toBeInTheDocument();
  });
});
