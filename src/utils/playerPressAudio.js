function getAudioContextCtor() {
  return window.AudioContext || window.webkitAudioContext || null;
}

export function shouldPlayPlayerPressWinnerTone({
  hasInitializedRuntime = false,
  previousWinnerPlayerId = null,
  nextWinnerPlayerId = null,
  localPlayerId = null,
}) {
  if (!hasInitializedRuntime) return false;
  if (!localPlayerId) return false;
  if (!nextWinnerPlayerId) return false;
  if (nextWinnerPlayerId !== localPlayerId) return false;
  return previousWinnerPlayerId !== localPlayerId;
}

export function getPlayerPressWinnerToneKey(runtime = null, localPlayerId = null) {
  const winnerPlayerId = runtime?.winnerPlayerId || null;
  if (!winnerPlayerId || !localPlayerId || winnerPlayerId !== localPlayerId) return null;
  return `${winnerPlayerId}:${runtime?.pressedAt || runtime?.updatedAt || 'no-timestamp'}`;
}

export function createPlayerPressAudio() {
  let audioContext = null;

  function ensureContext() {
    if (audioContext) return audioContext;
    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) return null;
    audioContext = new AudioContextCtor();
    return audioContext;
  }

  async function unlock() {
    const context = ensureContext();
    if (!context) return false;
    if (context.state === 'suspended') {
      await context.resume();
    }

    // Prime the output path inside the same user gesture so later winner
    // playback survives stricter mobile autoplay policies.
    const gain = context.createGain();
    gain.gain.value = 0.00001;
    gain.connect(context.destination);

    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(1, context.currentTime);
    oscillator.connect(gain);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.01);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    return true;
  }

  async function playWinnerTone() {
    const context = ensureContext();
    if (!context) return false;
    if (context.state === 'suspended') {
      await context.resume();
    }

    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    gain.connect(context.destination);

    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(740, now);
    oscillator.frequency.exponentialRampToValueAtTime(1040, now + 0.08);
    oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.18);
    oscillator.connect(gain);
    oscillator.start(now);
    oscillator.stop(now + 0.18);

    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };

    return true;
  }

  function destroy() {
    if (!audioContext) return;
    try {
      audioContext.close();
    } catch {
      // Ignore close errors from partially initialized browser audio contexts.
    }
    audioContext = null;
  }

  return {
    unlock,
    playWinnerTone,
    destroy,
  };
}
