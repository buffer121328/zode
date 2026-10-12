import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";
import { cn } from "@/components/lib/utils.js";
import { remarkLocalLinksToText } from "@/lib/remarkLocalLinksToText.js";

/**
 * 二开新增：轻量 markdown 渲染器（弹窗类小型内容复用）。
 * 不接消息流的自定义 components/reader 上下文，只带 cjk + code 插件、static 模式，
 * 保证 changelog / 记忆文件预览这类独立内容也能得到与聊天区一致的排版。
 */
export function SimpleMarkdown({ content, className }: { content: string; className?: string }) {
  return (
    <Streamdown
      mode="static"
      plugins={{ cjk, code }}
      animated={false}
      // 关闭 Streamdown 的外链确认弹窗，链接保持可点。
      linkSafety={{ enabled: false }}
      // 相对链接/图片会被 streamdown 内置 harden 替换成 "文字 [blocked]"（无 base 解析不了），
      // 且该行为不可配置——在 remark 阶段先降级为纯文本，见 remarkLocalLinksToText。
      remarkPlugins={[remarkLocalLinksToText]}
      className={cn("text-ui-sm leading-relaxed", className)}
    >
      {content}
    </Streamdown>
  );
}
