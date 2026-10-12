/**
 * 二开新增：剥离 markdown 开头的 YAML frontmatter（只影响预览，不改动原文）。
 *
 * 记忆文件固定以 `---` 包裹的 frontmatter 开头（name/description/metadata）。
 * 预览用的 Streamdown 不识别 frontmatter：开头的 `---` 渲染成水平线，收尾的 `---`
 * 会把整段 YAML 解析成 setext 二级标题（显示为一大块加粗标题）。
 * 判定与 adapters 侧 readMarkdownFrontmatter 同款：首行 trim 后必须是 `---`，
 * 其后第一行 trim 后等于 `---` 的即收尾。未闭合或没有 frontmatter 时原样返回。
 */
export function stripMarkdownFrontmatter(content: string): string {
  const normalized = content.replace(/^\uFEFF/u, "");
  const lines = normalized.split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") {
    return content;
  }
  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endIndex <= 0) {
    return content;
  }
  return lines.slice(endIndex + 1).join("\n");
}
