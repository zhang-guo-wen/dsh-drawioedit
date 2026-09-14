/** Locale-owned draw.io editor labels and status text. */
export const zh = {
  title: 'draw.io 编辑器',
  preview: '编辑图表：{name}',
  loading: '正在打开编辑器…',
  failed: '无法打开编辑器。',
  malformed: '这个文件不是有效的 draw.io XML。',
  unsupported: '编辑器需要完整文件内容。',
  saveFailed: '保存失败：',
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
} satisfies Record<DrawioEditKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** draw.io editor tab title, accessible name, and status text. */
    sidebarDrawioEdit: DrawioEditKey
  }
}
