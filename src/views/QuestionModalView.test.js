/* @vitest-environment jsdom */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { QuestionModalView } from './QuestionModalView.js';

beforeAll(() => {
  Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(window.HTMLMediaElement.prototype, 'load', {
    configurable: true,
    value: vi.fn(),
  });
});

function createView(overrides = {}) {
  return new QuestionModalView({
    mode: 'view',
    headerTitle: 'Topic • 100',
    isAnswered: false,
    isQuizSpinner: false,
    question: { text: 'Question', media: null, audioFiles: [] },
    answer: { text: 'Answer', media: null, audioFiles: [] },
    onClose: vi.fn(),
    onIncorrect: vi.fn(),
    onCorrect: vi.fn(),
    onToggleAnswered: vi.fn(),
    onToggleQuizSpinner: vi.fn(),
    onQuestionChange: vi.fn(),
    onAnswerChange: vi.fn(),
    onUploadMedia: vi.fn(),
    onDeleteMedia: vi.fn(),
    onAddAudio: vi.fn(),
    onDeleteAudio: vi.fn(),
    ...overrides,
  });
}

describe('QuestionModalView winner state', () => {
  it('keeps result buttons disabled until winner appears', () => {
    const view = createView();

    expect(view._refs.btnIncorrect.disabled).toBe(true);
    expect(view._refs.btnCorrect.disabled).toBe(true);
    expect(view._refs.pressBanner.hidden).toBe(true);

    view.updateWinnerName('Maria');

    expect(view._refs.btnIncorrect.disabled).toBe(false);
    expect(view._refs.btnCorrect.disabled).toBe(false);
    expect(view._refs.pressBanner.hidden).toBe(false);
    expect(view._refs.pressBanner.textContent).toContain('Maria');

    view.updateWinnerName('');

    expect(view._refs.btnIncorrect.disabled).toBe(true);
    expect(view._refs.btnCorrect.disabled).toBe(true);
    expect(view._refs.pressBanner.hidden).toBe(true);

    view.destroy();
  });

  it('forwards result button clicks to callbacks', () => {
    const onIncorrect = vi.fn();
    const onCorrect = vi.fn();
    const view = createView({ onIncorrect, onCorrect });

    view.updateWinnerName('Alex');
    view._refs.btnIncorrect.click();
    view._refs.btnCorrect.click();

    expect(onIncorrect).toHaveBeenCalledTimes(1);
    expect(onCorrect).toHaveBeenCalledTimes(1);

    view.destroy();
  });
});
