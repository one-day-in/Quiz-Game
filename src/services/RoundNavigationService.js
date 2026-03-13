// src/services/RoundNavigationService.js
export class RoundNavigationService {
  constructor(gameService) {
    this._game = gameService;
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

  setActiveRound(roundId) { this._game.setActiveRound(roundId); }
}

export function createRoundNavigationService(gameService) {
  return new RoundNavigationService(gameService);
}
