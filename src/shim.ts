/**
 * The pre-load shim injected into the editor's index.html.
 *
 * drawio's `#create=` handshake is unusable from a same-origin iframe: its
 * message listener returns before doing anything unless
 * `evt.source == (window.opener || window.parent)` (App.js), an identity check
 * written for the popup window `Embed.js` opens. In an iframe the comparison
 * fails and the listener returns silently, so a payload posted by the host is
 * dropped with no error anywhere.
 *
 * The editor also keeps its instance in a closure: the DOM carries no reference
 * to it and no global exposes it (verified against the shipped build), and
 * `window.EditorUi` does not exist yet when this shim runs. So the shim
 * intercepts the assignment of that global, wraps the class in the same step, and
 * captures the instance when it is constructed.
 *
 * With the instance captured, the shim:
 *   - loads a diagram the host sends as `{action:'create', data}`, calling the
 *     same `executeCreateObject` the built-in listener would have called;
 *   - reports edits back as `{event:'autosave', xml}`, the message the plugin's
 *     save path already listens for.
 *
 * Everything is guarded: if any step fails, or the instance never appears, the
 * shim does nothing and the editor still loads and runs normally.
 */

/** Where the shim is served from, under the editor route. */
export const SHIM_PATH = '/plugins/dsh-drawioedit/editor/__dsh-shim.js'

/**
 * Which shim the browser is running.
 *
 * The shim is host-half code: it is served from the host process's memory, so
 * editing it changes nothing until the host restarts, and a restarted host with a
 * cached copy changes nothing either. That is indistinguishable from a broken
 * editor from the outside, so the shim reports its own revision and
 * `window.__dshShimState.revision` answers "which one am I running".
 *
 * 2: capture forwards to the live class through a Proxy, rather than wrapping it
 *    and freezing the prototype it had when drawio assigned the global.
 * 3: the commands that mean save write the file back instead of opening drawio's
 *    download flow, and a confirmed write clears drawio's unsaved-changes notice.
 * 4: save is intercepted where every command funnels into it, not on the action
 *    objects -- the File menu had already captured those; the diagram is named after
 *    the file the pane opened.
 * 5: popups are fitted against the frame rather than the document, and the document
 *    holds no scroll position, so a menu opens at its menu bar.
 */
export const SHIM_REVISION = 5

/** How often the shim checks whether the edited diagram changed, in ms. */
const POLL_MS = 1000

/**
 * The shim body, placed inside the wrapper below.
 *
 * This is a template literal, so it must contain no backtick and no `${`
 * sequence: either would close the literal early and ship a truncated script.
 * `assertShimUsable` enforces that at module load.
 */
