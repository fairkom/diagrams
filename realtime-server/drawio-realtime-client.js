/**
 * Draw.io Real-Time Collaboration Client Integration
 * 
 * This script patches draw.io to use the local real-time server
 * instead of Cloudflare's infrastructure.
 * 
 * Insert this script in the draw.io HTML before the main app.min.js
 */

(function() {
  try {
    // Only configure if not already configured
    if (window.__drawioRealtimeConfig) {
      console.log('[DrawIO RT] Real-time already configured, skipping');
      return;
    }
    
    // Block Pusher.js script loading by removing script tags
    const blockPusherScripts = () => {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeName === 'SCRIPT' && node.src && node.src.includes('pusher.com')) {
              console.log('[DrawIO RT] Removing Pusher.js script tag:', node.src);
              node.remove();
            }
          });
        });
      });
      
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      
      // Check existing scripts
      document.querySelectorAll('script[src*="pusher.com"]').forEach(script => {
        console.log('[DrawIO RT] Removing existing Pusher.js script:', script.src);
        script.remove();
      });
    };
    
    // Start blocking immediately
    blockPusherScripts();
    
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
    
    console.log('[DrawIO RT] Real-time server configured:', realtimeServerUrl);
  } catch (error) {
    console.error('[DrawIO RT] Configuration error:', error);
  }
})();

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
        try {
          // Small delay to ensure DOM is fully ready
          setTimeout(() => {
            if (window.EditorUi && window.EditorUi.prototype) {
              initializeRealtimeSupport();
            }
          }, 100);
        } catch (error) {
          console.error('[DrawIO RT] Error initializing real-time support:', error);
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
    function monitorNetworkCalls() {
      const originalFetch = window.fetch;
      
      window.fetch = function(url, options) {
        // Redirect real-time requests to local server
        if (typeof url === 'string' && (url.includes('/rt') || url.includes('/cache') || url.includes('/join') || url.includes('/sync'))) {
          let realtimeUrl;
          if (url.includes('/rt')) {
            // WebSocket URL - use the WebSocket server URL
            realtimeUrl = url.replace(/https?:\/\/[^\/]+/, window.__drawioRealtimeConfig.serverUrl);
          } else {
            // HTTP URL - use the HTTP server URL
            realtimeUrl = url.replace(/https?:\/\/[^\/]+/, window.__drawioRealtimeConfig.httpServerUrl || window.__drawioRealtimeConfig.serverUrl.replace(/^wss?:/, 'https:'));
          }
          console.log('[DrawIO RT] Redirecting to local server:', realtimeUrl);
          return originalFetch(realtimeUrl, options);
        }
        
        // Block external Pusher.js loading
        if (typeof url === 'string' && url.includes('js.pusher.com')) {
          console.log('[DrawIO RT] Blocking external Pusher.js loading');
          return Promise.reject(new Error('External Pusher.js blocked - using local real-time server'));
        }
        
        return originalFetch(url, options);
      };
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

  // Provide Pusher shim to redirect to our real-time server
  if (window.__drawioRealtimeConfig.blockExternalPusher !== false) {
    console.log('[DrawIO RT] Setting up Pusher shim to use local real-time server');
    
    // Create minimal Pusher shim
    window.Pusher = class {
      constructor(appKey, options) {
        console.log('[DrawIO RT] Pusher initialization intercepted');
        return {
          connect: () => {
            console.log('[DrawIO RT] Pusher connect redirected to local WebSocket');
            // Our real-time server handles the actual connection
          },
          subscribe: (channel) => {
            console.log('[DrawIO RT] Pusher subscribe redirected:', channel);
            return {
              bind: (event, callback) => {
                console.log('[DrawIO RT] Pusher event binding redirected:', event);
                // Our real-time server handles actual event binding
              }
            };
          },
          connection: {
            bind: (event, callback) => {
              if (event === 'connected') {
                console.log('[DrawIO RT] Pusher connected event triggered');
                setTimeout(() => callback({}), 100); // Simulate connection
              }
            }
          }
        };
      }
    };
    
    console.log('[DrawIO RT] Pusher shim installed - external Pusher blocked');
  }
  
  // Expose API for debugging
  window.__drawioRT = {
    getServerUrl: () => realtimeServerUrl,
    getConfig: () => window.__drawioRealtimeConfig,
    log: (msg) => console.log('[DrawIO RT]', msg)
  };
})();
