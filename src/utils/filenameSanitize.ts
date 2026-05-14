/** 用于导出文件名片段：去掉路径非法字符，限制长度 */
export function sanitizeFilenameSegment(name: string, maxLen = 72): string {
  const s = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, maxLen)
  return s.length > 0 ? s : 'sample'
}
