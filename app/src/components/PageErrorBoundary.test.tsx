import { describe, it, expect, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import PageErrorBoundary from './PageErrorBoundary';

describe('PageErrorBoundary', () => {
  it('affiche une solution de repli puis permet de réessayer', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fail = true;
    function Screen() {
      if (fail) throw new Error('écran indisponible');
      return <div>Écran chargé</div>;
    }
    try {
      let view!: ReturnType<typeof create>;
      act(() => { view = create(<PageErrorBoundary><Screen /></PageErrorBoundary>); });
      expect(view.root.findByProps({ role: 'alert' })).toBeTruthy();
      fail = false;
      act(() => { view.root.findByType('button').props.onClick(); });
      expect(view.root.findByType('div').children).toEqual(['Écran chargé']);
      view.unmount();
    } finally { log.mockRestore(); }
  });
});
