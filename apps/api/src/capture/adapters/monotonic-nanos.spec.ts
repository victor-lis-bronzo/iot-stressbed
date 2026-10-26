import { createMonotonicNanos } from './monotonic-nanos';

describe('createMonotonicNanos', () => {
  const at = new Date('2026-10-25T12:00:00.000Z');
  const baseNs = BigInt(at.getTime()) * 1_000_000n;

  it('converts a Date to nanoseconds since the epoch', () => {
    expect(createMonotonicNanos()(at)).toBe(baseNs.toString());
  });

  it('keeps timestamps unique when the same millisecond repeats (the flood case)', () => {
    const next = createMonotonicNanos();
    const stamps = Array.from({ length: 1000 }, () => BigInt(next(at)));

    expect(new Set(stamps).size).toBe(1000);
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]).toBeGreaterThan(stamps[i - 1]);
    }
    expect(stamps[999]).toBe(baseNs + 999n);
  });

  it('jumps back to the real clock once it moves past the counter', () => {
    const next = createMonotonicNanos();
    next(at);
    next(at);
    const later = new Date(at.getTime() + 5);

    expect(next(later)).toBe((BigInt(later.getTime()) * 1_000_000n).toString());
  });

  it('never goes backwards if the clock reads earlier than a previous point', () => {
    const next = createMonotonicNanos();
    const first = BigInt(next(new Date(at.getTime() + 10)));
    const second = BigInt(next(at));

    expect(second).toBeGreaterThan(first);
  });

  it('keeps independent counters per generator', () => {
    const a = createMonotonicNanos();
    const b = createMonotonicNanos();
    a(at);
    a(at);

    expect(b(at)).toBe(baseNs.toString());
  });
});
