export function sortPlayersByScore(players = []) {
  return (Array.isArray(players) ? players : [])
    .slice()
    .sort((a, b) => {
      const scoreDelta = (Number(b?.points) || 0) - (Number(a?.points) || 0);
      if (scoreDelta !== 0) return scoreDelta;
      return String(a?.name || '').localeCompare(String(b?.name || ''));
    });
}
