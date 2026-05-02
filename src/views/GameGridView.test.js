/* @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { GameGridView } from './GameGridView.js';

function createModelStub() {
  return {
    getTopic: () => '',
    getCell: (_roundId, rowId, cellId) => {
      if (rowId === 0 && cellId === 0) {
        return {
          question: { text: 'Question' },
          answer: { text: 'Answer' },
          isAnswered: false,
          modifier: { type: 'steal_leader_points' },
        };
      }
      return {
        question: { text: 'Question' },
        answer: { text: 'Answer' },
        isAnswered: false,
        modifier: { type: 'none' },
      };
    },
  };
}

describe('GameGridView modifier banner', () => {
  it('does not render modifier banners on grid cells', () => {
    const view = GameGridView({
      model: createModelStub(),
      uiState: { gameMode: 'play' },
      roundId: 0,
      onCellClick: vi.fn(),
      onTopicChange: vi.fn(),
      isReadOnly: false,
    });

    const firstCell = view.querySelector('[data-cell="r0c0"]');
    const secondCell = view.querySelector('[data-cell="r0c1"]');
    const banner = firstCell?.querySelector('.cell-question__modifierBanner');
    const secondBanner = secondCell?.querySelector('.cell-question__modifierBanner');

    expect(firstCell?.classList.contains('has-modifier--steal')).toBe(false);
    expect(banner).toBeFalsy();
    expect(secondBanner).toBeFalsy();
  });
});