const BODY = `
  function install(ui) {
    if (ui == null || ui.__dshInstalled) return;
    ui.__dshInstalled = true;
    window.__dshShimState.installs++;

    // The graph hangs off the editor, not off the UI: EditorUi's constructor keeps
    // its graph in a local and only ever publishes "editor", which is why drawio's
    // own code reads this.editor.graph (EditorUi.js). Reading ui.graph found
    // nothing, so every read returned null and the editor never reported an edit --
    // which is what "it does not save by itself" looked like from the pane.
    function graphOf() {
      if (ui.graph != null) return ui.graph;
      if (ui.editor != null && ui.editor.graph != null) return ui.editor.graph;
      return null;
    }

    function ready() {
      var graph = graphOf();
      return graph != null && graph.getModel != null;
    }

    function currentXml() {
      if (!ready()) return null;
      try {
        return ui.getFileData(true);
      } catch (error) {
        // Reading the diagram is the one step that can fail silently: every caller
        // treats a null as "nothing to report", so the failure is recorded here or
        // it is indistinguishable from a diagram that never changed.
        window.__dshShimState.errors++;
        window.__dshShimState.lastError = String(error).slice(0, 160);
        return null;
      }
    }

    function load(data) {
      try {
        ui.executeCreateObject(data);
        window.__dshShimState.loads++;
        return true;
      } catch (error) {
        return false;
      }
    }

    function post(xml) {
      window.__dshShimState.reports++;
      try {
        window.parent.postMessage(JSON.stringify({ event: 'autosave', xml: xml }), '*');
      } catch (error) { /* the host went away */ }
    }

    // The write is the host's, and only the host knows whether it landed. Until it
    // answers, drawio keeps saying "Unsaved changes. Click here to save.", which is
    // how a write that did succeed looks like one that did not.
    function markSaved() {
      try { if (ui.editor != null) ui.editor.setModified(false); } catch (error) { /* older builds */ }
      try {
        var saved = typeof mxResources === 'undefined' || mxResources.get == null
          ? null
          : mxResources.get('allChangesSaved');
        if (saved != null && ui.editor != null && ui.editor.setStatus != null) {
          ui.editor.setStatus('<div title="' + saved + '">' + saved + '</div>');
        }
      } catch (error) { /* the status area is cosmetic */ }
    }

    function saveNow() {
      var xml = currentXml();
      if (xml == null) return;
      last = xml;
      post(xml);
    }

    // Names the diagram after the file the pane opened, which is otherwise "Untitled
    // Diagram": the editor is given a diagram, not a file, so it has no name for it.
    function nameIt() {
      if (diagramName == null) return;
      try { if (ui.editor != null && ui.editor.setFilename != null) ui.editor.setFilename(diagramName); } catch (error) { /* older builds */ }
      try {
        var label = document.querySelector('.geFilename');
        if (label != null && label.textContent !== diagramName) label.textContent = diagramName;
      } catch (error) { /* the toolbar does not exist yet */ }
    }

    // Every save command funnels into this one method: the File menu items, the
    // toolbar button, the status banner's "click here to save", and the keyboard
    // shortcut all call ui.saveFile through an action. The menu captured its action
    // when the menu was built, before this shim had an instance to change, so
    // replacing the action is not enough -- this is the call they all reach.
    // Export as still produces a copy, which is where a copy belongs.
    function interceptSave() {
      try {
        if (typeof ui.saveFile !== 'function') return;
        if (ownSave == null) window.__dshShimState.rebound.push('saveFile');
        // Re-applied rather than set once: whatever replaces this method would put
        // drawio's own save back, which opens a dialog instead of writing the file.
        if (ui.saveFile !== ownSave) {
          ownSave = function () { saveNow(); };
          ui.saveFile = ownSave;
        }
        window.__dshShimState.saveFileOwned = ui.saveFile === ownSave;
      } catch (error) { /* a frozen instance leaves the poll and the key below */ }
    }

    // Rebinding the action objects still matters for the status banner, which looks
    // its action up when it is clicked rather than holding one.
    function rebind(name) {
      try {
        if (ui.actions == null || ui.actions.get == null) return;
        var action = ui.actions.get(name);
        if (action != null && action.funct != null) {
          action.funct = function () { saveNow(); };
          window.__dshShimState.rebound.push(name);
        }
      } catch (error) { /* older builds: the poll below still reports edits */ }
    }

    // drawio fits its own popups against the document it measures, which is the right
    // frame for a page. This editor is an application that fills its frame, so a popup
    // is kept inside the frame as well: one with room below keeps the position it was
    // asked for and is capped, because drawio scrolls a capped menu inside itself, and
    // one with nowhere to go is moved up. The popup's own box is read, never where it
    // renders, so this cannot chase its own correction.
    function keepPopupsInFrame() {
      try {
        if (typeof mxUtils === 'undefined' || mxUtils == null || typeof mxUtils.fit !== 'function') return;
        if (mxUtils.fit.__dshFramed) return;
        var original = mxUtils.fit;
        var framed = function (div) {
          try {
            original(div);
            var top = parseInt(div.style.top, 10);
            if (isNaN(top)) return;
            var height = div.offsetHeight;
            var room = window.innerHeight - top - 8;
            if (height > room && room >= 120) {
              div.style.maxHeight = room + 'px';
            } else if (height > room) {
              div.style.top = Math.max(0, window.innerHeight - height) + 'px';
            }
          } catch (error) { /* drawio's own placement stands */ }
        };
        framed.__dshFramed = true;
        mxUtils.fit = framed;
        window.__dshShimState.rebound.push('mxUtils.fit');
      } catch (error) { /* an older build without mxUtils.fit */ }
    }

    // The document is an application frame, not a page. drawio measures the document's
    // scroll origin to place popups (mxUtils.fit), and its overflow is hidden, so a
    // position left behind by a focus move would shift them with nothing on screen to
    // explain it.
    function pinDocument() {
      try { if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0; } catch (error) { /* nothing to pin */ }
      try { if (document.body.scrollTop !== 0) document.body.scrollTop = 0; } catch (error) { /* nothing to pin */ }
    }

    var last = null;
    var adopting = false;
    var ownSave = null;

    window.setInterval(function report() {
      nameIt();
      interceptSave();
      keepPopupsInFrame();
      pinDocument();
      var xml = currentXml();
      if (xml == null) return;
      if (adopting) {
        // A host-supplied diagram is not a user edit: adopt it as the baseline.
        last = xml;
        adopting = false;
        return;
      }
      if (last == null) { last = xml; return; }
      if (xml === last) return;
      last = xml;
      post(xml);
    }, ${POLL_MS});

    window.addEventListener('message', function (event) {
      var message = null;
      try { message = JSON.parse(event.data); } catch (error) { return; }
      if (message == null) return;
      if (message.action === 'saved') {
        window.__dshShimState.saved++;
        markSaved();
        return;
      }
      if (message.action !== 'create' || message.data == null) return;
      adopting = true;
      var tries = 0;
      (function attempt() {
        if (load(message.data) || tries++ > 100) return;
        window.setTimeout(attempt, 100);
      })();
    }, false);

    rebind('save');
    rebind('saveAs');
    interceptSave();
    nameIt();

    // mxUtils and the actions only exist once the editor's own bundle has loaded, and a
    // user can open a menu before the first poll tick a second later, so the patches go
    // on as soon as their targets exist.
    var attempts = 0;
    var early = window.setInterval(function setup() {
      attempts++;
      interceptSave();
      keepPopupsInFrame();
      pinDocument();
      var ready = window.__dshShimState.saveFileOwned === true
        && window.__dshShimState.rebound.indexOf('mxUtils.fit') >= 0;
      if (ready || attempts > 100) window.clearInterval(early);
    }, 100);

    // The scroll that matters arrives from a focus move at any time, so it is
    // corrected as it happens rather than on the next poll.
    window.addEventListener('scroll', pinDocument, true);

    // A safety net for the shortcut: the action above is what drawio's key handler
    // is expected to call, and a second post of the same diagram is harmless because
    // the host serialises writes and keeps only the newest pending one.
    window.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && String(event.key).toLowerCase() === 's') {
        window.__dshShimState.keys++;
        event.preventDefault();
        saveNow();
      }
    }, true);
  }

  // Capture the instance at construction time. window.EditorUi does not exist yet
  // -- main.js defines it after this shim runs -- so intercept the assignment and
  // wrap the class in the same step.
  //
  // The wrapper must forward, never copy. drawio assigns the class global before it
  // finishes the class: the mxEventSource mixin arrives later, and it replaces the
  // prototype. A wrapper holding the prototype it saw at assignment time therefore
  // kept the pre-mixin object, and subclasses built from it -- Editor among them --
  // constructed without setEventSource. drawio caught that TypeError, logged
  // "SEVERE this.setEventSource is not a function", and left its splash page up.
  //
  // A Proxy keeps every read and write on the live class, including the prototype.
  var seen = new WeakSet();

  function capture(Original) {
    if (Original == null || seen.has(Original)) return Original;
    window.__dshShimState.hooked = true;
    var captured = new Proxy(Original, {
      construct: function (target, args, newTarget) {
        var instance = Reflect.construct(target, args, newTarget);
        try { install(instance); } catch (error) { /* never break construction */ }
        return instance;
      },
      // mxgraph subclasses by calling the base constructor on an existing receiver
      // -- EditorUi.call(this, ...) -- which is a plain call, not a construction.
      apply: function (target, receiver, args) {
        var result = Reflect.apply(target, receiver, args);
        try { install(receiver); } catch (error) { /* never break construction */ }
        return result;
      },
    });
    seen.add(Original);
    seen.add(captured);
    return captured;
  }

  (function () {
    var stored = window.EditorUi;
    try {
      Object.defineProperty(window, 'EditorUi', {
        configurable: true,
        get: function () { return stored; },
        set: function (next) { stored = capture(next); },
      });
    } catch (error) {
      // A non-configurable global leaves only the late path: wrap what is there.
      if (stored != null) window.EditorUi = capture(stored);
    }
  })();
`

