// Serializer that survives arbitrary `meta` shapes AND redacts secret
// material during the single traversal. See DPR-6 / DPR-19 in the plan.
//
// Handles:
//   - Circular refs          -> "[Circular]"
//   - Error instances        -> { name, message, stack }
//   - Buffers                -> { type: 'Buffer', base64 }
//   - BigInt                 -> string
//   - Function / Symbol      -> dropped
//   - Every string value     -> redactString(value)
//
// Never throws out to the caller — fail-open falls back to a sanitized
// placeholder so write-path code never loses a log entry to a serializer bug.

import { redactString } from './redact.js';

export function safeReplacer () {
  const seen = new WeakSet();
  return function (_key, value) {
    // String values get redacted inline — this is the DPR-6 deep-redaction
    // guarantee: every string, no matter how deep in the tree, is scrubbed.
    if (typeof value === 'string') return redactString(value);
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'bigint') return value.toString();
      if (typeof value === 'function' || typeof value === 'symbol') return undefined;
      return value;
    }
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    if (value instanceof Error) {
      // message + stack strings run through redactString on the next pass.
      return { name: value.name, message: value.message, stack: value.stack };
    }
    // Buffer.toJSON() fires BEFORE the replacer in JSON.stringify, yielding
    // { type: 'Buffer', data: [...bytes] }. Convert that shape to base64.
    if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
      return { type: 'Buffer', base64: Buffer.from(value.data).toString('base64') };
    }
    // Defense-in-depth: if we ever get a real Buffer here (e.g. caller
    // passed it as the top-level value and no toJSON fired), handle it.
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
      return { type: 'Buffer', base64: value.toString('base64') };
    }
    return value;
  };
}

// Produce a JSON string that is safe to persist. On internal failure, returns
// a sanitized placeholder rather than the raw input (DPR-19 — prevents an
// unserializable object with embedded secrets from being String()'d to disk).
export function safeStringify (obj) {
  try {
    return JSON.stringify(obj, safeReplacer());
  } catch (_) {
    /* istanbul ignore next */
    return JSON.stringify({
      _unstringifiable: true,
      typeName: Object.prototype.toString.call(obj)
    });
  }
}

// Return a plain-JSON clone of `meta` with all strings redacted and all
// unserializable values reduced to placeholders. In-memory caches hold the
// sanitized object so `query()` callers never see raw references.
export function sanitizeMeta (meta) {
  if (meta == null || typeof meta !== 'object') return meta;
  try { return JSON.parse(safeStringify(meta)); } catch (_) {
    /* istanbul ignore next */
    return {};
  }
}
