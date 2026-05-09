# Engineering Challenges: Real-Time Collaboration for draw.io in Nextcloud

This document records the problems encountered and approaches tried while building GDPR-compliant real-time collaborative editing for self-hosted draw.io embedded in Nextcloud. It is written for engineers who maintain or extend this system.

## Goal

draw.io's built-in real-time collaboration uses **Pusher.com** (a US-based cloud push service) as its message broker and Cludflare. When draw.io runs self-hosted and embedded inside a Nextcloud iframe, we needed to replace Pusher with a local server — without modifying draw.io's own source code — for GDPR compliance.

The target: moving an object in one browser tab must appear in all other open tabs within a second.

---

## Challenge 1: Blocking Pusher Without Breaking draw.io

draw.io loads `pusher.js` from `js.pusher.com` via its internal `mxscript()` loader. Simply blocking the network request caused draw.io to hang waiting for the script.

**Solution:** Intercept `window.mxscript` before draw.io defines it. The shim calls `onload()` immediately for any `pusher.com` URL without making a network request, so draw.io's initialization continues normally and hits our `window.Pusher` shim.

`Object.defineProperty` was used first, but draw.io overwrites `window.mxscript` itself using its own `defineProperty`, defeating the setter. The fix: intercept the assignment by defining a setter before draw.io's own setter fires, then wrap the value draw.io installs.

---

## Challenge 2: Pusher Shim — Channel Bindings Were Always Empty

The Pusher shim intercepts `new Pusher()`, `pusher.subscribe(channelName)`, and `channel.bind(eventName, callback)`. The plan was for draw.io to call `channel.bind('message', callback)` with its update handler, which the shim would call whenever a WebSocket message arrived.

**What actually happened:** In Nextcloud's embed mode (`embedRT=1`), draw.io never calls `channel.bind('message', cb)`. It only binds to `connection.bind('error')` and `connection.bind('state_change')`. All our channel dispatch code was dead.

**Root cause:** In embed mode, draw.io delegates real-time updates to the parent Nextcloud frame via `postMessage` / `remoteInvoke`. It uses `/cache` for HTTP polling and Pusher only for error signaling, not for receiving diagram updates.

**Consequence:** The Pusher channel path was removed entirely. The channel shim still exists to prevent draw.io from crashing when it calls `pusher.subscribe()`, but it carries no messages.

---

## Challenge 3: Finding the Right postMessage Format

Since draw.io in embed mode receives updates via `window.postMessage` from Nextcloud, the first approach was to inject fake postMessages that draw.io would process as remote updates.

We intercepted all `window.addEventListener('message', ...)` calls at `PreConfig.js` load time to capture draw.io's registered handlers, then called them directly with a synthetic event object. Five message formats were tried:

| Format tried | Result |
|---|---|
| `{action:'remoteInvoke', service:'...', method:'realtimeMessage', args:[...]}` | Crash — `t.callbackId` undefined in Nextcloud's `editor.js` |
| `{action:'realtimeMessage', data:{msg:encryptedXml}}` | `unknownMessage` error in draw.io console |
| `{action:'realtimeMessage', msg:encryptedXml}` | `unknownMessage` |
| `{action:'merge', msg:encryptedXml}` | Silently ignored — `msg` field not the expected key |
| `{action:'merge', xml:plainXml}` | Accepted — no error, no crash |

The `{action:'merge', xml:plainXml}` format was accepted by draw.io's message handler. However, objects did not visually move on the receiving tab (see Challenge 6).

---

## Challenge 4: The AES Encryption Key Was Unreachable

draw.io encrypts diagram XML with AES before POSTing it to `/cache`. The encryption key is a random string generated once per session and stored in a local closure inside `app.min.js` — it is never exposed on `window` and is not derived from any observable value.

Approaches tried to recover the key:

- **Patching `CryptoJS.AES.encrypt`** via polling: the patch fires and receives both the plaintext and the key. However, draw.io captured a reference to the original `CryptoJS.AES.encrypt` before the patch was applied (closures in minified code), so the patched version was never called during actual diagram saves.
- **Capturing the Nextcloud file etag** from `remoteInvokeResponse` messages: the etag (`c677e4641ca9d8...`) is a Nextcloud file version hash, not the AES passphrase.
- **Trying the roomId and its variants** as key candidates: `C-abc123`, without `C-` prefix, with `presence-` prefix — all produced garbage on decryption.

**Conclusion:** The AES key cannot be recovered from outside draw.io's closure. This path was abandoned entirely. The working solution avoids encryption by relaying the diagram XML in plaintext over our own WebSocket channel.

---

## Challenge 5: BroadcastChannel Partitioned by Firefox

The first cross-tab relay attempt used `BroadcastChannel('drawio-rt')`. When Tab A's model changed, it posted `{type:'xml', xml:...}` on the channel. Tab B's `onmessage` handler would receive it and apply the update.

**What actually happened in Firefox:** Firefox's Total Cookie Protection partitions the storage APIs (including `BroadcastChannel`, `localStorage`, and `IndexedDB`) for third-party iframes. draw.io at `drawio-dev.fairkom.net` running inside a Nextcloud page at `test.faircloud.eu` is a third-party iframe context. Firefox creates a separate partition for each top-level site, so:

