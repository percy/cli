// Maestro `runScript` step. Maestro flushes runScript stdout before
// advancing to the next command, so the harness uses this sentinel as
// the deterministic "the upcoming extendedWaitUntil step is now executing"
// signal. See ../pause-30s-flow.yaml + ../../README.md.
console.log('PERCY_PAUSE_BEGIN');
