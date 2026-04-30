// public/src/models/GameModel.js
class GameModel {
  constructor(gameData) {
    this.rounds = gameData.rounds || [];
    this.meta = gameData.meta || { updatedAt: new Date().toISOString(), currentPlayerId: null };
    this.schemaVersion = gameData.schemaVersion || '1.0';
    this.players = gameData.players || [];
  }

  getCell(roundIdx, rowIdx, cellIdx) {
    return this.rounds[roundIdx]?.rows[rowIdx]?.cells[cellIdx];
  }

  getTopic(roundIdx, rowIdx) {
    return this.rounds[roundIdx]?.rows[rowIdx]?.topic;
  }

  getCellModifier(roundIdx, rowIdx, cellIdx) {
    return this.rounds[roundIdx]?.rows[rowIdx]?.cells[cellIdx]?.modifier || null;
  }

  updateCell(roundIdx, rowIdx, cellIdx, updates) {
    const cell = this.getCell(roundIdx, rowIdx, cellIdx);
    if (cell) {
      Object.assign(cell, updates);
      this.meta.updatedAt = new Date().toISOString();
    }
  }

  updateTopic(roundIdx, rowIdx, topic) {
    if (this.rounds[roundIdx]?.rows[rowIdx]) {
      this.rounds[roundIdx].rows[rowIdx].topic = topic;
      this.meta.updatedAt = new Date().toISOString();
    }
  }

  getCurrentPlayerId() {
    return this.meta?.currentPlayerId ? String(this.meta.currentPlayerId) : null;
  }

  setCurrentPlayerId(playerId) {
    this.meta.currentPlayerId = playerId ? String(playerId) : null;
    this.meta.updatedAt = new Date().toISOString();
  }

  // Returns a Set of every filename currently referenced by any cell
  getAllFilenames() {
    const filenames = new Set();
    for (const round of this.rounds) {
      for (const row of (round.rows || [])) {
        for (const cell of (row.cells || [])) {
          if (cell.question?.media?.filename) filenames.add(cell.question.media.filename);
          if (cell.answer?.media?.filename)   filenames.add(cell.answer.media.filename);
          for (const f of (cell.question?.audioFiles || [])) if (f.filename) filenames.add(f.filename);
          for (const f of (cell.answer?.audioFiles   || [])) if (f.filename) filenames.add(f.filename);
        }
      }
    }
    return filenames;
  }

  toJSON() {
    return {
      schemaVersion: this.schemaVersion,
      meta: this.meta,
      rounds: this.rounds,
      players: this.players,
    };
  }

}

export default GameModel;
