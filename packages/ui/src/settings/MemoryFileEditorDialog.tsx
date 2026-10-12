import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { IMemoryService } from "@zcode/services";
import {
  TID_SETTINGS_MEMORY_FILE_DIALOG,
  TID_SETTINGS_MEMORY_FILE_DIALOG_DELETE,
  TID_SETTINGS_MEMORY_FILE_DIALOG_SAVE,
  TID_SETTINGS_MEMORY_FILE_DIALOG_TEXTAREA,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { SimpleMarkdown } from "@/components/SimpleMarkdown.js";
import { Textarea } from "@/components/ui/textarea.js";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { stripMarkdownFrontmatter } from "@/settings/markdownFrontmatter.js";

export type MemoryFileEditorService = Pick<
  IMemoryService,
  "readProjectMemoryFile" | "writeProjectMemoryFile" | "deleteProjectMemoryFile"
>;

type EditorPhase = "loading" | "ready" | "error";

/**
 * 二开新增：记忆文件的查看/编辑弹窗（双击文件行打开）。
 * 保存走 writeProjectMemoryFile（带 expectedUpdatedAt 并发检测），删除走 deleteProjectMemoryFile；
 * 两者都复用服务端同一套路径安全校验（项目记忆目录内的精确 .md 文件）。
 */
export function MemoryFileEditorDialog({
  open,
  workspaceId,
  fileName,
  memoryService,
  onOpenChange,
  onMutated,
}: {
  open: boolean;
  workspaceId: string;
  fileName: string;
  memoryService: MemoryFileEditorService;
  onOpenChange: (open: boolean) => void;
  /** 保存/删除成功后回调（用于刷新列表）。 */
  onMutated: () => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const confirmDialog = useConfirmDialog();
  const requestIdRef = useRef(0);
  const [phase, setPhase] = useState<EditorPhase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // 二开调整：默认展示渲染后的 markdown 预览，「编辑」切回可编辑原文。
  const [mode, setMode] = useState<"preview" | "edit">("preview");

  useEffect(() => {
    if (!open) {
      requestIdRef.current += 1;
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setPhase("loading");
    setErrorMessage(null);
    setContent("");
    setOriginalContent("");
    setUpdatedAt(null);
    setMode("preview");
    void (async () => {
      try {
        const result = await memoryService.readProjectMemoryFile({ workspaceId, fileName });
        if (requestIdRef.current !== requestId) {
          return;
        }
        setContent(result.content);
        setOriginalContent(result.content);
        setUpdatedAt(result.updatedAt);
        setPhase("ready");
      } catch (error) {
        if (requestIdRef.current !== requestId) {
          return;
        }
        logger.warn("[MemoryFileEditorDialog] 读取记忆文件失败", error);
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setPhase("error");
      }
    })();
  }, [fileName, memoryService, open, workspaceId]);

  const dirty = phase === "ready" && content !== originalContent;

  const handleSave = async () => {
    if (busy || phase !== "ready") {
      return;
    }
    setBusy(true);
    try {
      const result = await memoryService.writeProjectMemoryFile({
        workspaceId,
        fileName,
        content,
        ...(updatedAt !== null ? { expectedUpdatedAt: updatedAt } : {}),
      });
      setUpdatedAt(result.updatedAt);
      setOriginalContent(content);
      toast(intl.formatMessage({ id: "settings.memory.editor.saved" }));
      await onMutated();
    } catch (error) {
      // 并发修改（PROJECT_MEMORY_FILE_CHANGED）与超限都会落到这里；提示后让用户自行决定是否重读。
      logger.warn("[MemoryFileEditorDialog] 保存记忆文件失败", error);
      toast(intl.formatMessage({ id: "settings.memory.editor.saveFailed" }));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (busy) {
      return;
    }
    const confirmed = await confirmDialog({
      title: intl.formatMessage({ id: "settings.memory.editor.deleteConfirmTitle" }),
      description: intl.formatMessage(
        { id: "settings.memory.editor.deleteConfirmDescription" },
        { file: fileName },
      ),
      confirmLabel: intl.formatMessage({ id: "settings.memory.editor.delete" }),
      cancelLabel: intl.formatMessage({ id: "common.cancel" }),
      confirmVariant: "destructive",
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      await memoryService.deleteProjectMemoryFile({ workspaceId, fileName });
      toast(intl.formatMessage({ id: "settings.memory.editor.deleted" }));
      await onMutated();
      onOpenChange(false);
    } catch (error) {
      logger.warn("[MemoryFileEditorDialog] 删除记忆文件失败", error);
      toast(intl.formatMessage({ id: "settings.memory.editor.deleteFailed" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid={TID_SETTINGS_MEMORY_FILE_DIALOG}
        className="flex h-[min(640px,calc(100vh-4rem))] w-[min(760px,calc(100vw-2rem))] max-w-none flex-col gap-3"
        onOpenAutoFocus={(event) => {
          // 默认聚焦到 Textarea 更顺手；加载未完成时让 Radix 保持默认行为。
          if (phase !== "ready") {
            return;
          }
          const container = event.target as HTMLElement | null;
          const textarea = container?.querySelector?.<HTMLTextAreaElement>("textarea");
          if (textarea) {
            event.preventDefault();
            textarea.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="truncate">{fileName}</DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: "settings.memory.editor.description" })}
          </DialogDescription>
        </DialogHeader>

        {phase === "loading" ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-ui-base text-foreground-subtle">
            <Loader2 className="size-4 animate-spin" />
            {intl.formatMessage({ id: "settings.memory.editor.loading" })}
          </div>
        ) : phase === "error" ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-6 text-ui-base text-foreground">
            {intl.formatMessage({ id: "settings.memory.editor.loadFailed" })}
            {errorMessage ? (
              <span className="mt-1 block text-ui-sm text-foreground-subtle">{errorMessage}</span>
            ) : null}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant={mode === "preview" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setMode("preview")}
              >
                {intl.formatMessage({ id: "settings.memory.editor.preview" })}
              </Button>
              <Button
                type="button"
                variant={mode === "edit" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setMode("edit")}
              >
                {intl.formatMessage({ id: "settings.memory.editor.edit" })}
              </Button>
            </div>
            {mode === "preview" ? (
              <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border/50 bg-background px-4 py-3">
                {/* 记忆文件以 YAML frontmatter 开头；Streamdown 不识别它，闭合的 --- 会把
                    整段 YAML 解析成 setext 大标题，所以预览前剥离（原文在「编辑」里可见）。 */}
                <SimpleMarkdown content={stripMarkdownFrontmatter(content)} />
              </div>
            ) : (
              <Textarea
                data-testid={TID_SETTINGS_MEMORY_FILE_DIALOG_TEXTAREA}
                className="min-h-0 flex-1 resize-none font-mono text-ui-sm leading-relaxed"
                value={content}
                spellCheck={false}
                disabled={busy}
                onChange={(event) => setContent(event.target.value)}
              />
            )}
          </div>
        )}

        <DialogFooter className="flex-wrap items-center gap-2 sm:justify-between">
          <Button
            type="button"
            variant="destructive"
            data-testid={TID_SETTINGS_MEMORY_FILE_DIALOG_DELETE}
            disabled={busy || phase === "loading"}
            onClick={() => void handleDelete()}
          >
            {intl.formatMessage({ id: "settings.memory.editor.delete" })}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {intl.formatMessage({ id: "common.close" })}
            </Button>
            <Button
              type="button"
              data-testid={TID_SETTINGS_MEMORY_FILE_DIALOG_SAVE}
              disabled={busy || !dirty || mode !== "edit"}
              onClick={() => void handleSave()}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {intl.formatMessage({
                id: busy ? "settings.memory.editor.saving" : "settings.memory.editor.save",
              })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
