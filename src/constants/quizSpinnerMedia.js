export const QUIZ_SPINNER_MEDIA = Object.freeze({
  filename: 'builtin-quiz-spinner.gif',
  url: '/quiz-spinner.gif', // stored value — display URL is resolved at runtime
  mime: 'image/gif',
  size: 0,
  builtin: 'quiz-spinner',
});

// Identify by the stable `builtin` tag, not by URL (URL varies per deploy base path)
export function isQuizSpinnerMedia(media) {
  return !!media && media.builtin === 'quiz-spinner';
}
