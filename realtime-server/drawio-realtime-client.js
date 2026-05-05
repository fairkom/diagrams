/**
 * Draw.io Real-Time Collaboration Client Integration
 *
 * Patches draw.io to use a local real-time server instead of Pusher/Cloudflare.
 * Insert this script in the draw.io HTML BEFORE app.min.js loads.
 *
 * How draw.io uses Pusher:
 *   1. new Pusher(appKey, options)
 *   2. pusher.subscribe(channelName)         -> Channel object
 *   3. channel.bind('message', callback)     -> receive diagram updates
 *   4. pusher.connection.bind('connected', cb)
 *   5. POSTs diagram XML to /cache?id=<room> -> broadcast to others
 *   6. GETs /cache?id=<room>                 -> poll for missed updates
 */

(function () {
  'use strict';

  if (window.__drawioRealtimeConfig) {
    console.log('[DrawIO RT] Already configured, skipping');
    return;
  }

  // ── URL resolution ────────────────────────────────────────────────────────
  // These must match your ingress paths:
  //   /rt    -> drawio-realtime service (WebSocket)
  //   /cache -> drawio-realtime service (HTTP POST/GET)
  const loc         = window.location;
  const wsProtocol  = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  const hostAndPort = loc.host;

  const WS_BASE   = wsProtocol + '//' + hostAndPort + '/rt';
  const HTTP_BASE = loc.protocol + '//' + hostAndPort + '/cache';

  window.__drawioRealtimeConfig = { enabled: true, wsBase: WS_BASE, httpBase: HTTP_BASE };
  console.log('[DrawIO RT] Configured -- WS:', WS_BASE, '| HTTP:', HTTP_BASE);

  // ── 1. Block Pusher.js CDN ────────────────────────────────────────────────
  new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var nodes = mutations[i].addedNodes;
      for (var j = 0; j < nodes.length; j++) {
        var node = nodes[j];
        if (node.nodeName === 'SCRIPT' && node.src && node.src.includes('pusher.com')) {
          node.remove();
          console.log('[DrawIO RT] Blocked Pusher script:', node.src);
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  document.querySelectorAll('script[src*="pusher.com"]').forEach(function(s) {
    s.remove();
    console.log('[DrawIO RT] Removed existing Pusher script:', s.src);
  });

  // ── 2. Pusher shim ────────────────────────────────────────────────────────
  //
  // CRITICAL FIX: PusherChannel no longer takes a ws in its constructor.
  // PusherShim calls channel._attachWs(ws) once the socket is actually open.
  // The old code passed this._ws (null) at subscribe() time, so addEventListener
  // was called on a dummy object and messages were never dispatched.

  function PusherChannel(channelName) {
    this._name     = channelName;
    this._bindings = {};
    this._ws       = null;
  }

  PusherChannel.prototype._attachWs = function(ws) {
    // Avoid double-attaching the same socket instance
    if (this._ws === ws) return;
    this._ws = ws;
    var self = this;
    ws.addEventListener('message', function(wsEvent) {
      var raw;
      try {
        raw = JSON.parse(wsEvent.data);
      } catch (e) {
        console.warn('[DrawIO RT] Unparseable WS message:', wsEvent.data);
        return;
      }

      var boundEvents = Object.keys(self._bindings);
      console.log('[DrawIO RT] WS message on channel "' + self._name + '"',
                  '| bound events:', boundEvents,
                  '| payload:', JSON.stringify(raw).substring(0, 100));

      // Fire every registered handler — draw.io typically uses 'message',
      // some versions use 'client-msg'. We fire all of them.
      for (var eventName in self._bindings) {
        var handlers = self._bindings[eventName];
        for (var k = 0; k < handlers.length; k++) {
          try {
            handlers[k](raw);
          } catch (cbErr) {
            console.error('[DrawIO RT] Handler for "' + eventName + '" threw:', cbErr);
          }
        }
      }
    });
    console.log('[DrawIO RT] WS attached to channel "' + this._name + '"');
  };

  PusherChannel.prototype.bind = function(eventName, callback) {
    if (!this._bindings[eventName]) this._bindings[eventName] = [];
    this._bindings[eventName].push(callback);
    console.log('[DrawIO RT] channel.bind("' + eventName + '") on "' + this._name + '"');
    return this;
  };

  PusherChannel.prototype.unbind = function(eventName, callback) {
    if (callback && this._bindings[eventName]) {
      this._bindings[eventName] = this._bindings[eventName].filter(function(cb) { return cb !== callback; });
    } else {
      delete this._bindings[eventName];
    }
    return this;
  };

  PusherChannel.prototype.trigger = function(eventName, data) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(data));
    }
  };

  // ─────────────────────────────────────────────────────────────────────────

  function PusherShim(appKey, options) {
    console.log('[DrawIO RT] new Pusher() intercepted, appKey:', appKey);
    this._options       = options || {};
    this._channels      = {};
    this._connCallbacks = {};
    this._ws            = null;
    this.sessionID      = 'local-' + Math.random().toString(36).slice(2);

    var self = this;
    this.connection = {
      state: 'initialized',
      bind: function(event, callback) {
        if (!self._connCallbacks[event]) self._connCallbacks[event] = [];
        self._connCallbacks[event].push(callback);
        // Fire immediately if already connected
        if (event === 'connected' && self._ws && self._ws.readyState === WebSocket.OPEN) {
          setTimeout(function() { callback({ socket_id: 'local' }); }, 0);
        }
      }
    };
  }

  PusherShim.prototype._openWebSocket = function(roomId) {
    if (this._ws && this._ws.readyState <= WebSocket.OPEN) return;
    var self   = this;
    var wsUrl  = WS_BASE + '?id=' + encodeURIComponent(roomId);
    console.log('[DrawIO RT] Opening WebSocket:', wsUrl);
    this._ws = new WebSocket(wsUrl);

    this._ws.addEventListener('open', function() {
      console.log('[DrawIO RT] WebSocket OPEN for room:', roomId);
      self.connection.state = 'connected';

      // Attach live socket to all channels NOW — this is the critical fix
      for (var name in self._channels) {
        self._channels[name]._attachWs(self._ws);
      }

      var cbs = self._connCallbacks['connected'] || [];
      for (var i = 0; i < cbs.length; i++) {
        cbs[i]({ socket_id: 'local' });
      }
    });

    this._ws.addEventListener('close', function(ev) {
      console.warn('[DrawIO RT] WebSocket CLOSED:', ev.code, ev.reason);
      self.connection.state = 'disconnected';
      var dcbs = self._connCallbacks['disconnected'] || [];
      for (var i = 0; i < dcbs.length; i++) dcbs[i]({});
      setTimeout(function() { self._openWebSocket(roomId); }, 3000);
    });

    this._ws.addEventListener('error', function(ev) {
      console.error('[DrawIO RT] WebSocket ERROR', ev);
    });
  };

  PusherShim.prototype.subscribe = function(channelName) {
    console.log('[DrawIO RT] pusher.subscribe("' + channelName + '")');
    var roomId = channelName.replace(/^presence-/, '');

    if (!this._channels[channelName]) {
      this._channels[channelName] = new PusherChannel(channelName);
    }

    this._openWebSocket(roomId);

    // If the WS opened synchronously (unlikely but possible), attach now
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._channels[channelName]._attachWs(this._ws);
    }

    return this._channels[channelName];
  };

  PusherShim.prototype.unsubscribe = function(channelName) {
    delete this._channels[channelName];
  };

  PusherShim.prototype.disconnect = function() {
    if (this._ws) this._ws.close();
  };

  window.Pusher = PusherShim;
  console.log('[DrawIO RT] Pusher shim installed');

  // ── 3. Redirect /cache fetch() calls ─────────────────────────────────────
  var _originalFetch = window.fetch.bind(window);

  window.fetch = function(input, init) {
    var urlStr = typeof input === 'string' ? input
               : (input instanceof Request ? input.url : String(input));

    if (urlStr.includes('js.pusher.com') || urlStr.includes('pusher.com/')) {
      console.log('[DrawIO RT] fetch blocked (Pusher CDN):', urlStr);
      return Promise.reject(new Error('Pusher CDN blocked'));
    }

    if (/\/cache(\?|$)/.test(urlStr)) {
      var q   = new URL(urlStr, window.location.href).search;
      var dst = HTTP_BASE + q;
      console.log('[DrawIO RT] fetch /cache ->', dst);
      return _originalFetch(typeof input === 'string' ? dst : new Request(dst, input), init);
    }

    return _originalFetch(input, init);
  };

  // ── 4. Redirect /cache XHR calls ─────────────────────────────────────────
  var _XHRopen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    var args = Array.prototype.slice.call(arguments);
    if (typeof url === 'string' && /\/cache(\?|$)/.test(url)) {
      try {
        var q   = new URL(url, window.location.href).search;
        var dst = HTTP_BASE + q;
        console.log('[DrawIO RT] XHR /cache ->', dst);
        args[1] = dst;
      } catch (_) {}
    }
    return _XHRopen.apply(this, args);
  };

  // ── 5. Debug helpers ──────────────────────────────────────────────────────
  window.__drawioRT = {
    getConfig:   function() { return window.__drawioRealtimeConfig; },
    getChannels: function() { return window.Pusher && window.Pusher._channels; },
  };

  console.log('[DrawIO RT] Setup complete');
})();