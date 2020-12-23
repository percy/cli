import { strict as assert } from 'assert';

// Percy assertions errors contain extra meta data and have specific lookup keys
// for different computed assertion error messages.
class PercyAssertionError extends Error {
  static dict = {
    'disallowed status': ({ status }) => `Disallowed response status [${status}]`,
    'is empty': () => 'Empty response',
    'is remote': () => 'Remote resource',
    'no response': () => 'No response',
    'too many bytes': ({ size }) => `Max file size exceeded [${size}]`,
    'too many widths': ({ widths }) => `Too many widths requested: maximum is 10, requested ${widths}`
  }

  constructor(lookup, meta = {}) {
    super(PercyAssertionError.dict[lookup]?.(meta) ?? lookup);
    this.name = this.constructor.name;
    this.meta = meta;
  }

  toString() {
    return this.message;
  }
}

// Wraps native assert to throw a Percy assertion error with optional meta.
export default function percyAssert(condition, lookup, meta) {
  assert(condition, new PercyAssertionError(lookup, meta));
}
