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
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

function createView(overrides = {}) {
  return new QuestionModalView({
    mode: 'view',
    headerTitle: 'Topic • 100',
    isAnswered: false,
    question: { text: 'Question', media: null, audioFiles: [] },
    answer: { text: 'Answer', media: null, audioFiles: [] },
    onClose: vi.fn(),
    onIncorrect: vi.fn(),
    onCorrect: vi.fn(),
    onToggleAnswered: vi.fn(),
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
  it('initializes modifier select from active modifier type', () => {
    const view = createView({
      mode: 'edit',
      activeModifierType: 'steal_leader_points',
    });

    expect(view._refs.modifierSelect.value).toBe('steal_leader_points');

    view.setActiveModifierType('flip_score');
    expect(view._refs.modifierSelect.value).toBe('flip_score');

    view.destroy();
  });

  it('shows modifier banner in view mode when cell modifier is active', () => {
    const view = createView({
      mode: 'view',
      activeModifierType: 'steal_leader_points',
    });

    expect(view._refs.modifierBanner.hidden).toBe(false);
    expect(view._refs.modifierBanner.textContent).toContain('1000');

    view.destroy();
  });

  it('shows modifier banner in controller mode when non-directed modifier is active', () => {
    const view = createView({
      mode: 'view',
      displayMode: 'controller',
      activeModifierType: 'flip_score',
    });

    expect(view._refs.modifierBanner.hidden).toBe(false);
    expect(view._refs.modifierBanner.textContent).toContain('⚡');

    view.destroy();
  });

  it('keeps modifier banner hidden for directed bet modifier', () => {
    const view = createView({
      mode: 'view',
      activeModifierType: 'directed_bet',
    });

    expect(view._refs.modifierBanner.hidden).toBe(true);

    view.destroy();
  });

  it('keeps modifier banner hidden in edit mode', () => {
    const view = createView({
      mode: 'edit',
      activeModifierType: 'steal_leader_points',
    });

    expect(view._refs.modifierBanner.hidden).toBe(true);

    view.destroy();
  });

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

  it('hides the winner banner while the answer section is shown', () => {
    const view = createView();

    view.updateWinnerName('Maria');
    expect(view._refs.pressBanner.hidden).toBe(false);

    view._refs.toggleAnswerBtn.click();
    expect(view._isAnswerShown).toBe(true);
    expect(view._refs.pressBanner.hidden).toBe(true);

    view._refs.toggleAnswerBtn.click();
    expect(view._isAnswerShown).toBe(false);
    expect(view._refs.pressBanner.hidden).toBe(false);

    view.destroy();
  });

  it('renders the press countdown inside the banner', () => {
    const view = createView();

    view.updateWinnerName('Maria');
    view.updatePressTimer(30);

    expect(view._refs.pressBannerTimer.hidden).toBe(false);
    expect(view._refs.pressBannerTimer.classList.contains('is-idle')).toBe(false);
    expect(view._refs.pressBannerTimer.textContent).toBe('00:30');

    view.updatePressTimer(null);
    expect(view._refs.pressBannerTimer.hidden).toBe(false);
    expect(view._refs.pressBannerTimer.classList.contains('is-idle')).toBe(true);

    view.destroy();
  });

  it('does not show press banner in controller mode', () => {
    const view = createView({ displayMode: 'controller' });

    view.updateWinnerName('Maria');
    view.updatePressTimer(30);

    expect(view._refs.pressBanner.hidden).toBe(true);

    view.destroy();
  });

  it('uses compact press banner layout during directed bet answering phase', () => {
    const view = createView();

    view.setDirectedBetState({ enabled: false, phase: 'answering' });
    view.updateWinnerName('Maria');

    expect(view._refs.pressBanner.hidden).toBe(false);
    expect(view._refs.pressBanner.classList.contains('qmodal__pressBanner--compact')).toBe(true);

    view.setDirectedBetState({ enabled: false, phase: 'fallback' });
    expect(view._refs.pressBanner.classList.contains('qmodal__pressBanner--compact')).toBe(false);

    view.destroy();
  });

  it('dismisses on overlay click but not on Escape key', () => {
    const onClose = vi.fn();
    const view = createView({ onClose });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(0);

    view._refs.overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);

    view.destroy();
  });

  it('emits directed bet actions from controller panel controls', () => {
    const onDirectedBetAction = vi.fn();
    const view = createView({
      mode: 'view',
      displayMode: 'controller',
      activeModifierType: 'directed_bet',
      onDirectedBetAction,
    });

    view.setDirectedBetState({
      enabled: true,
      phase: 'select',
      players: [
        { id: 'p-1', name: 'Maria' },
        { id: 'p-2', name: 'Artem' },
      ],
      selectedPlayerId: null,
      selectedStake: 100,
      canStart: true,
    });

    const playerBtn = view._refs.directedBetPlayers.querySelector('.qmodal__directedBetPlayerBtn[data-player-id="p-1"]');
    const stakeBtn = view._refs.directedBetStakes.querySelector('.qmodal__directedBetStakeBtn[data-stake="300"]');
    const startBtn = view._refs.directedBetStartBtn;

    playerBtn?.click();
    stakeBtn?.click();
    startBtn?.click();

    expect(onDirectedBetAction).toHaveBeenNthCalledWith(1, { type: 'select_player', playerId: 'p-1' });
    expect(onDirectedBetAction).toHaveBeenNthCalledWith(2, { type: 'select_stake', stake: 300 });
    expect(onDirectedBetAction).toHaveBeenNthCalledWith(3, { type: 'start' });

    view.destroy();
  });

});
