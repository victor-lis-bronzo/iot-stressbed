import { fireEvent, render, screen } from '@testing-library/react';
import { useActiveRun, useStartAttack, useStopRun } from '@/hooks/useExperimentRuns';
import AttackForm from './AttackForm';

jest.mock('@/hooks/useExperimentRuns', () => ({
  useActiveRun: jest.fn(),
  useStartAttack: jest.fn(),
  useStopRun: jest.fn(),
}));

describe('AttackForm', () => {
  const startMutate = jest.fn();
  const stopMutate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useActiveRun as jest.Mock).mockReturnValue({ data: null });
    (useStartAttack as jest.Mock).mockReturnValue({
      mutate: startMutate,
      isPending: false,
      error: null,
    });
    (useStopRun as jest.Mock).mockReturnValue({
      mutate: stopMutate,
      isPending: false,
      error: null,
    });
  });

  it('shows "Iniciar ataque" when there is no active run, and starts an attack with the built args when clicked', () => {
    render(<AttackForm />);

    const button = screen.getByRole('button', { name: /iniciar ataque/i });
    expect(button).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/--connections/), { target: { value: '250' } });
    fireEvent.click(button);

    expect(startMutate).toHaveBeenCalledWith({
      track: 'connection-flood',
      mode: 'plain',
      args: ['--connections', '250'],
    });
    expect(stopMutate).not.toHaveBeenCalled();
  });

  it('always includes --mode for malformed-payload, since the script requires it', () => {
    render(<AttackForm />);

    fireEvent.change(screen.getByLabelText(/^ataque$/i), { target: { value: 'malformed-payload' } });
    fireEvent.click(screen.getByRole('button', { name: /iniciar ataque/i }));

    expect(startMutate).toHaveBeenCalledWith({
      track: 'malformed-payload',
      mode: 'plain',
      args: ['--mode', 'giant'],
    });
  });

  it('shows "Parar ataque" and stops the run when there is an active run', () => {
    (useActiveRun as jest.Mock).mockReturnValue({
      data: { id: 'run-1', mode: 'plain', attackType: 'connection-flood' },
    });

    render(<AttackForm />);

    const button = screen.getByRole('button', { name: /parar ataque/i });
    fireEvent.click(button);

    expect(stopMutate).toHaveBeenCalledWith();
    expect(startMutate).not.toHaveBeenCalled();
  });

  it('disables the fields when there is an active run', () => {
    (useActiveRun as jest.Mock).mockReturnValue({
      data: { id: 'run-1', mode: 'plain', attackType: 'connection-flood' },
    });

    render(<AttackForm />);

    expect(screen.getByLabelText(/^ataque$/i)).toBeDisabled();
    expect(screen.getByText(/já existe uma run ativa/i)).toBeInTheDocument();
  });

  it('disables the toggle button while its mutation is pending', () => {
    (useStartAttack as jest.Mock).mockReturnValue({
      mutate: startMutate,
      isPending: true,
      error: null,
    });

    render(<AttackForm />);

    expect(screen.getByRole('button', { name: /iniciando/i })).toBeDisabled();
  });

  it('surfaces a mutation error inline', () => {
    (useStartAttack as jest.Mock).mockReturnValue({
      mutate: startMutate,
      isPending: false,
      error: new Error('Já existe uma run ativa'),
    });

    render(<AttackForm />);

    expect(screen.getByText('Já existe uma run ativa')).toBeInTheDocument();
  });
});
