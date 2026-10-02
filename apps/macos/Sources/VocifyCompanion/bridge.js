(() => {
  const call = (op, args = {}) => {
    const result = window.webkit.messageHandlers.vocify.postMessage({ op, args });
    return result ?? Promise.resolve(undefined);
  };
  const listeners = {
    'system-audio:pcm': new Set(),
    'system-audio:lost': new Set(),
    'shell:command': new Set(),
    'permissions:changed': new Set(),
    'call:pages': new Set(),
    'call:ended': new Set(),
    'call:source': new Set(),
    'postcall:action': new Set(),
    'recorder:transcript': new Set(),
    'recorder:levels': new Set(),
    'recorder:warning': new Set(),
  };
  const on = (channel) => (cb) => {
    listeners[channel].add(cb);
    return () => listeners[channel].delete(cb);
  };
  window.__vocifyEmit = (channel, payload) => {
    const set = listeners[channel];
    if (!set) return;
    const value =
      channel === 'system-audio:pcm'
        ? Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)).buffer
        : payload;
    set.forEach((cb) => cb(value));
  };
  window.vocifyDesktop = {
    platform: 'darwin',
    systemAudio: {
      start: () => call('system-audio:start'),
      stop: () => call('system-audio:stop'),
      onPcm: on('system-audio:pcm'),
      onLost: on('system-audio:lost'),
    },
    // The Mac records the call itself (mic + call audio + transcription); the page gets copies.
    recorder: {
      start: (options) => call('recorder:start', options),
      pause: (paused) => call('recorder:pause', { paused }),
      // Resolves with the finished transcript once its last words are in.
      stop: () => call('recorder:stop'),
      onTranscript: on('recorder:transcript'),
      onLevels: on('recorder:levels'),
      onWarning: on('recorder:warning'),
    },
    // The global record shortcut: { label, defaultLabel }; set takes a keydown's code + modifiers.
    shortcut: {
      get: () => call('shortcut:get'),
      set: (combo) => call('shortcut:set', combo),
      clear: () => call('shortcut:clear'),
    },
    crm: {
      // CRM page URLs open in the rep's browsers, front window first; asks for
      // Automation consent the first time unless { ask: false }.
      pages: (options = {}) => call('crm:pages', options),
      openAutomationSettings: () => call('crm:open-automation-settings'),
      // The island detected a call with these CRM pages on screen: { urls }.
      onCallPages: on('call:pages'),
      // That call ended (the call app let go of the mic).
      onCallEnded: on('call:ended'),
      // Where the call happens: { name, kind: 'call' | 'meeting' | null }, or null.
      onCallSource: on('call:source'),
    },
    permissions: {
      status: () => call('permissions:status'),
      request: (type) => call('permissions:request', { type }),
      open: (type) => call('permissions:open', { type }),
      guide: (type) => call('permissions:guide', { type }),
      appInfo: () => call('permissions:appInfo'),
      onChanged: on('permissions:changed'),
    },
    shell: {
      setState: (state) => {
        call('shell:state', { state });
      },
      resize: (size) => call('shell:resize', { size }),
      showOverlay: () => call('overlay:show'),
      hideOverlay: () => call('overlay:hide'),
      openExternal: (url) => call('shell:open-external', { url }),
      command: (name) => {
        call('shell:command', { name });
      },
      onCommand: on('shell:command'),
      // A choice made in the island's post-call card: { type, ...details }.
      onPostCallAction: on('postcall:action'),
    },
    saas: { request: (payload) => call('saas:request', { payload }) },
    drafts: {
      save: (draft) => call('drafts:save', { draft }),
      list: () => call('drafts:list'),
      remove: (id) => call('drafts:remove', { id }),
    },
  };
})();
