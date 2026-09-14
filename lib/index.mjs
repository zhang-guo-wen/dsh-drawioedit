import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
//#region src/shim.ts
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
const SHIM_PATH = "/plugins/dsh-drawioedit/editor/__dsh-shim.js";
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
const SHIM_REVISION = 5;
/** The complete shim source served at {@link SHIM_PATH}. */
const SHIM_SOURCE = `(function () {
  'use strict';
  if (window.__dshShimInstalled) return;
  window.__dshShimInstalled = true;
  // Diagnostic surface: the host reads this to see how far the shim got, which
  // is the only way to tell a missing hook from a silent no-op.
  window.__dshShimState = { revision: 5, sawEditorUi: typeof window.EditorUi, hooked: false, installs: 0, loads: 0, reports: 0, saved: 0, keys: 0, errors: 0, lastError: null, saveFileOwned: false, rebound: [] };

  // The name of the file this editor was opened for, put in the URL by the pane.
  // It is read here rather than through drawio's own "title" parameter, which drawio
  // percent-decodes and would fail on a name that contains a percent sign.
  var diagramName = null;
  try {
    if (typeof urlParams !== 'undefined' && urlParams != null && urlParams.dshTitle != null) {
      diagramName = String(urlParams.dshTitle);
    }
  } catch (error) { /* the pane did not name the diagram */ }

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
    }, 1000);

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

})();
`;
/**
* Assert the assembled shim can be served as a script.
* @param source - the assembled shim source.
* @throws when the source is truncated, wrapped wrongly, or not inlinable.
*/
function assertShimUsable(source) {
	if (!source.startsWith("(function ()")) throw new Error("dsh-drawioedit: shim lost its wrapper");
	if (!source.trimEnd().endsWith("})();")) throw new Error("dsh-drawioedit: shim was truncated");
	if (source.includes("<\/script")) throw new Error("dsh-drawioedit: shim cannot be inlined");
	const braces = (source.match(/\{/g) ?? []).length - (source.match(/\}/g) ?? []).length;
	if (braces !== 0) throw new Error(`dsh-drawioedit: shim has unbalanced braces (${braces})`);
	if (source.includes("${")) throw new Error("dsh-drawioedit: shim body left an unexpanded placeholder");
}
assertShimUsable(SHIM_SOURCE);
//#endregion
//#region src/serve.ts
/**
* Serving the editor's static files.
*
* The editor is a whole application, so it needs its own files under a URL the
* app origin owns: the iframe must be same-origin with the harness frontend, or
* the parent cannot drive it at all. `ctx.webServer` is the route registry the
* host already exposes for exactly this, so the plugin claims one prefix rather
* than relying on any implicit asset mapping.
*
* Every served path is resolved against the editor root and rejected unless it
* stays inside it, because the request path is untrusted input.
*/
/** The URL prefix the editor's files are served under, with no trailing slash. */
const EDITOR_ROUTE = "/plugins/dsh-drawioedit/editor";
/** Absolute path of the editor directory that ships beside this module. */
const EDITOR_ROOT = resolve(fileURLToPath(new URL("../editor", import.meta.url)));
/**
* The editor's index with the shim injected between `bootstrap.js` and `main.js`
* so it is installed before the editor reads its hash. Injected at serve time
* rather than edited into the vendored file, so the upstream copy stays pristine
* and this remains visible in one place.
* @param html - the editor's index.html.
* @returns the index with the shim script inserted.
*/
function injectShim(html) {
	const tag = `<script src="${SHIM_PATH}"><\/script>`;
	const marker = "<script src=\"js/bootstrap.js\"><\/script>";
	if (!html.includes(marker)) return html;
	return html.replace(marker, `${marker}\n\t${tag}`);
}
/** Content types the editor loads; anything else is served as bytes. */
const CONTENT_TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".gif": "image/gif",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".xml": "text/xml; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".map": "application/json; charset=utf-8"
};
/**
* Resolve one request path to a file inside the editor root.
* @param pathname - the decoded request pathname.
* @returns the absolute file path, or undefined when it is outside this route.
*/
function editorFileFor(pathname) {
	if (pathname === "/plugins/dsh-drawioedit/editor") return join(EDITOR_ROOT, "index.html");
	if (!pathname.startsWith(`/plugins/dsh-drawioedit/editor/`)) return void 0;
	const relative = pathname.slice(31);
	if (relative === "") return join(EDITOR_ROOT, "index.html");
	let decoded;
	try {
		decoded = decodeURIComponent(relative);
	} catch {
		return;
	}
	const candidate = resolve(EDITOR_ROOT, normalize(decoded));
	if (candidate !== EDITOR_ROOT && !candidate.startsWith(EDITOR_ROOT + sep)) return void 0;
	return candidate;
}
/**
* Answer one request for an editor file.
*
* A prefix route is consulted for everything under its path, including paths
* whose `..` segments a client sent: URL parsing collapses those before this
* handler runs, so a request can arrive that no longer names this route at all.
* Such a request is refused rather than answered with the editor's index, which
* would turn path traversal into a 200.
* @param req - the incoming request.
* @param res - the response to own.
*/
async function serveEditorFile(req, res) {
	const pathname = new URL(req.url ?? "/", "http://x").pathname;
	if (pathname !== "/plugins/dsh-drawioedit/editor" && !pathname.startsWith(`/plugins/dsh-drawioedit/editor/`)) {
		res.writeHead(403).end("forbidden");
		return;
	}
	if (pathname === "/plugins/dsh-drawioedit/editor/__dsh-shim.js") {
		res.writeHead(200, {
			"content-type": "text/javascript; charset=utf-8",
			"content-length": String(Buffer.byteLength(SHIM_SOURCE, "utf8")),
			"cache-control": "no-store"
		}).end(SHIM_SOURCE);
		return;
	}
	const file = editorFileFor(pathname);
	if (file === void 0) {
		res.writeHead(403).end("forbidden");
		return;
	}
	if (pathname === `/plugins/dsh-drawioedit/editor/index.html` || pathname === "/plugins/dsh-drawioedit/editor") {
		const html = injectShim(await readFile(file, "utf8"));
		res.writeHead(200, {
			"content-type": "text/html; charset=utf-8",
			"content-length": String(Buffer.byteLength(html, "utf8")),
			"cache-control": "no-store"
		}).end(html);
		return;
	}
	let size;
	try {
		const info = await stat(file);
		if (!info.isFile()) throw new Error("not a file");
		size = info.size;
	} catch {
		res.writeHead(404).end("not found");
		return;
	}
	res.writeHead(200, {
		"content-type": CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
		"content-length": String(size),
		"cache-control": "public, max-age=86400"
	});
	await new Promise((settle) => {
		res.on("finish", settle);
		res.on("close", settle);
		const stream = createReadStream(file);
		stream.on("error", () => {
			res.destroy();
			settle();
		});
		stream.pipe(res);
	});
}
//#endregion
//#region src/save.ts
/** The URL the editor posts an edited diagram to. */
const SAVE_ROUTE = "/plugins/dsh-drawioedit/save";
/** The bytes one save may carry; a diagram is text, not a data store. */
const MAX_DIAGRAM_BYTES = 8388608;
/**
* Read a request body with a ceiling, refusing rather than truncating.
* @param req - the incoming request.
* @returns the body text.
* @throws when the body exceeds the ceiling.
*/
async function readBody(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		total += buffer.length;
		if (total > 8388608) throw new Error("body too large");
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}
/**
* Validate one parsed save request.
* @param body - the parsed JSON body.
* @returns the path, XML, and optional version.
* @throws when a required field is missing or malformed.
*/
function parseSaveRequest(body) {
	if (typeof body !== "object" || body === null) throw new Error("body must be an object");
	const { path, xml, version } = body;
	if (typeof path !== "string" || path === "") throw new Error("path must be a non-empty string");
	if (typeof xml !== "string" || xml === "") throw new Error("xml must be a non-empty string");
	if (version !== void 0 && typeof version !== "string") throw new Error("version must be a string");
	return {
		path,
		xml,
		version
	};
}
/**
* Write a diagram back to the file it came from.
* @param ctx - host context carrying the filesystem seam.
* @param path - the path the file was read from.
* @param xml - the diagram XML the editor reported.
* @param expectedVersion - the version token the read observed, when captured.
* @returns the write outcome.
* @throws when the diagram exceeds the byte ceiling or the path cannot be resolved.
*/
async function writeDiagram(ctx, path, xml, expectedVersion) {
	if (Buffer.byteLength(xml, "utf8") > 8388608) throw new Error(`dsh-drawioedit: diagram exceeds ${MAX_DIAGRAM_BYTES} bytes`);
	const fs = ctx.fs;
	const target = await fs.resolve(path);
	const expected = expectedVersion === void 0 ? void 0 : {
		kind: "replaceIfVersion",
		version: expectedVersion
	};
	return await fs.writeText(target, xml, expected);
}
/**
* Answer one save request.
* @param ctx - host context carrying the filesystem seam.
* @param req - the incoming request.
* @param res - the response to own.
*/
async function serveSaveRequest(ctx, req, res) {
	if (req.method !== "POST") {
		res.writeHead(405).end("method not allowed");
		return;
	}
	try {
		const { path, xml, version } = parseSaveRequest(JSON.parse(await readBody(req)));
		const outcome = await writeDiagram(ctx, path, xml, version);
		const written = typeof outcome === "object" && outcome !== null ? outcome.version : void 0;
		res.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify({
			ok: true,
			version: typeof written === "string" ? written : ""
		}));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		res.writeHead(400, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify({
			ok: false,
			error: message
		}));
	}
}
//#endregion
//#region src/params.ts
/**
* The editor's URL, as one value both halves and the tests agree on.
*
* These are strings, not behavior: the client assigns the URL to the iframe, the
* host serves the document it names, and the tests load the very same URL, so the
* parameter list that keeps the editor offline has exactly one home.
*/
/** Where the editor's entry document is served from, relative to the app origin. */
const EDITOR_PATH = "/plugins/dsh-drawioedit/editor/index.html";
/**
* Cloud integrations the editor must not start, and the parameter that turns each
* one off (drawio's `urlParams`, read by App.js).
*
* Left at its default, each of these loads a third-party SDK over the network:
* the Google API client for Drive, Dropbox's `dropins.js`, OneDrive, Microsoft
* 365, Trello's client, and the Pusher socket the collaboration feature dials.
* The plugin promises that a diagram never leaves the machine, and none of them
* can be used from a preview pane, so every one is off.
*/
const DISABLED_INTEGRATIONS = {
	gapi: "0",
	db: "0",
	od: "0",
	ms365: "0",
	drive: "0",
	picker: "0",
	tr: "0",
	sockets: "0"
};
/**
* Build the editor URL that loads `xml` without any handshake.
*
* drawio's bootstrap reads URL parameters from a `#P` hash whose JSON may carry
* the diagram as a `hash` field; it then restores that value as the real
* `location.hash` (`#R` + encoded XML) before the app reads it. A bare `#R` hash
* is ignored, so both layers are required.
*
* `client: 1` marks the embedder as a host application, which is what the app
* expects when it is driven programmatically rather than opened by a user.
* `dshTitle` is this package's own parameter, carrying the name of the file the pane
* opened so the editor can label the diagram with it. drawio's own `title` parameter
* is not used for that: drawio percent-decodes it, and a file name may contain a
* percent sign.
* @param xml - the diagram XML to open.
* @param origin - origin the editor is served from; empty means same origin.
* @param title - the file's name, which the editor shows in its title bar.
* @returns the absolute URL to assign to the iframe.
*/
function editorUrl(xml, origin = "", title = "") {
	const params = JSON.stringify({
		client: "1",
		...DISABLED_INTEGRATIONS,
		...title === "" ? {} : { dshTitle: title },
		hash: "#R" + encodeURIComponent(xml)
	});
	return `${origin}${EDITOR_PATH}#P${encodeURIComponent(params)}`;
}
//#endregion
//#region src/index.ts
/** Required host services: the route registry and the filesystem seam. */
const inject = ["webServer", "fs"];
/**
* Host plugin body: claim the editor's URL prefix and the save endpoint.
* @param ctx - host context carrying the route registry and the filesystem seam.
*/
function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: EDITOR_ROUTE,
		handler: serveEditorFile
	}), "dsh-drawioedit: editor assets");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: SAVE_ROUTE,
		handler: (req, res) => serveSaveRequest(ctx, req, res)
	}), "dsh-drawioedit: save endpoint");
}
//#endregion
export { EDITOR_PATH, EDITOR_ROUTE, SAVE_ROUTE, SHIM_PATH, SHIM_REVISION, SHIM_SOURCE, apply, assertShimUsable, editorUrl, inject };
