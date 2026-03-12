// public/src/services/SettingsService.js
export class SettingsService {
  constructor(gameService, mediaService) {
    this._game  = gameService;
    this._media = mediaService;
  }

  subscribe(fn) {
    const unsubscribe = this._game.subscribe(() => fn(this.getState()));
    fn(this.getState());
    return unsubscribe;
  }

  getState() {
    const { model, uiState } = this._game.getState();
    const rounds = model?.rounds ?? [];

    return {
      activeRoundId: uiState.activeRoundId,
      roundsCount: rounds.length,
      roundNames: rounds.map((r, i) => r?.name || `Round ${i + 1}`)
    };
  }

  getActiveRoundId() { return this.getState().activeRoundId; }
  getRoundsCount() { return this.getState().roundsCount; }

  getRoundName(roundId) {
    const { roundNames } = this.getState();
    return roundNames[roundId] || `Round ${Number(roundId) + 1}`;
  }

  setActiveRound(roundId) { this._game.setActiveRound(roundId); }
  async resetRound(roundId) { await this._game.resetRound(roundId); }

  // Finds and deletes Storage files not referenced in the current game model.
  async cleanupStorage() {
    const model = this._game.getModel();
    if (!model) throw new Error('Game not loaded');
    return this._media.cleanupOrphanedFiles(model);
  }
}

export function createSettingsService(gameService, mediaService) {
  return new SettingsService(gameService, mediaService);
}