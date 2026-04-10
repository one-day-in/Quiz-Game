// src/services/GameRepository.js
import * as gameApi from '../api/gameApi.js';
import * as mediaApi from '../api/mediaApi.js';
import { getSession } from '../api/authApi.js';
import { t } from '../i18n.js';
import { isGameDeleteAdminUser } from '../utils/adminAccess.js';

export class GameRepository {
  constructor(gameId) {
    this._gameId = gameId;
  }

  getGameId() {
    return this._gameId;
  }

  // ---------- lobby (static helpers, no gameId needed) ----------
  static listGames() {
    return gameApi.listGames();
  }

  static createGame(name) {
    return gameApi.createGame(name);
  }

  static async deleteGame(gameId) {
    const session = await getSession();
    if (!isGameDeleteAdminUser(session?.user)) {
      throw new Error(t('delete_game_admin_only'));
    }
    // Delete all storage files for this game first, then remove the DB row
    await mediaApi.deleteGameFolder(gameId);
    return gameApi.deleteGame(gameId);
  }

  // ---------- game ----------
  loadGame() {
    return gameApi.getGame(this._gameId);
  }

  saveGame(gameJson) {
    return gameApi.saveGame(this._gameId, gameJson);
  }

  updateTopic(roundId, rowId, topic) {
    return gameApi.updateTopic(this._gameId, roundId, rowId, topic);
  }

  updateCell(roundId, rowId, cellId, patch) {
    return gameApi.updateCell(this._gameId, roundId, rowId, cellId, patch);
  }

  resetRound(roundId) {
    return gameApi.resetRound(this._gameId, roundId);
  }

  resetCell(roundId, rowId, cellId) {
    return gameApi.resetCell(this._gameId, roundId, rowId, cellId);
  }

  // ---------- media ----------
  uploadMedia({ file, type, roundId, rowId, cellId }) {
    // Pass gameId so files are stored under a per-game subfolder in the bucket
    return mediaApi.uploadMedia({ file, type, roundId, rowId, cellId, gameId: this._gameId });
  }

  deleteMedia(type, roundId, rowId, cellId) {
    return mediaApi.deleteMedia(this._gameId, type, roundId, rowId, cellId);
  }

  // ---------- audio (multiple per cell section) ----------
  addAudioToCell(roundId, rowId, cellId, type, audioRecord) {
    return gameApi.addAudioToCell(this._gameId, roundId, rowId, cellId, type, audioRecord);
  }

  removeAudioFromCell(roundId, rowId, cellId, type, filename) {
    return gameApi.removeAudioFromCell(this._gameId, roundId, rowId, cellId, type, filename);
  }

  deleteAudioFile(filename) {
    return mediaApi.deleteAudioFile(filename);
  }

  // ---------- storage maintenance ----------
  deleteStorageFiles(filenames) {
    return mediaApi.deleteStorageFiles(filenames);
  }
}

// ✅ factory (DI)
export function createGameRepository(gameId) {
  return new GameRepository(gameId);
}
