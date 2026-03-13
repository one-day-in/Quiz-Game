// src/services/MediaService.js

import { QUIZ_SPINNER_MEDIA, isQuizSpinnerMedia } from '../constants/quizSpinnerMedia.js';

export class MediaService {
  constructor({ repo, gameService }) {
    this.repo = repo;        // GameRepository: uploadMedia, deleteMedia
    this.game = gameService; // GameService: updateCell (await-able)
  }

  // Supabase Storage returns full HTTPS-URLs, so src === url.
  // Exception: builtin spinner uses a local asset — resolve via BASE_URL
  // so it works both on localhost ('/') and GitHub Pages ('/Quiz-Game/').
  toViewMedia(raw) {
    if (!raw) return null;
    if (isQuizSpinnerMedia(raw)) {
      const src = `${import.meta.env.BASE_URL}quiz-spinner.gif`;
      return { ...QUIZ_SPINNER_MEDIA, src };
    }
    return { ...raw, src: raw.url || '' };
  }

  isBuiltinMedia(raw) {
    return isQuizSpinnerMedia(raw);
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

    if (oldFilename && !this.isBuiltinMedia(currentMedia)) {
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

    if (!this.isBuiltinMedia(currentMedia)) {
      await this.repo.deleteMedia(target, roundId, rowId, cellId);
    }

    const patch = target === 'question'
      ? { question: { media: null } }
      : { answer: { media: null } };

    await this.game.updateCell(roundId, rowId, cellId, patch);
    return true;
  }

  async toggleQuizSpinnerOnQuestion({ enabled, roundId, rowId, cellId }) {
    const currentMedia = this.game.getModel()
      ?.getCell(roundId, rowId, cellId)?.question?.media;

    if (enabled) {
      if (currentMedia?.filename && !this.isBuiltinMedia(currentMedia)) {
        try {
          await this.repo.deleteStorageFiles([currentMedia.filename]);
        } catch (e) {
          console.warn('[MediaService] could not delete old file before enabling quiz spinner:', e);
        }
      }

      await this.game.updateCell(roundId, rowId, cellId, {
        question: { media: QUIZ_SPINNER_MEDIA }
      });
      return this.toViewMedia(QUIZ_SPINNER_MEDIA);
    }

    if (!this.isBuiltinMedia(currentMedia)) {
      return this.toViewMedia(currentMedia);
    }

    await this.game.updateCell(roundId, rowId, cellId, {
      question: { media: null }
    });
    return null;
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

  // Finds Storage files not referenced in the game model and deletes them.
  // Returns { orphans: number, deleted: number }.
  async cleanupOrphanedFiles(model) {
    const referenced = model.getAllFilenames();            // Set<string> from JSONB
    const inStorage  = await this.repo.listStorageFiles(); // string[] from bucket

    const orphans = inStorage.filter(name => !referenced.has(name));

    if (orphans.length) {
      await this.repo.deleteStorageFiles(orphans);
    }

    return { orphans: orphans.length, deleted: orphans.length };
  }
}

export function createMediaService({ repo, gameService }) {
  return new MediaService({ repo, gameService });
}
