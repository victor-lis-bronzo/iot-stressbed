import { fireEvent, render, screen } from '@testing-library/react';
import { useActiveRun, useStopRun } from '@/hooks/useExperimentRuns';
import ActiveRunBanner from './ActiveRunBanner';

jest.mock('@/hooks/useExperimentRuns', () => ({
  useActiveRun: jest.fn(),
  useStopRun: jest.fn(),
}));

describe('ActiveRunBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when there is no active run', () => {
    (useActiveRun as jest.Mock).mockReturnValue({ data: null });
    (useStopRun as jest.Mock).mockReturnValue({ mutate: jest.fn(), isPending: false });

    const { container } = render(<ActiveRunBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the active run and stops it on click', () => {
    const mutate = jest.fn();
    (useActiveRun as jest.Mock).mockReturnValue({
      data: {
        id: 'run-1',
        mode: 'plain',
        attackType: 'connection-flood',
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: null,
        params: null,
        notes: null,
      },
    });
    (useStopRun as jest.Mock).mockReturnValue({ mutate, isPending: false });

    render(<ActiveRunBanner />);

    expect(screen.getByText(/connection-flood contra plain/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /parar run/i }));
    expect(mutate).toHaveBeenCalled();
  });
});
