import { AsyncRequestState } from './async-request-state';

describe('AsyncRequestState', () => {
  beforeEach(() => jasmine.clock().install());
  afterEach(() => jasmine.clock().uninstall());

  it('moves from normal loading to extended server waiting and clears on completion', () => {
    const state = new AsyncRequestState();
    state.begin();
    expect(state.pending()).toBeTrue();
    expect(state.waitingForServer()).toBeFalse();
    jasmine.clock().tick(6_000);
    expect(state.waitingForServer()).toBeTrue();
    state.end();
    expect(state.pending()).toBeFalse();
    expect(state.waitingForServer()).toBeFalse();
  });
});
