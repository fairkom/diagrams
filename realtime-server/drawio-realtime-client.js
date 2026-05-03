/**
 * Draw.io Real-Time Collaboration Client Integration
 * 
 * This script patches draw.io to use the local real-time server
 * instead of Cloudflare's infrastructure.
 * 
 * Insert this script in the draw.io HTML before the main app.min.js
 */

(function() {
  // Determine the real-time server URL
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;
  const port = window.location.port ? ':' + window.location.port : '';
  
  // Real-time server is expected at the same host but on a different port internally
  // Via Ingress, it will be proxied to drawio-realtime:8081
  const realtimeServerUrl = `${protocol}//${host}${port}/realtime`;
  
  // Override the real-time API endpoint
  window.__drawioRealtimeConfig = {
    enabled: true,
    serverUrl: realtimeServerUrl,
    collabEnabled: true,
  };

  // Patch mxResources to include real-time strings if needed
  if (window.mxResources) {
    window.mxResources.set('realtime', 'Real-time Collaboration');
  }

  console.log('[DrawIO RT] Real-time server configured:', realtimeServerUrl);

  // Hook into the app initialization to inject real-time support
  const originalAddEventListener = window.addEventListener;
  window.addEventListener = function(type, listener, options) {
    if (type === 'load') {
      const wrappedListener = function(event) {
        // Inject real-time support after app loads
        if (window.EditorUi && window.EditorUi.prototype) {
          initializeRealtimeSupport();
        }
        return listener.call(this, event);
      };
      return originalAddEventListener.call(this, type, wrappedListener, options);
    }
    return originalAddEventListener.call(this, type, listener, options);
  };

  /**
   * Initialize real-time collaboration support
   */
  function initializeRealtimeSupport() {
    console.log('[DrawIO RT] Initializing real-time support...');
    
    // Monitor for collaboration requests
    if (window.EditorUi.prototype.share) {
      const originalShare = window.EditorUi.prototype.share;
      window.EditorUi.prototype.share = function() {
        console.log('[DrawIO RT] Share function called, using local real-time server');
        return originalShare.apply(this, arguments);
      };
    }

    // Hook into any network calls to redirect to local server
    monitorNetworkCalls();
  }

  /**
   * Monitor and redirect network calls related to real-time collaboration
   */
  function monitorNetworkCalls() {
    const originalFetch = window.fetch;
    
    window.fetch = function(url, options) {
      // Redirect real-time requests to local server
      if (typeof url === 'string' && url.includes('/rt')) {
        const realtimeUrl = url.replace(/https?:\/\/[^\/]+/, window.__drawioRealtimeConfig.serverUrl);
        console.log('[DrawIO RT] Redirecting to local server:', realtimeUrl);
        return originalFetch(realtimeUrl, options);
      }
      return originalFetch(url, options);
    };
  }

  // Expose API for debugging
  window.__drawioRT = {
    getServerUrl: () => realtimeServerUrl,
    getConfig: () => window.__drawioRealtimeConfig,
    log: (msg) => console.log('[DrawIO RT]', msg)
  };
})();
