import { supabase } from './supabaseClient.js';
import { getGame } from './gameApi.js';

const BUCKET = 'media';

// ─── Image compression ──────────────────────────────────────────────────────
// Resizes to max 1920px on the longest side and converts to WebP.
// Non-image files (audio, video) and SVGs pass through unchanged.

const COMPRESS_OPTS = {
    maxSize:  1920,   // px — longest side
    quality:  0.85,   // WebP quality 0–1
};

async function compressImage(file) {
    // Only compress raster images
    if (!file.type.startsWith('image/')) return file;
    if (file.type === 'image/svg+xml')    return file;

    return new Promise((resolve) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);

            let { width, height } = img;
            const { maxSize, quality } = COMPRESS_OPTS;

            // Scale down if either dimension exceeds maxSize
            if (width > maxSize || height > maxSize) {
                const ratio = Math.min(maxSize / width, maxSize / height);
                width  = Math.round(width  * ratio);
                height = Math.round(height * ratio);
            }

            const canvas = document.createElement('canvas');
            canvas.width  = width;
            canvas.height = height;

            canvas.getContext('2d').drawImage(img, 0, 0, width, height);

            canvas.toBlob((blob) => {
                if (!blob) { resolve(file); return; } // fallback — keep original
                const newName = file.name.replace(/\.[^.]+$/, '') + '.webp';
                resolve(new File([blob], newName, { type: 'image/webp' }));
            }, 'image/webp', quality);
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(file); // fallback — keep original
        };

        img.src = objectUrl;
    });
}

// ─── Filename generator ─────────────────────────────────────────────────────

// Files are stored under a per-game subfolder: `{gameId}/{filename}`
// This isolates games from each other and makes bulk deletion trivial.
function generateFilename(originalname, type, roundId, rowId, cellId, gameId) {
    const ext = originalname.includes('.')
        ? originalname.split('.').pop().toLowerCase()
        : '';
    const timestamp = Date.now();
    const random    = Math.random().toString(36).substring(2, 6);
    const safeType  = type.replace(/[^a-z]/g, '');
    const base      = `${safeType}_r${roundId}_row${rowId}_c${cellId}_${timestamp}_${random}`;
    const name      = ext ? `${base}.${ext}` : base;
    // Prefix with gameId subfolder if provided
    return gameId ? `${gameId}/${name}` : name;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function uploadMedia({ file, type, roundId, rowId, cellId, gameId }) {
    // Compress images before upload; audio/video pass through as-is
    const ready    = await compressImage(file);
    const filename = generateFilename(ready.name, type, roundId, rowId, cellId, gameId);

    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(filename, ready, { contentType: ready.type, upsert: false });

    if (error) throw new Error(`[Media] upload failed: ${error.message}`);

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);

    return {
        filename,
        url:  data.publicUrl,
        mime: ready.type,
        size: ready.size,
    };
}

export async function deleteAudioFile(filename) {
    const { error } = await supabase.storage.from(BUCKET).remove([filename]);
    if (error) throw new Error(`[Media] delete audio failed: ${error.message}`);
    return { ok: true };
}

// Returns array of full storage paths for a game's files (e.g. "gameId/filename.webp").
// Pass gameId to scope the listing to that game's subfolder.
export async function listStorageFiles(gameId) {
    const folder = gameId ?? '';
    const { data, error } = await supabase.storage
        .from(BUCKET)
        .list(folder, { limit: 10_000, offset: 0 });

    if (error) throw new Error(`[Media] list storage failed: ${error.message}`);
    const names = (data || []).map(f => f.name);
    // Return full paths so callers can pass them directly to remove()
    return gameId ? names.map(n => `${gameId}/${n}`) : names;
}

// Deletes a batch of files from storage in one request (paths must be full, e.g. "gameId/file.webp")
export async function deleteStorageFiles(filenames) {
    if (!filenames.length) return;
    const { error } = await supabase.storage.from(BUCKET).remove(filenames);
    if (error) throw new Error(`[Media] bulk delete failed: ${error.message}`);
}

// Deletes ALL media files for a game by wiping its storage subfolder.
// Called before deleteGame so no orphaned files remain in the bucket.
export async function deleteGameFolder(gameId) {
    if (!gameId) return;
    const { data } = await supabase.storage
        .from(BUCKET)
        .list(gameId, { limit: 10_000, offset: 0 });

    if (!data?.length) return; // folder empty or doesn't exist — nothing to do

    const paths = data.map(f => `${gameId}/${f.name}`);
    await deleteStorageFiles(paths);
}

export async function deleteMedia(gameId, type, roundId, rowId, cellId) {
    const game  = await getGame(gameId);
    const cell  = game.rounds?.[roundId]?.rows?.[rowId]?.cells?.[cellId];
    const media = cell?.[type]?.media;

    if (!media?.filename) return { ok: true };

    const { error } = await supabase.storage
        .from(BUCKET)
        .remove([media.filename]);

    if (error) throw new Error(`[Media] delete failed: ${error.message}`);
    return { ok: true };
}
