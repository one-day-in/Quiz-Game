// src/services/MediaService.js

export class MediaService {
  constructor({ repo, gameService }) {
    this.repo = repo;        // GameRepository: uploadMedia, deleteMedia
    this.game = gameService; // GameService: updateCell (await-able)
  }

  // Supabase Storage returns full HTTPS-URLs, so src === url.
  toViewMedia(raw) {
    if (!raw) return null;
    return { ...raw, src: raw.url || '' };
  }

  // Maps raw audioFiles array to view format (adds .src)
  toViewAudioFiles(rawFiles) {
    if (!Array.isArray(rawFiles)) return [];
    return rawFiles.map(r => this.toViewMedia(r)).filter(Boolean);
  }

  // upload -> store RAW in cell, return viewMedia (with src) for UI.
  // If a file already exists in this slot it is deleted from Storage first,
  // so replacing an image never leaves an orphaned file behind.
  async uploadToCell({ file, target, roundId, rowId, cellId }) {
    const currentMedia = this.game.getModel()
      ?.getCell(roundId, rowId, cellId)?.[target]?.media;
    const oldFilename = currentMedia?.filename;

    if (oldFilename) {
      try {
        await this.repo.deleteStorageFiles([oldFilename]);
      } catch (e) {
        console.warn('[MediaService] could not delete old file before replace:', e);
        // non-fatal — proceed with upload regardless
      }
    }

    const raw = await this.repo.uploadMedia({
      file,
      type: target,
      roundId,
      rowId,
      cellId
    });

    const patch = target === 'question'
      ? { question: { media: raw } }
      : { answer: { media: raw } };

    await this.game.updateCell(roundId, rowId, cellId, patch);
    return this.toViewMedia(raw);
  }

  async deleteFromCell({ target, roundId, rowId, cellId }) {
    const currentMedia = this.game.getModel()
      ?.getCell(roundId, rowId, cellId)?.[target]?.media;

    if (currentMedia?.filename) {
      await this.repo.deleteMedia(target, roundId, rowId, cellId);
    }

    const patch = target === 'question'
      ? { question: { media: null } }
      : { answer: { media: null } };

    await this.game.updateCell(roundId, rowId, cellId, patch);
    return true;
  }

  // Audio: upload file → append to cell's audioFiles array
  async addAudioToCell({ file, target, roundId, rowId, cellId }) {
    const raw = await this.repo.uploadMedia({
      file,
      type: target,
      roundId,
      rowId,
      cellId
    });

    await this.game.addAudioToCell(roundId, rowId, cellId, target, raw);
    return this.toViewMedia(raw);
  }

  // Audio: delete file from storage → remove from cell's audioFiles array
  async deleteAudioFromCell({ filename, target, roundId, rowId, cellId }) {
    await this.repo.deleteAudioFile(filename);
    await this.game.removeAudioFromCell(roundId, rowId, cellId, target, filename);
    return true;
  }

}

export function createMediaService({ repo, gameService }) {
  return new MediaService({ repo, gameService });
}
