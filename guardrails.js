export const DEFAULT_GUARDRAILS = {
  maxConsecutiveFailures: 4,
  maxConsecutiveResamples: 6,
  relaxCycles: 2,
  relaxedMinStartEndMeters: 1000,
};

export function updateGuardrails(state, event, limits = DEFAULT_GUARDRAILS) {
  const next = {
    consecutiveFailures: state?.consecutiveFailures ?? 0,
    consecutiveResamples: state?.consecutiveResamples ?? 0,
    relaxCyclesRemaining: state?.relaxCyclesRemaining ?? 0,
  };

  if (event === "success") {
    next.consecutiveFailures = 0;
    next.consecutiveResamples = 0;
  } else if (event === "failure") {
    next.consecutiveFailures += 1;
  } else if (event === "resample") {
    next.consecutiveResamples += 1;
  }

  let triggered = false;
  if (
    next.consecutiveFailures >= limits.maxConsecutiveFailures ||
    next.consecutiveResamples >= limits.maxConsecutiveResamples
  ) {
    triggered = true;
    next.consecutiveFailures = 0;
    next.consecutiveResamples = 0;
    next.relaxCyclesRemaining = Math.max(next.relaxCyclesRemaining, limits.relaxCycles);
  }

  return { state: next, triggered };
}