- Tab A's `BroadcastChannel('drawio-rt')` and Tab B's `BroadcastChannel('drawio-rt')` are in different partitions.
- Messages posted on one never arrive at the other.

The browser console logged: `Partitioned cookie or storage access was provided to "https://drawio-dev.fairkom.net/..." because it is loaded in the third-party context and dynamic state partitioning is enabled.`

`localStorage` is similarly partitioned, which also affected the roomId sharing mechanism (mitigated by falling back to any open WebSocket room).

**Fix:** Replace BroadcastChannel with the WebSocket relay. Since both tabs connect to the same server room, the server can broadcast messages between them regardless of browser storage partitioning.

---

## Challenge 6: `{action:'merge', xml:...}` Did Not Move Objects

Even after establishing that draw.io accepted `{action:'merge', xml:plainXml}` without error, objects did not move in the receiving tab.

The injected fake event had the correct `origin` (`https://test.faircloud.eu`, captured from the first real postMessage) and `source: window.parent`. draw.io's handler parsed the XML without throwing. Yet the diagram was unchanged.

The investigation pointed to how draw.io's `merge` action actually applies changes in embed mode: it does a structural merge that adds new cells and new pages but does not overwrite existing cell geometry (positions, sizes). Moving a cell changes its geometry — an existing cell in the model — which the `merge` action's implementation treats as already present and skips.

**Fix:** Bypass the postMessage layer entirely. Use mxGraph's own codec API directly:

```javascript
var doc = mxUtils.parseXml(xml);
graph.model.beginUpdate();
try { new mxCodec(doc).decode(doc.documentElement, graph.model); }
finally { graph.model.endUpdate(); }
```

`mxCodec.decode` with the target model as the second argument updates each cell in-place by matching IDs, including geometry changes. This is the same code path draw.io uses internally when loading a diagram — it reliably moves objects to their new positions and triggers a full redraw.

---

## Challenge 7: Late-Joining Tabs Got Stale State

When Tab B opened after Tab A had already moved objects, the server sent Tab B the last entry from `room.updates` — the encrypted HTTP POST cache. Tab B could not decrypt it (see Challenge 4), so it displayed whatever Nextcloud had sent it via postMessage (potentially the pre-move diagram).

**Fix:** The server now also caches the last `{type:'xml'}` WebSocket message in `room.lastXml`. When a new client connects:

1. If `room.lastXml` exists → send `{type:'xml', xml:room.lastXml}`. The client applies it immediately with `mxCodec.decode`.
2. Otherwise → fall back to the encrypted HTTP cache (best-effort, may not be decryptable).

---

## Challenge 8: Timing the Test Correctly

Early tests appeared to show the WebSocket relay wasn't working. The logs showed Tab A sending at 19:06:51 and Tab B receiving only encrypted blobs at 19:09:32. This was misread as a relay failure.

The actual reason: Tab B connected at 19:09:21 — **three minutes after** Tab A sent the relay. The server only broadcasts to currently connected clients; there is no replay queue for WebSocket relay messages (only for the HTTP cache). Tab B simply wasn't there when Tab A sent.

Once both tabs were open simultaneously before Tab A moved an object, the relay arrived at Tab B in under one second.

---

## What Was Removed vs. What Was Kept

| Component | Status | Reason |
|---|---|---|
| Pusher CDN block (mxscript) | Kept | GDPR — Pusher.com must never be contacted |
| Pusher shim (`window.Pusher`) | Kept (stub) | draw.io crashes without it |
| Pusher channel dispatch | Removed | draw.io never calls `channel.bind('message')` in embed mode |
| AES decrypt attempts | Removed | Key is unrecoverable from outside draw.io's closure |
| CryptoJS.AES.encrypt patch | Removed | draw.io held a pre-patch reference; patch never triggered on saves |
| BroadcastChannel XML relay | Removed | Firefox partitions it for third-party iframes |
| `{action:'merge'}` postMessage injection | Kept as fallback only | Works for adding cells; fails for position changes |
| `mxCodec.decode` direct apply | Primary mechanism | Reliably updates cell positions and triggers redraw |
| `room.lastXml` server cache | Added | Gives late-joining tabs the current diagram state |

---

## Final Data Flow

```
Tab A: user moves object
  → mxGraph model 'change' event
  → mxCodec.encode(graph.model) → plain XML
  → ws.send({type:'xml', xml})                    [WebSocket to server]

Server:
  → room.lastXml = xml                            [cache for late joiners]
  → room.broadcast({type:'xml', xml}, senderWs)  [relay to all other tabs]

Tab B:
  → ws 'message' event
  → mxUtils.parseXml(xml)
  → _applyingRemote = true                        [prevents echo loop]
  → graph.model.beginUpdate()
  → mxCodec.decode(doc.documentElement, graph.model)
  → graph.model.endUpdate()                       [triggers redraw]
  → setTimeout(() => _applyingRemote = false, 1s)
```
