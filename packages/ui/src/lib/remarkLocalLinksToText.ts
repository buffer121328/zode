/**
 * 二开新增：把「非绝对 URL」的链接在 mdast 阶段降级成纯文本。
 *
 * Streamdown 内置的 rehype-harden 用 `new URL(url)`（无 base）校验链接，相对路径一律解析
 * 失败，被替换成 `<span>文字 [blocked]</span>`（记忆索引 MEMORY.md 里的 `[标题](文件.md)`
 * 全部中招）；该行为在 streamdown 内部写死，公开 props 配置不了（linkSafety 只管外链确认
 * 弹窗）。所以按消息区的既有做法在 remark 阶段提前处理：
 * - link  → 保留可见文字、去掉链接语法（预览弹窗里本来也没有可跳转的目标）；
 * - image → 降级为 alt 文本，避免渲染成 "[Image blocked: …]"。
 * 绝对 URL（https: 等）与页内 `#fragment` 原样保留。
 */

interface MarkdownNodeLike {
  alt?: string;
  children?: MarkdownNodeLike[];
  type?: string;
  url?: string;
  value?: string;
}

/** 带 scheme 的绝对 URL（harden 能解析）；`#fragment` 单独放行。 */
const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u;

function isHardenSafeUrl(url: string | undefined): boolean {
  if (typeof url !== "string") {
    return false;
  }
  return url.startsWith("#") || ABSOLUTE_URL_PATTERN.test(url);
}

/** remark 插件：递归改写 link/image 节点。其余节点原样保留。 */
export function remarkLocalLinksToText() {
  return (tree: unknown): void => {
    rewriteChildren(tree as MarkdownNodeLike);
  };
}

function rewriteChildren(node: MarkdownNodeLike): void {
  const children = node.children;
  if (!Array.isArray(children)) {
    return;
  }
  const next: MarkdownNodeLike[] = [];
  for (const child of children) {
    rewriteChildren(child);
    if (child.type === "link" && !isHardenSafeUrl(child.url)) {
      next.push(...(child.children ?? []));
      continue;
    }
    if (child.type === "image" && !isHardenSafeUrl(child.url)) {
      if (typeof child.alt === "string" && child.alt.trim().length > 0) {
        next.push({ type: "text", value: child.alt });
      }
      continue;
    }
    next.push(child);
  }
  node.children = next;
}