/** The complete shim source served at {@link SHIM_PATH}. */
export const SHIM_SOURCE = `(function () {
  'use strict';
  if (window.__dshShimInstalled) return;
  window.__dshShimInstalled = true;
  // Diagnostic surface: the host reads this to see how far the shim got, which
  // is the only way to tell a missing hook from a silent no-op.
  window.__dshShimState = { revision: ${SHIM_REVISION}, sawEditorUi: typeof window.EditorUi, hooked: false, installs: 0, loads: 0, reports: 0, saved: 0, keys: 0, errors: 0, lastError: null, saveFileOwned: false, rebound: [] };

  // The name of the file this editor was opened for, put in the URL by the pane.
  // It is read here rather than through drawio's own "title" parameter, which drawio
  // percent-decodes and would fail on a name that contains a percent sign.
  var diagramName = null;
  try {
    if (typeof urlParams !== 'undefined' && urlParams != null && urlParams.dshTitle != null) {
      diagramName = String(urlParams.dshTitle);
    }
  } catch (error) { /* the pane did not name the diagram */ }
${BODY}
})();
`

/**
 * Assert the assembled shim can be served as a script.
 * @param source - the assembled shim source.
 * @throws when the source is truncated, wrapped wrongly, or not inlinable.
 */
export function assertShimUsable(source: string): void {
  if (!source.startsWith('(function ()')) throw new Error('dsh-drawioedit: shim lost its wrapper')
  if (!source.trimEnd().endsWith('})();')) throw new Error('dsh-drawioedit: shim was truncated')
  if (source.includes('</script')) throw new Error('dsh-drawioedit: shim cannot be inlined')
  const braces = (source.match(/\{/g) ?? []).length - (source.match(/\}/g) ?? []).length
  if (braces !== 0) throw new Error(`dsh-drawioedit: shim has unbalanced braces (${braces})`)
  if (source.includes('${')) throw new Error('dsh-drawioedit: shim body left an unexpanded placeholder')
}

assertShimUsable(SHIM_SOURCE)
