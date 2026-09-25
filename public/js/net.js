// Owns the single live socket in `state.ws`. Handlers from a socket that is no
// longer state.ws are ignored, so a stale socket can't touch shared state.
export function makeConnector({
  state, createSocket, onOpen, onMessage, onDisconnect,
}) {
  return function connect(first) {
    const rs = state.ws?.readyState;
    if (rs === 1) { onOpen(first); return 'sent'; }
    if (rs === 0) return 'pending'; // already connecting: first attempt wins
    const ws = createSocket();
    state.ws = ws;
    ws.onopen = () => { if (state.ws === ws) onOpen(first); };
    ws.onmessage = (e) => { if (state.ws !== ws) return; onMessage(JSON.parse(e.data)); };
    ws.onclose = () => {
      if (state.ws !== ws) return;
      state.ws = null;
      onDisconnect();
    };
    return 'connecting';
  };
}
