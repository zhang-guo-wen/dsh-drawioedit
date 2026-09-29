/** Locale-owned draw.io editor labels and status text. */
export const zh = {
  title: 'draw.io 编辑器',
  preview: '编辑图表：{name}',
  loading: '正在打开编辑器…',
  failed: '无法打开编辑器。',
  malformed: '这个文件不是有效的 draw.io XML。',
  unsupported: '编辑器需要完整文件内容。',
  saveFailed: '保存失败：',
  saveDenied: '当前权限不允许写入这个文件。请在该文件所属工作区打开会话，或调整 DSH 的文件写入权限。修改尚未保存。',
  saveConflict: '文件已被其他操作修改，为避免覆盖，保存被拒绝。请先导出当前图表副本，再重新打开文件合并修改。',
  renamePrompt: '图表名称（保存为 .drawio 文件）',
  renameFailed: '重命名失败：',
} satisfies Record<string, string>

/** draw.io editor dictionary keys. */
export type DrawioEditKey = keyof typeof zh

/** English dictionary with the same keys as the Chinese dictionary. */
export const en = {
  title: 'draw.io editor',
  preview: 'Editing diagram: {name}',
  loading: 'Opening the editor…',
  failed: 'The editor could not be opened.',
  malformed: 'This file is not valid draw.io XML.',
  unsupported: 'The editor needs the complete file contents.',
  saveFailed: 'Could not save: ',
  saveDenied: 'This file is outside the writable area for the current session or writing is disabled. Open the session in the file’s workspace or adjust DSH file permissions. Your changes are not saved.',
  saveConflict: 'The file changed elsewhere, so saving was refused to avoid overwriting it. Export a copy of this diagram, then reopen the file and merge your changes.',
  renamePrompt: 'Diagram name (saved as a .drawio file)',
  renameFailed: 'Could not rename: ',
} satisfies Record<DrawioEditKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** draw.io editor tab title, accessible name, and status text. */
    sidebarDrawioEdit: DrawioEditKey
  }
}
