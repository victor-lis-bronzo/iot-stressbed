import { fireEvent, render, screen } from '@testing-library/react';
import { useActiveRun, useLaunchRun } from '@/hooks/useExperimentRuns';
import InjectionForm from './InjectionForm';

jest.mock('@/hooks/useExperimentRuns', () => ({
  useActiveRun: jest.fn(),
  useLaunchRun: jest.fn(),
  describeLaunchError: (error: unknown) => `erro: ${(error as Error).message}`,
}));

const mutate = jest.fn();

function mockLaunch(overrides: Record<string, unknown> = {}) {
  (useLaunchRun as jest.Mock).mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  });
}

describe('InjectionForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useActiveRun as jest.Mock).mockReturnValue({ data: null });
    mockLaunch();
  });

  it('launches an injection against plain with no params by default', () => {
    render(<InjectionForm />);

    fireEvent.click(screen.getByRole('button', { name: /disparar injeção/i }));

    expect(mutate).toHaveBeenCalledWith({ mode: 'plain', attackType: 'injection', params: {} });
  });

  it('sends the chosen target and numeric --count/--interval', () => {
    render(<InjectionForm />);
    fireEvent.change(screen.getByLabelText(/^alvo$/i), { target: { value: 'secure' } });
    fireEvent.change(screen.getByLabelText(/--count/), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/--interval/), { target: { value: '0.1' } });

    fireEvent.click(screen.getByRole('button', { name: /disparar injeção/i }));

    expect(mutate).toHaveBeenCalledWith({
      mode: 'secure',
      attackType: 'injection',
      params: { count: 5, interval: 0.1 },
    });
    expect(
      screen.getByText('./scripts/run-experiment.sh injection secure -- --count 5 --interval 0.1'),
    ).toBeInTheDocument();
  });

  it('is disabled with an alert while there is an active run', () => {
    (useActiveRun as jest.Mock).mockReturnValue({
      data: { id: 'run-1', mode: 'plain', attackType: 'injection' },
    });

    render(<InjectionForm />);

    expect(screen.getByRole('button', { name: /disparar injeção/i })).toBeDisabled();
    expect(screen.getByLabelText(/^alvo$/i)).toBeDisabled();
    expect(screen.getByText(/já existe uma run ativa/i)).toBeInTheDocument();
  });

  it('disables the button while launching and shows an error from the backend', () => {
    mockLaunch({ isPending: true });
    const { unmount } = render(<InjectionForm />);
    expect(screen.getByRole('button', { name: /disparando/i })).toBeDisabled();
    unmount();

    mockLaunch({ isError: true, error: new Error('boom') });
    render(<InjectionForm />);
    expect(screen.getByText('erro: boom')).toBeInTheDocument();
  });
});
