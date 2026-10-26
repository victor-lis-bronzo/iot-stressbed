import { BadRequestException } from '@nestjs/common';
import { paramsToArgs } from './params-to-args';

describe('paramsToArgs', () => {
  it('turns numbers and strings into --flag value pairs', () => {
    expect(paramsToArgs({ connections: 200, mode: 'giant' })).toEqual([
      '--connections',
      '200',
      '--mode',
      'giant',
    ]);
  });

  it('keeps decimals and negative numbers as values', () => {
    expect(paramsToArgs({ interval: 0.1, offset: -5 })).toEqual([
      '--interval',
      '0.1',
      '--offset',
      '-5',
    ]);
  });

  it('keeps hyphenated flag names as given (size-bytes -> --size-bytes)', () => {
    expect(paramsToArgs({ 'size-bytes': 1000000 })).toEqual([
      '--size-bytes',
      '1000000',
    ]);
  });

  it('true becomes a bare flag; false and null are omitted', () => {
    expect(paramsToArgs({ verbose: true, quiet: false, skip: null })).toEqual([
      '--verbose',
    ]);
  });

  it('returns no args for empty, null or undefined params', () => {
    expect(paramsToArgs({})).toEqual([]);
    expect(paramsToArgs(null)).toEqual([]);
    expect(paramsToArgs(undefined)).toEqual([]);
  });

  it.each(['--host', 'Connections', 'a b', '1x', '', 'a;b', '../x'])(
    'rejects the flag name %p',
    (key) => {
      expect(() => paramsToArgs({ [key]: 1 })).toThrow(BadRequestException);
    },
  );

  it.each([[{ a: 1 }], [[1, 2]], [Number.NaN], [Infinity]])(
    'rejects non-scalar or non-finite value %p',
    (value) => {
      expect(() => paramsToArgs({ rate: value })).toThrow(BadRequestException);
    },
  );
});
