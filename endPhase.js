export function stepEndPhase(state, dtMs, config) {
  let phase = state.phase;
  let phaseT = state.phaseT + dtMs;
  let done = false;

  const nextPhase = () => {
    if (phase === 'end-hold') phase = 'end-trace';
    else if (phase === 'end-trace') phase = 'end-glow';
    else done = true;
  };

  while (!done) {
    const limit =
      phase === 'end-hold'
        ? config.endHoldMs
        : phase === 'end-trace'
          ? config.endTraceMs
          : config.endGlowMs;

    if (limit <= 0) {
      nextPhase();
      continue;
    }

    if (phaseT < limit) break;

    phaseT -= limit;
    nextPhase();
  }

  return { phase, phaseT, done };
}
