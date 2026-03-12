export const QUIZ_SPINNER_MEDIA = Object.freeze({
  filename: 'builtin-quiz-spinner.gif',
  url: '/quiz-spinner.gif',
  mime: 'image/gif',
  size: 0,
  builtin: 'quiz-spinner',
});

export function isQuizSpinnerMedia(media) {
  return !!media
    && media.filename === QUIZ_SPINNER_MEDIA.filename
    && media.url === QUIZ_SPINNER_MEDIA.url;
}
