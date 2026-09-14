window.__ModuleLoader__.load({
	id: "@zhang-guo-wen/dsh-drawioedit",
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
		/** Whether a decoded first path segment is a Windows drive (`C:`). */
		function isDriveSegment(segment) {
			return segment !== void 0 && /^[A-Za-z]:$/.test(segment);
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
		/**
		* Decode the base64 a complete-byte read delivers on the wire.
		*
		* The Remote transports file bytes as base64 text rather than as a typed array,
		* so the payload must be decoded before anything can read it as text. `atob`
		* yields one character per byte, which is what this turns back into octets.
		* @param base64 - the wire payload.
		* @returns the decoded bytes.
		*/
		function decodeBase64(base64) {
			const binary = atob(base64);
			const bytes = new Uint8Array(binary.length);
			for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
			return bytes;
		}
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
		* @returns the freshness token the write produced, for the next save.
		* @throws when the host refuses the write, carrying its reason.
		*/
		async function saveDiagram(path, xml, version) {
			const response = await fetch(SAVE_PATH, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					path,
					xml,
					version
				})
			});
			const body = await response.json().catch(() => void 0);
			if (!response.ok) {
				const reason = typeof body === "object" && body !== null && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
				throw new Error(reason);
			}
			const next = typeof body === "object" && body !== null ? body.version : void 0;
			return typeof next === "string" ? next : "";
		}
		//#endregion
		//#region \0dsh-css:C:\02-codespace\deepseek-harness\dsh-drawioedit\src\client\EditorBody.module.css.mjs
		const css = ".fPBpSq_frame{flex-direction:column;width:100%;height:100%;min-height:0;display:flex}.fPBpSq_editor{background:var(--dsw-color-surface,#fff);border:0;flex:auto;width:100%;min-height:0}.fPBpSq_status{color:var(--dsw-color-text-secondary);padding:12px;font-size:13px;display:block}";
		const tagId = "@zhang-guo-wen/dsh-drawioedit/EditorBody.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var EditorBody_module_css_default = {
			"editor": "fPBpSq_editor",
			"frame": "fPBpSq_frame",
			"status": "fPBpSq_status"
		};
		//#endregion
		//#region src/client/EditorBody.tsx
		/** draw.io editor tab: the upstream webapp in an iframe, driven by `postMessage`. */
		/**
		* Host the draw.io editor for one `.drawio` file.
		*
		* The diagram reaches the editor through its URL, which is the one load path
		* that needs no handshake; the editor then reports every change back as an
		* `autosave` message carrying the full XML, and that is what gets persisted.
		* @param props - standard tab seats and the locale.
		* @returns the editor frame, a loading status, or the reason it could not open.
		*/
		function EditorBody({ useTabInfo, t }) {
			const { tab } = useTabInfo();
			const address = tab.contentId;
			const [loaded, setLoaded] = (0, react.useState)();
			/** Why the last write failed. A write that lands is reported by the editor itself. */
			const [failure, setFailure] = (0, react.useState)();
			const frame = (0, react.useRef)(null);
			/** The freshness token to offer on the next save: seeded by the read, advanced by each write. */
			const version = (0, react.useRef)("");
			/** The newest diagram awaiting a write, and whether a write is in flight. */
			const pending = (0, react.useRef)(void 0);
			const saving = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				const lifetime = new AbortController();
				const signal = AbortSignal.any([lifetime.signal, tab.signal]);
				/** Report a read failure; the reason is shown so the pane is never silent. */
				const failed = (error) => {
					if (signal.aborted) return;
					setLoaded({
						kind: "failed",
						address,
						reason: error instanceof Error ? error.message : String(error)
					});
				};
				editorTransports().read(address, signal).then((opened) => {
					if (signal.aborted) return;
					version.current = opened.version;
					setLoaded({
						kind: "ready",
						address,
						xml: new TextDecoder().decode(opened.bytes),
						absolutePath: opened.absolutePath,
						version: opened.version
					});
				}, failed).catch(failed);
				return () => {
					lifetime.abort();
				};
			}, [address, tab.signal]);
			(0, react.useEffect)(() => {
				if (loaded?.kind !== "ready") return;
				const absolutePath = loaded.absolutePath;
				/**
				* Write the newest pending diagram, then the next one if it arrived meanwhile.
				*
				* Saves must not overlap. The editor reports a change as soon as it happens,
				* so dragging a shape produces a burst: two saves racing would both offer the
				* same token, and the second would be refused as stale even though nothing
				* else touched the file. Serialising also collapses the burst — only the
				* newest diagram is worth writing.
				*/
				const drain = () => {
					if (saving.current || pending.current === void 0) return;
					const xml = pending.current.xml;
					pending.current = void 0;
					saving.current = true;
					editorTransports().save(absolutePath, xml, version.current).then((next) => {
						version.current = next;
						setFailure(void 0);
						frame.current?.contentWindow?.postMessage(JSON.stringify({ action: "saved" }), "*");
					}, (error) => {
						setFailure(error instanceof Error ? error.message : String(error));
					}).finally(() => {
						saving.current = false;
						drain();
					});
				};
				const onMessage = (event) => {
					if (frame.current === null || event.source !== frame.current.contentWindow) return;
					const message = parseEditorMessage(event.data);
					if (message?.event !== "autosave" || message.xml === void 0) return;
					pending.current = { xml: message.xml };
					drain();
				};
				window.addEventListener("message", onMessage);
				return () => {
					window.removeEventListener("message", onMessage);
					pending.current = void 0;
				};
			}, [loaded]);
			const name = address.slice(address.lastIndexOf("/") + 1);
			const src = (0, react.useMemo)(() => loaded?.kind === "ready" ? editorUrl(loaded.xml, "", name) : void 0, [loaded, name]);
			if (loaded === void 0 || loaded.address !== address) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: EditorBody_module_css_default.status,
				role: "status",
				children: t("loading")
			});
			if (loaded.kind === "failed") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: EditorBody_module_css_default.status,
				role: "alert",
				children: `${t("failed")} ${loaded.reason}`
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: EditorBody_module_css_default.frame,
				"data-drawio-editor": true,
				children: [failure !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: EditorBody_module_css_default.status,
					role: "alert",
					children: `${t("saveFailed")}${failure}`
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
					ref: frame,
					className: EditorBody_module_css_default.editor,
					src,
					title: t("preview", { name }),
					sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
				})]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** Locale-owned draw.io editor labels and status text. */
		const zh = {
			title: "draw.io 编辑器",
			preview: "编辑图表：{name}",
			loading: "正在打开编辑器…",
			failed: "无法打开编辑器。",
			malformed: "这个文件不是有效的 draw.io XML。",
			unsupported: "编辑器需要完整文件内容。",
			saveFailed: "保存失败："
		};
		/** English dictionary with the same keys as the Chinese dictionary. */
		const en = {
			title: "draw.io editor",
			preview: "Editing diagram: {name}",
			loading: "Opening the editor…",
			failed: "The editor could not be opened.",
			malformed: "This file is not valid draw.io XML.",
			unsupported: "The editor needs the complete file contents.",
			saveFailed: "Could not save: "
		};
		//#endregion
		//#region src/client/index.ts
		/** This package's copy namespace. */
		const NS = "sidebarDrawioEdit";
		/** This implementation's identity in the tab system, and the key its body registers under. */
		const DRAWIO_EDIT_ID = "@zhang-guo-wen/dsh-drawioedit";
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
		/**
		* The tab title for one `file:` address: its decoded basename.
		* @param address - a `file:`-shaped address.
		* @returns the decoded last path segment, or the address itself when it has none.
		*/
		function basenameOf(address) {
			const name = address.slice(address.lastIndexOf("/") + 1);
			if (name === "") return address;
			try {
				return decodeURIComponent(name);
			} catch {
				return name;
			}
		}
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
				patterns: ["*.drawio"],
				title: basenameOf
			}), "dsh-drawioedit: tab type");
			setEditorTransports({
				read: async (address, signal) => {
					const file = hostFileOf(address);
					const result = await ctx.remote.workspaceFiles.readAll(file.sessionId, file.path, signal);
					if (!result.ok) throw new Error(result.error.message);
					return {
						bytes: decodeBase64(result.value.data),
						absolutePath: result.value.absolutePath,
						version: result.value.version
					};
				},
				save: async (absolutePath, xml, version) => {
					return await saveDiagram(absolutePath, xml, version);
				}
			});
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: DRAWIO_EDIT_ID,
				locale: NS
			}, EditorBody)), "dsh-drawioedit: tab body");
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
