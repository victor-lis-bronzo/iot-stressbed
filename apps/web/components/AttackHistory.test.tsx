import { render, screen } from '@testing-library/react';
import { useDosRunHistory } from '@/hooks/useDosMetrics';
import AttackHistory from './AttackHistory';

jest.mock('@/hooks/useDosMetrics', () => ({
  useDosRunHistory: jest.fn(),
}));

describe('AttackHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows an empty state when there is no history', () => {
    (useDosRunHistory as jest.Mock).mockReturnValue({ data: [], isPending: false });

    render(<AttackHistory />);

    expect(screen.getByText(/nenhuma execução registrada/i)).toBeInTheDocument();
  });

  it('lists Track B runs from the history', () => {
    (useDosRunHistory as jest.Mock).mockReturnValue({
      data: [
        {
          runId: 'run-1',
          trackBAttackType: 'message-flood',
          attackStartedAt: '2026-01-01T00:00:00.000Z',
          trackBResult: { achieved_rate: 90 },
        },
      ],
      isPending: false,
    });

    render(<AttackHistory />);

    expect(screen.getByText('message-flood')).toBeInTheDocument();
    expect(screen.getByText('run-1')).toBeInTheDocument();
    expect(screen.getByText('Resultado registrado')).toBeInTheDocument();
  });
});
