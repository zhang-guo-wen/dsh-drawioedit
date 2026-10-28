window.__ModuleLoader__.load({
	id: "@guowenzhang/dsh-drawioedit",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region node_modules/@deepseek-ai/dsh-util-workspace-path/lib/index.js
		/**
		* The `dsh-resource://file/…` address grammar: how a file is named across the
		* Sidebar and the resource model, built and parsed without touching a
		* filesystem.
		* @module
		*/
		/** The scheme and type every file address opens with. */
		const FILE_ADDRESS_PREFIX = "dsh-resource://file/";
		/** Component-encode one id or path segment, keeping `:` literal for drive letters. */
		function encodeSegment(segment) {
			return encodeURIComponent(segment).replace(/%3A/gi, ":");
		}
		/** Encode a `/`-separated path segment by segment. */
		function encodePath(path) {
			return path.split("/").map(encodeSegment).join("/");
		}
		/** Whether a decoded first path segment is a Windows drive (`C:`). */
		function isDriveSegment(segment) {
			return segment !== void 0 && /^[A-Za-z]:$/.test(segment);
		}
		/**
		* Build the address of a file read through one Session.
		* @param sessionId - the Session whose Host workspace resolves the path.
		* @param path - absolute or workspace-relative path; backslashes are normalized to `/`, and leading `./` prefixes are dropped.
		* @returns the `dsh-resource://file/session/<sessionId>/<path>` address.
		*/
		function sessionFileAddress(sessionId, path) {
			const normalized = path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
			return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`;
		}
		/**
		* Read a file address back into its parts without resolving `.` or `..`.
		* Query and fragment suffixes are ignored; encoded path segments are decoded.
		* @param address - a candidate address.
		* @returns the parts, or `undefined` when the string is not a `dsh-resource://file/` URI in a known scope with a path, or a segment is not validly encoded.
		*/
		function parseFileAddress(address) {
			try {
				if (!address.startsWith(FILE_ADDRESS_PREFIX)) return void 0;
				const end = address.search(/[?#]/);
				const [scope, ...rest] = address.slice(20, end === -1 ? void 0 : end).split("/");
				if (scope === "session") {
					const [id, ...segments] = rest;
					if (id === void 0 || id === "" || segments.length === 0) return void 0;
					return {
						scope,
						sessionId: decodeURIComponent(id),
						path: segments.map(decodeURIComponent).join("/")
					};
				}
				if (scope === "absolute") {
					const unc = rest[0] === "" && rest.length > 1;
					const segments = (unc ? rest.slice(1) : rest).map(decodeURIComponent);
					if (segments.length === 0 || segments[0] === "") return void 0;
					if (unc) return {
						scope,
						path: `//${segments.join("/")}`
					};
					return {
						scope,
						path: isDriveSegment(segments[0]) ? segments.join("/") : `/${segments.join("/")}`
					};
				}
				return;
			} catch {
				return;
			}
		}
		/**
		* Browser-safe Workspace path and display helpers.
		* @module @deepseek-ai/dsh-util-workspace-path
		*/
		/** Whether a path uses a Windows drive or UNC prefix. */
		function isWindowsStylePath(value) {
			return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith("\\\\");
		}
		/**
		* Whether a path is absolute in either spelling the Host accepts: POSIX (`/a/b`) or Windows drive or UNC.
		* @param path - the path to classify.
		* @returns `true` for an absolute path; `false` for a Workspace-relative one.
		*/
		function isAbsoluteWorkspacePath(path) {
			return path.startsWith("/") || isWindowsStylePath(path);
		}
		/**
		* The address for a path as a caller holds it: a relative path, or an absolute
		* path inside the Session's workspace, becomes a `session`-scoped address; an
		* absolute path outside it, or one whose workspace root is unknown, keeps its
		* absolute path in that Session's address.
		* @param sessionId - the Session the path is read in.
		* @param cwd - that Session's workspace root, when known.
		* @param path - absolute or workspace-relative path, in either separator spelling.
		* @returns the `dsh-resource://file/…` address.
		*/
		function fileAddressFor(sessionId, cwd, path) {
			const normalized = path.replace(/\\/g, "/");
			if (!isAbsoluteWorkspacePath(normalized)) return sessionFileAddress(sessionId, normalized);
			const root = cwd === void 0 ? "" : cwd.replace(/\\/g, "/").replace(/\/+$/, "");
			if (root !== "" && normalized === root) return sessionFileAddress(sessionId, "");
			if (root !== "" && normalized.startsWith(`${root}/`)) return sessionFileAddress(sessionId, normalized.slice(root.length + 1));
			return sessionFileAddress(sessionId, normalized);
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
		/** Where the client posts an edited diagram back. */
		const SAVE_PATH = "/plugins/dsh-drawioedit/save";
		const RENAME_PATH = "/plugins/dsh-drawioedit/rename";
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
		//#region src/client/editor.ts
		/**
		* The draw.io editor's browser-side contract.
		*
		* The editor is the upstream drawio webapp, served as static files from this
		* package's `editor/` directory. It is an application, not a component, so it
		* runs in an iframe and the two halves talk over the URL and `postMessage`
		* rather than through React props.
		*/
		/** A rejected save with the host's stable error code for localized guidance. */
		var DiagramSaveError = class extends Error {
			code;
			constructor(message, code) {
				super(message);
				this.code = code;
				this.name = "DiagramSaveError";
			}
		};
		/**
		* Read one `postMessage` payload as an editor event.
		* @param data - the raw message data.
		* @returns the parsed message, or undefined when it is not one.
		*/
		function parseEditorMessage(data) {
			if (typeof data !== "string") return void 0;
			try {
				const parsed = JSON.parse(data);
				if (typeof parsed !== "object" || parsed === null) return void 0;
				const event = parsed.event;
				if (typeof event !== "string") return void 0;
				const xml = parsed.xml;
				return {
					event,
					...typeof xml === "string" ? { xml } : {}
				};
			} catch {
				return;
			}
		}
		/**
		* Post an edited diagram back to the host.
		*
		* The write is a host capability, so it goes over the application origin rather
		* than the read-only Workspace Files seam.
		* @param path - absolute path of the file the diagram came from.
		* @param xml - the diagram XML the editor reported.
		* @param version - the freshness token the previous read or write reported.
		* @param sessionId - the session whose workspace policy governs the write.
		* @returns the freshness token the write produced, for the next save.
		* @throws when the host refuses the write, carrying its reason.
		*/
		async function saveDiagram(path, xml, version, sessionId) {
			const response = await fetch(SAVE_PATH, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					path,
					xml,
					version,
					sessionId
				})
			});
			const body = await response.json().catch(() => void 0);
			if (!response.ok) throw new DiagramSaveError(typeof body === "object" && body !== null && typeof body.error === "string" ? body.error : `HTTP ${response.status}`, typeof body === "object" && body !== null && typeof body.code === "string" ? body.code : void 0);
			const next = typeof body === "object" && body !== null ? body.version : void 0;
			return typeof next === "string" ? next : "";
		}
		/** Rename the currently edited file through the same session permission boundary. */
		async function renameDiagram(path, name, version, sessionId) {
			const response = await fetch(RENAME_PATH, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					path,
					name,
					version,
					sessionId
				})
			});
			const body = await response.json().catch(() => void 0);
			if (!response.ok) throw new DiagramSaveError(typeof body === "object" && body !== null && typeof body.error === "string" ? body.error : `HTTP ${response.status}`, typeof body === "object" && body !== null && typeof body.code === "string" ? body.code : void 0);
			if (typeof body !== "object" || body === null || typeof body.path !== "string") throw new DiagramSaveError("rename returned no file path");
			return {
				path: body.path,
				version: String(body.version ?? "")
			};
		}
		//#endregion
		//#region src/client/file-name.ts
		/** Decode the filename carried in a resource address for both tab and editor titles. */
		function basenameOf(address) {
			const name = address.slice(address.lastIndexOf("/") + 1);
			if (name === "") return address;
			try {
				return decodeURIComponent(name);
			} catch {
				return name;
			}
		}
		//#endregion
		//#region \0dsh-css:C:\02-codespace\DeepSeek\dsh-drawioedit\src\client\EditorBody.module.css.mjs
		const css = ".sDPVlG_frame{flex-direction:column;width:100%;height:100%;min-height:0;display:flex}.sDPVlG_editor{background:var(--dsw-alias-bg-layer-1);border:0;flex:auto;width:100%;min-height:0}.sDPVlG_status{color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);margin:0;padding:12px;display:block}.sDPVlG_loading{box-sizing:border-box;flex-direction:column;align-items:center;gap:8px;height:100%;padding:24px 12px;display:flex}.sDPVlG_skeleton{border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-skeleton);width:min(100%,480px);height:240px;animation:sDPVlG_drawioEditSkeletonPulse 1.4s var(--ds-ease-in-out) infinite}.sDPVlG_failure{justify-items:start;gap:8px;padding:12px;display:grid}.sDPVlG_retry{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);height:28px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);cursor:pointer;background:0 0;padding:0 12px}.sDPVlG_retry:hover{border-color:var(--dsw-alias-border-l4)}.sDPVlG_retry:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}.sDPVlG_writeState{color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);align-items:center;gap:8px;margin:0;padding:4px 12px;display:flex}.sDPVlG_error{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-state-error-primary)}.sDPVlG_viewerRow{border-bottom:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);flex:none;align-items:center;padding:6px 8px;display:flex}.sDPVlG_viewerSwitch{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);flex:none;align-items:center;gap:2px;padding:2px;display:inline-flex}.sDPVlG_viewerOption{box-sizing:border-box;border-radius:var(--dsw-radius-sm);height:24px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11);cursor:pointer;background:0 0;border:0;padding:0 10px}.sDPVlG_viewerOption:hover{color:var(--dsw-alias-label-primary)}.sDPVlG_viewerOption[aria-pressed=true]{background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-elevation-soft);color:var(--dsw-alias-label-primary)}.sDPVlG_viewerOption:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}@media (pointer:coarse){.sDPVlG_retry{min-height:44px}.sDPVlG_viewerOption{height:32px}}@keyframes sDPVlG_drawioEditSkeletonPulse{0%,to{opacity:1}50%{opacity:.55}}@media (prefers-reduced-motion:reduce){.sDPVlG_skeleton{animation:none}}";
		const tagId = "@guowenzhang/dsh-drawioedit/EditorBody.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var EditorBody_module_css_default = {
			"drawioEditSkeletonPulse": "sDPVlG_drawioEditSkeletonPulse",
			"editor": "sDPVlG_editor",
			"error": "sDPVlG_error",
			"failure": "sDPVlG_failure",
			"frame": "sDPVlG_frame",
			"loading": "sDPVlG_loading",
			"retry": "sDPVlG_retry",
			"skeleton": "sDPVlG_skeleton",
			"status": "sDPVlG_status",
			"viewerOption": "sDPVlG_viewerOption",
			"viewerRow": "sDPVlG_viewerRow",
			"viewerSwitch": "sDPVlG_viewerSwitch",
			"writeState": "sDPVlG_writeState"
		};
		//#endregion
		//#region src/client/ViewerSwitch.tsx
		/**
		* Draw the switch.
		* @param props - captions, the current segment, and both callbacks.
		* @returns the segmented control.
		*/
		function ViewerSwitch({ label, first, second, selected, onFirst, onSecond }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: EditorBody_module_css_default.viewerSwitch,
				role: "group",
				"aria-label": label,
				"data-viewer-switch": selected,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: EditorBody_module_css_default.viewerOption,
					"aria-pressed": selected === "first",
					onClick: onFirst,
					children: first
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: EditorBody_module_css_default.viewerOption,
					"aria-pressed": selected === "second",
					onClick: onSecond,
					children: second
				})]
			});
		}
		//#endregion
		//#region src/client/transports.ts
		let installed;
		/**
		* Install the transports for this plugin's lifetime.
		* @param transports - the reader and the save transport.
		*/
		function setEditorTransports(transports) {
			installed = transports;
		}
		/**
		* Read the installed transports.
		* @returns the transports.
		* @throws when no plugin has installed them, which is a wiring mistake.
		*/
		function editorTransports() {
			if (installed === void 0) throw new Error("dsh-drawioedit: editor transports are not installed");
			return installed;
		}
		//#endregion
		//#region src/client/DrawioCanvas.tsx
		/**
		* The `.drawio` canvas: the upstream editor in a same-origin iframe, driven by
		* `postMessage`, with an optional switch back to whoever else can show the file.
		*
		* Two hosts mount it. The right-Sidebar tab body reads the file through this
		* plugin's transports and switches nothing (the Sidebar owns that choice); the
		* workbench viewer passes the file it already resolved and draws the switch.
		* Both get the same editor, the same save path, and the same failure lines.
		*
		* @module @guowenzhang/dsh-drawioedit/client/DrawioCanvas
		*/
		/**
		* Edit one `.drawio` file.
		*
		* The diagram reaches the editor through its URL, which is the one load path
		* that needs no handshake; the editor then reports every change back as an
		* `autosave` message carrying the full XML, and that is what gets persisted.
		* @param props - the file, the transports, the optional switch, and the dictionary.
		* @returns the editor frame, a loading status, or the reason it could not open.
		*/
		function DrawioCanvas({ source, transports, alternate, t, openAddress, hooks: h }) {
			const { address, name: sourceName, readOnly } = source;
			const [loaded, setLoaded] = h.useState();
			/** Why the last write failed. A write that lands is reported by the editor's own toolbar. */
			const [failure, setFailure] = h.useState();
			/** The visible phase of this plugin's own write, and nothing else. */
			const [phase, setPhase] = h.useState();
			/** Bumped by Retry to read the same file again. */
			const [attempt, setAttempt] = h.useState(0);
			const frame = h.useRef(null);
			/** The freshness token to offer on the next save: seeded by the read, advanced by each write. */
			const version = h.useRef("");
			/** The newest diagram awaiting a write, and whether a write is in flight. */
			const pending = h.useRef(void 0);
			const saving = h.useRef(false);
			const renameWanted = h.useRef(void 0);
			const renaming = h.useRef(false);
			const busy = phase === "saving" || phase === "renaming";
			h.useEffect(() => {
				const lifetime = new AbortController();
				setLoaded(void 0);
				/** Report a read failure; the reason is shown so the pane is never silent. */
				const failed = (error) => {
					if (lifetime.signal.aborted) return;
					setLoaded({
						kind: "failed",
						address,
						reason: error instanceof Error ? error.message : String(error)
					});
				};
				transports.read(address, lifetime.signal).then((opened) => {
					if (lifetime.signal.aborted) return;
					version.current = opened.version;
					setLoaded({
						kind: "ready",
						address,
						xml: new TextDecoder().decode(opened.bytes),
						absolutePath: opened.absolutePath,
						sessionId: opened.sessionId,
						version: opened.version
					});
				}, failed).catch(failed);
				return () => {
					lifetime.abort();
				};
			}, [
				address,
				transports,
				attempt
			]);
			h.useEffect(() => {
				if (loaded?.kind !== "ready") return;
				const absolutePath = loaded.absolutePath;
				const renameIfReady = () => {
					if (saving.current || pending.current !== void 0 || renaming.current || renameWanted.current === void 0) return;
					const requested = renameWanted.current;
					renameWanted.current = void 0;
					renaming.current = true;
					setPhase("renaming");
					transports.rename(absolutePath, requested, version.current, loaded.sessionId).then((result) => {
						if (openAddress !== void 0) openAddress(fileAddressFor(loaded.sessionId, void 0, result.path));
						else window.dispatchEvent(new CustomEvent(DRAWIO_RENAMED, { detail: result.path }));
					}).catch((error) => {
						setFailure({
							message: `${t("renameFailed")}${error instanceof Error ? error.message : String(error)}`,
							code: error instanceof DiagramSaveError ? error.code : void 0
						});
					}).finally(() => {
						renaming.current = false;
						setPhase((current) => current === "renaming" ? void 0 : current);
						drain();
					});
				};
				/**
				* Write the newest pending diagram, then the next one if it arrived meanwhile.
				*
				* Saves must not overlap. The editor reports a change as soon as it happens,
				* so dragging a shape produces a burst: two saves racing would both offer the
				* same token, and the second would be refused as stale even though nothing
				* else touched the file. Serialising also collapses the burst — only the
				* latest diagram of a burst is written.
				*/
				const drain = () => {
					if (saving.current || renaming.current) return;
					const next = pending.current;
					if (next === void 0) {
						renameIfReady();
						return;
					}
					pending.current = void 0;
					saving.current = true;
					setPhase("saving");
					transports.save(absolutePath, next.xml, version.current, loaded.sessionId).then((fresh) => {
						version.current = fresh;
						setPhase(void 0);
						setFailure(void 0);
						frame.current?.contentWindow?.postMessage(JSON.stringify({ action: "saved" }), "*");
					}, (error) => {
						renameWanted.current = void 0;
						setPhase((current) => current === "saving" ? void 0 : current);
						setFailure({
							message: error instanceof Error ? error.message : String(error),
							code: error instanceof DiagramSaveError ? error.code : void 0
						});
					}).finally(() => {
						saving.current = false;
						drain();
					});
				};
				const onMessage = (event) => {
					if (frame.current === null || event.source !== frame.current.contentWindow) return;
					const message = parseEditorMessage(event.data);
					if (message?.xml === void 0 || ![
						"autosave",
						"save",
						"saveAs"
					].includes(message.event)) return;
					pending.current = { xml: message.xml };
					const initialName = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}(?:-\d+)?\.drawio$/u.test(sourceName);
					if (!readOnly && (message.event === "saveAs" || message.event === "save" && initialName)) {
						const chosen = window.prompt(t("renamePrompt"), initialName ? "" : sourceName.replace(/\.drawio$/iu, ""));
						if (chosen?.trim()) renameWanted.current = chosen.trim();
					}
					drain();
				};
				window.addEventListener("message", onMessage);
				return () => {
					window.removeEventListener("message", onMessage);
					pending.current = void 0;
				};
			}, [
				loaded,
				sourceName,
				readOnly,
				transports,
				t,
				openAddress
			]);
			const name = basenameOf(address);
			const failureDetail = failure?.code === "FS_SANDBOX_DENIED" ? t("saveDenied") : failure?.code === "FS_STALE_VERSION" ? t("saveConflict") : failure?.message;
			const src = h.useMemo(() => loaded?.kind === "ready" ? editorUrl(loaded.xml, "", name) : void 0, [loaded, name]);
			if (loaded === void 0 || loaded.address !== address) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: EditorBody_module_css_default.loading,
				role: "status",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: EditorBody_module_css_default.skeleton,
					"aria-hidden": "true"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: EditorBody_module_css_default.status,
					children: t("loading")
				})]
			});
			if (loaded.kind === "failed") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: EditorBody_module_css_default.failure,
				role: "alert",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: EditorBody_module_css_default.status,
					children: `${t("failed")} ${loaded.reason}`
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: EditorBody_module_css_default.retry,
					onClick: () => setAttempt((current) => current + 1),
					children: t("retry")
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: EditorBody_module_css_default.frame,
				"data-drawio-editor": true,
				"aria-busy": busy,
				children: [
					alternate !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: EditorBody_module_css_default.viewerRow,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ViewerSwitch, {
							label: t("viewerLabel"),
							first: t("viewerDiagram"),
							second: alternate.label,
							selected: "first",
							onFirst: () => {},
							onSecond: alternate.select
						})
					}),
					phase !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: EditorBody_module_css_default.writeState,
						role: "status",
						children: t(phase)
					}),
					failure !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: `${EditorBody_module_css_default.status} ${EditorBody_module_css_default.error}`,
						role: "alert",
						children: `${t("saveFailed")}${failureDetail}`
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
						ref: frame,
						className: EditorBody_module_css_default.editor,
						style: phase === "renaming" ? { pointerEvents: "none" } : void 0,
						src,
						title: t("preview", { name }),
						sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
					})
				]
			});
		}
		/** Event a host without a tab to replace listens on: `detail` is the new absolute path. */
		const DRAWIO_RENAMED = "dsh-drawioedit:renamed";
		/** The real render machinery, for hosts that mount the canvas themselves. */
		const REACT_HOOKS = {
			useState: react.useState,
			useRef: react.useRef,
			useMemo: react.useMemo,
			useEffect: react.useEffect
		};
		/**
		* The canvas mounted as the right-Sidebar tab body.
		*
		* The tab owns the file by address, replaces itself when the editor renames it,
		* and never draws a switch: the Sidebar's own tab types are the choice there.
		* @param props - the tab seat and the dictionary.
		* @returns the canvas.
		*/
		function EditorBody({ useTabInfo, t }) {
			const { tab } = useTabInfo();
			const address = tab.contentId;
			const hooks = EditorBody.__hooks ?? REACT_HOOKS;
			const opened = hooks.useMemo(() => editorTransports(), []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DrawioCanvas, {
				hooks,
				source: {
					address,
					name: basenameOf(address),
					readOnly: false
				},
				transports: opened,
				t: (key) => t(key)
			});
		}
		//#endregion
		//#region src/client/workbench-viewer.ts
		/** Viewer identity inside the workbench. */
		const WORKBENCH_VIEWER_ID = "guowenzhang:drawio-edit";
		/** This package's copy namespace, shared with the tab body. */
		const NS$1 = "sidebarDrawioEdit";
		/**
		* Register the editor with the workbench, when one is installed.
		* @param ctx - client context; the registration is an effect of it.
		* @returns nothing.
		*/
		function registerWorkbenchViewer(ctx) {
			ctx.inject([
				"locale",
				"remote",
				"slots"
			], (injected) => {
				const service = injected.get("betterSidebar");
				if (service === void 0 || typeof service.registerFileViewer !== "function") return;
				const t = injected.locale.bind(NS$1);
				const transports = viewerTransports(injected);
				injected.effect(() => service.registerFileViewer({
					id: WORKBENCH_VIEWER_ID,
					title: () => t("title"),
					exts: ["drawio"],
					priority: 20,
					fetchStrategy: "fsRead",
					component: (props) => {
						const source = sourceOf(props);
						return DrawioCanvas({
							hooks: REACT_HOOKS,
							source,
							transports,
							alternate: {
								label: t("viewerSource"),
								select: () => {}
							},
							t: (key) => t(key)
						});
					}
				}), "dsh-drawioedit: workbench viewer");
			});
		}
		/**
		* The transports one mounted viewer reads and saves through.
		*
		* Reading goes through the client Remote, which is what returns the freshness
		* token; writing reuses the transports the editor tab installed, so the save
		* endpoint, its sandbox policy, and its version guard stay exactly where they
		* are.
		* @param ctx - the client context carrying the Remote.
		* @returns the transports handed to the canvas.
		*/
		function viewerTransports(ctx) {
			return {
				read: async (address, signal) => {
					const file = hostFileOf$1(address);
					const remote = ctx.get("remote");
					if (remote === void 0) throw new Error("dsh-drawioedit: the file Remote is not available");
					const result = await remote.workspaceFiles.readBytes(file.sessionId, file.path, {}, signal);
					if (!result.ok) throw new Error(result.error.message);
					return {
						bytes: result.value.data,
						absolutePath: result.value.absolutePath,
						sessionId: file.sessionId,
						version: result.value.version
					};
				},
				save: (absolutePath, xml, version, sessionId) => editorTransports().save(absolutePath, xml, version, sessionId),
				rename: (absolutePath, name, version, sessionId) => editorTransports().rename(absolutePath, name, version, sessionId)
			};
		}
		/**
		* The file one mounted viewer edits.
		* @param props - the workbench's file record.
		* @returns the address, the name the editor opens with, and the session.
		*/
		function sourceOf(props) {
			const at = Math.max(props.path.lastIndexOf("/"), props.path.lastIndexOf("\\"));
			const name = at === -1 ? props.path : props.path.slice(at + 1);
			return {
				address: `dsh-resource://file/session/${encodeURIComponent(props.scope.sessionId)}/${props.path}`,
				name,
				readOnly: false
			};
		}
		/**
		* Read the session and path one `dsh-resource://file/…` address names.
		* @param address - the viewer's own address for the file.
		* @returns the session and the workspace path.
		*/
		function hostFileOf$1(address) {
			const parsed = parseFileAddress(address);
			if (parsed?.scope !== "session") throw new Error(`dsh-drawioedit: not a session file address "${address}"`);
			return {
				sessionId: parsed.sessionId,
				path: parsed.path
			};
		}
		//#endregion
		//#region src/client/locales.ts
		/** Locale-owned draw.io editor labels and status text. */
		const zh = {
			title: "draw.io 编辑器",
			preview: "编辑图表：{name}",
			loading: "正在打开编辑器…",
			failed: "无法打开编辑器。",
			retry: "重试",
			saving: "正在保存…",
			renaming: "正在重命名…",
			malformed: "这个文件不是有效的 draw.io XML。",
			unsupported: "编辑器需要完整文件内容。",
			saveFailed: "保存失败：",
			saveDenied: "当前权限不允许写入这个文件。请在该文件所属工作区打开会话，或调整 DSH 的文件写入权限。修改尚未保存。",
			saveConflict: "文件已被其他操作修改，为避免覆盖，保存被拒绝。请先导出当前图表副本，再重新打开文件合并修改。",
			renamePrompt: "图表名称（保存为 .drawio 文件）",
			renameFailed: "重命名失败：",
			viewerLabel: "显示方式",
			viewerDiagram: "图表编辑",
			viewerSource: "源码"
		};
		/** English dictionary with the same keys as the Chinese dictionary. */
		const en = {
			title: "draw.io editor",
			preview: "Editing diagram: {name}",
			loading: "Opening the editor…",
			failed: "The editor could not be opened.",
			retry: "Retry",
			saving: "Saving…",
			renaming: "Renaming…",
			malformed: "This file is not valid draw.io XML.",
			unsupported: "The editor needs the complete file contents.",
			saveFailed: "Could not save: ",
			saveDenied: "This file is outside the writable area for the current session or writing is disabled. Open the session in the file’s workspace or adjust DSH file permissions. Your changes are not saved.",
			saveConflict: "The file changed elsewhere, so saving was refused to avoid overwriting it. Export a copy of this diagram, then reopen the file and merge your changes.",
			renamePrompt: "Diagram name (saved as a .drawio file)",
			renameFailed: "Could not rename: ",
			viewerLabel: "View",
			viewerDiagram: "Diagram",
			viewerSource: "Source"
		};
		//#endregion
		//#region src/client/index.ts
		/** This package's copy namespace. */
		const NS = "sidebarDrawioEdit";
		/** This implementation's identity in the tab system, and the key its body registers under. */
		const DRAWIO_EDIT_ID = "@guowenzhang/dsh-drawioedit";
		/** The tab kind: what the tabs of this type are, and what `openTab` names. */
		const DRAWIO_EDIT_KIND = "drawio-edit";
		/** Required browser services: the tab registry, the slot registry, copy, and the file reader. */
		const inject = [
			"slots",
			"locale",
			"sidebarRightTabs",
			"remote",
			"remote.workspaceFiles"
		];
		/** Read the session and path one `dsh-resource://file/…` address names. */
		function hostFileOf(address) {
			const parsed = parseFileAddress(address);
			if (parsed?.scope !== "session") throw new Error(`dsh-drawioedit: not a session file address "${address}"`);
			return {
				sessionId: parsed.sessionId,
				path: parsed.path
			};
		}
		/**
		* Client plugin body: register the dictionary, the tab type, and its body.
		* @param ctx - client root context carrying the registries, copy, and the file reader.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-drawioedit: dictionaries");
			ctx.effect(() => ctx.sidebarRightTabs.register({
				id: DRAWIO_EDIT_ID,
				kind: DRAWIO_EDIT_KIND,
				patterns: ["dsh-resource://file/**/*.drawio"],
				priority: "extension",
				title: basenameOf
			}), "dsh-drawioedit: tab type");
			setEditorTransports({
				read: async (address, signal) => {
					const file = hostFileOf(address);
					const result = await ctx.remote.workspaceFiles.readBytes(file.sessionId, file.path, {}, signal);
					if (!result.ok) throw new Error(result.error.message);
					return {
						bytes: result.value.data,
						absolutePath: result.value.absolutePath,
						sessionId: file.sessionId,
						version: result.value.version
					};
				},
				save: async (absolutePath, xml, version, sessionId) => {
					return await saveDiagram(absolutePath, xml, version, sessionId);
				},
				rename: renameDiagram
			});
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: DRAWIO_EDIT_ID,
				locale: NS
			}, EditorBody)), "dsh-drawioedit: tab body");
			registerWorkbenchViewer(ctx);
		}
		//#endregion
		exports.DRAWIO_EDIT_ID = DRAWIO_EDIT_ID;
		exports.DRAWIO_EDIT_KIND = DRAWIO_EDIT_KIND;
		exports.apply = apply;
		exports.basenameOf = basenameOf;
		exports.inject = inject;
		return module.exports;
	}
});
