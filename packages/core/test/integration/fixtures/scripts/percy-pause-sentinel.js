// Maestro `runScript` step. Maestro flushes runScript stdout before
// advancing to the next command, so the harnesses use this sentinel as
// the deterministic "the upcoming pause step is now executing" signal.
// Used by pause-30s-flow-ios.yaml + ios-aut-crash-regions.yaml.
console.log('PERCY_PAUSE_BEGIN');
