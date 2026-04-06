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
    const masterGain = context.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.exponentialRampToValueAtTime(0.42, now + 0.03);
    masterGain.gain.setValueAtTime(0.42, now + 0.03);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    masterGain.connect(context.destination);

    const lfo = context.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(5.5, now);

    const lfoGain = context.createGain();
    lfoGain.gain.setValueAtTime(90, now);
    lfo.connect(lfoGain);

    const lowOscillator = context.createOscillator();
    lowOscillator.type = 'sawtooth';
    lowOscillator.frequency.setValueAtTime(165, now);
    lfoGain.connect(lowOscillator.frequency);
    lowOscillator.connect(masterGain);

    const supportGain = context.createGain();
    supportGain.gain.setValueAtTime(0.16, now);
    supportGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
    supportGain.connect(context.destination);

    const supportOscillator = context.createOscillator();
    supportOscillator.type = 'triangle';
    supportOscillator.frequency.setValueAtTime(110, now);
    supportOscillator.connect(supportGain);

    lfo.start(now);
    lowOscillator.start(now);
    supportOscillator.start(now);

    lfo.stop(now + 1.1);
    lowOscillator.stop(now + 1.1);
    supportOscillator.stop(now + 1.0);

    lowOscillator.onended = () => {
      lfo.disconnect();
      lfoGain.disconnect();
      lowOscillator.disconnect();
      supportOscillator.disconnect();
      masterGain.disconnect();
      supportGain.disconnect();
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
