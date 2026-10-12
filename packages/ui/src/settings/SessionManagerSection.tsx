/* eslint-disable max-lines -- 会话管理页集中管理跨项目分组、折叠/分页与两级删除状态，拆分会把成套的本地状态散到多个文件。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, FolderOpen, Loader2, Trash2 } from "lucide-react";
import type { IZCodeTaskService } from "@zcode/services";
import {
  TID_SETTINGS_SESSIONS,
  TID_SETTINGS_SESSIONS_DELETE,
  TID_SETTINGS_SESSIONS_DELETE_GROUP,
  TID_SETTINGS_SESSIONS_EXPAND_ALL,
  TID_SETTINGS_SESSIONS_GROUP,
  TID_SETTINGS_SESSIONS_REFRESH,
  TID_SETTINGS_SESSIONS_ROW,
  TID_SETTINGS_SESSIONS_SHOW_MORE,
  type ZCodeTaskMeta,
  testId,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getPathLeaf } from "@/lib/path.js";
import { logger } from "@/logger.js";
import { formatMemoryUpdatedAt } from "@/settings/memoryUpdatedAt.js";
import { SettingsResourceHeaderActions } from "@/settings/SettingsResourceHeaderActions.js";

/** 二开新增：会话管理页只需要全量列表与删除两个能力。 */
type SessionManagerTaskService = Pick<IZCodeTaskService, "listAllTasks" | "deleteTask">;

interface SessionGroup {
  key: string;
  path: string;
  identity?: string;
  label: string;
  sessions: ZCodeTaskMeta[];
  updatedAt: number;
}

type LoadState = "loading" | "ready" | "error";

/** 项目默认折叠；单个项目展开后先显示这么多条，其余走「显示更多」。 */
const SESSION_GROUP_PAGE_SIZE = 20;

function groupTasksByWorkspace(tasks: readonly ZCodeTaskMeta[]): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  for (const task of tasks) {
    const identity = task.workspaceIdentity?.trim() || undefined;
    const key = identity || task.workspacePath;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        path: task.workspacePath,
        ...(identity ? { identity } : {}),
        label: getPathLeaf(task.workspacePath),
        sessions: [],
        updatedAt: 0,
      };
      groups.set(key, group);
    }
    group.sessions.push(task);
    group.updatedAt = Math.max(group.updatedAt, task.updatedAt ?? 0);
  }
  const result = [...groups.values()];
  for (const group of result) {
    group.sessions.sort(
      (left, right) =>
        (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || left.taskId.localeCompare(right.taskId),
    );
  }
  result.sort(
    (left, right) => right.updatedAt - left.updatedAt || left.label.localeCompare(right.label),
  );
  return result;
}

/**
 * 二开新增：数据与统计 → 会话管理。
 * 跨项目列出 tasks-index 里的全部未删除会话（listAllTasks），按项目文件夹分组；
 * 项目默认折叠（项目多时列表不至于滚不完），展开后每 20 条一页「显示更多」；
 * 每条提供删除按钮（confirm → zcodeTaskService.deleteTask tombstone），
 * 项目组头提供整组删除。删除事件会经 task_deleted 通知侧边栏等列表刷新。
 */
export function SessionManagerSection({ taskService }: { taskService: SessionManagerTaskService }) {
  const { intl, locale } = useZCodeIntl();
  const confirmDialog = useConfirmDialog();
  const requestIdRef = useRef(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ZCodeTaskMeta[]>([]);
  const [busyTaskKeys, setBusyTaskKeys] = useState<Set<string>>(new Set());
  const [busyGroupKeys, setBusyGroupKeys] = useState<Set<string>>(new Set());
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(new Set());
  const [visibleCountByGroup, setVisibleCountByGroup] = useState<Map<string, number>>(new Map());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const refresh = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoadState("loading");
    setLoadError(null);
    try {
      const result = await taskService.listAllTasks();
      if (requestIdRef.current !== requestId) {
        return;
      }
      setTasks(result);
      setLoadState("ready");
    } catch (error) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      logger.warn("[SessionManagerSection] 加载会话列表失败", error);
      setLoadError(error instanceof Error ? error.message : String(error));
      setLoadState("error");
    }
  }, [taskService]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const groups = useMemo(() => groupTasksByWorkspace(tasks), [tasks]);
  const totalSessions = tasks.length;
  const allGroupsExpanded =
    groups.length > 0 && groups.every((group) => expandedGroupKeys.has(group.key));

  const taskRowKey = (task: ZCodeTaskMeta) =>
    `${task.workspaceIdentity?.trim() || task.workspacePath}\u0000${task.taskId}`;

  const toggleGroup = useCallback((groupKey: string) => {
    setExpandedGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  const toggleAllGroups = useCallback(() => {
    setExpandedGroupKeys((current) => {
      const allExpanded = groups.length > 0 && groups.every((group) => current.has(group.key));
      return allExpanded ? new Set() : new Set(groups.map((group) => group.key));
    });
  }, [groups]);

  const handleShowMore = useCallback((groupKey: string) => {
    setVisibleCountByGroup((current) => {
      const next = new Map(current);
      next.set(
        groupKey,
        (current.get(groupKey) ?? SESSION_GROUP_PAGE_SIZE) + SESSION_GROUP_PAGE_SIZE,
      );
      return next;
    });
  }, []);

  const removeTaskFromList = useCallback((task: ZCodeTaskMeta) => {
    setTasks((current) =>
      current.filter(
        (candidate) =>
          !(
            candidate.taskId === task.taskId &&
            candidate.workspacePath === task.workspacePath &&
            candidate.workspaceIdentity === task.workspaceIdentity
          ),
      ),
    );
  }, []);

  const handleDeleteSession = useCallback(
    async (task: ZCodeTaskMeta) => {
      const confirmed = await confirmDialog({
        title: intl.formatMessage({ id: "confirmDialog.taskDeleteTitle" }),
        description: intl.formatMessage(
          { id: "confirmDialog.taskDeleteDescription" },
          { taskTitle: task.title || task.taskId },
        ),
        confirmLabel: intl.formatMessage({ id: "taskList.delete" }),
        cancelLabel: intl.formatMessage({ id: "common.cancel" }),
        confirmVariant: "destructive",
      });
      if (!confirmed) {
        return;
      }
      const rowKey = taskRowKey(task);
      setBusyTaskKeys((current) => new Set(current).add(rowKey));
      try {
        await taskService.deleteTask({
          taskId: task.taskId,
          workspacePath: task.workspacePath,
          ...(task.workspaceIdentity ? { workspaceIdentity: task.workspaceIdentity } : {}),
        });
        removeTaskFromList(task);
        toast(intl.formatMessage({ id: "settings.sessions.deleted" }));
      } catch (error) {
        logger.warn("[SessionManagerSection] 删除会话失败", error);
        toast(intl.formatMessage({ id: "settings.sessions.deleteFailed" }));
      } finally {
        setBusyTaskKeys((current) => {
          const next = new Set(current);
          next.delete(rowKey);
          return next;
        });
      }
    },
    [confirmDialog, intl, removeTaskFromList, taskService],
  );

  const handleDeleteGroup = useCallback(
    async (group: SessionGroup) => {
      const confirmed = await confirmDialog({
        title: intl.formatMessage(
          { id: "settings.sessions.deleteAllConfirmTitle" },
          { project: group.label, count: group.sessions.length },
        ),
        description: intl.formatMessage({ id: "settings.sessions.deleteAllConfirmDescription" }),
        confirmLabel: intl.formatMessage({ id: "taskList.delete" }),
        cancelLabel: intl.formatMessage({ id: "common.cancel" }),
        confirmVariant: "destructive",
      });
      if (!confirmed) {
        return;
      }
      setBusyGroupKeys((current) => new Set(current).add(group.key));
      let deleted = 0;
      let failed = 0;
      // 逐条删除：单项失败不回滚已成功项，也便于按 tombstone 语义逐个广播。
      for (const task of group.sessions) {
        try {
          await taskService.deleteTask({
            taskId: task.taskId,
            workspacePath: task.workspacePath,
            ...(task.workspaceIdentity ? { workspaceIdentity: task.workspaceIdentity } : {}),
          });
          deleted += 1;
          removeTaskFromList(task);
        } catch (error) {
          failed += 1;
          logger.warn("[SessionManagerSection] 批量删除会话失败", {
            taskId: task.taskId,
            workspacePath: task.workspacePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      setBusyGroupKeys((current) => {
        const next = new Set(current);
        next.delete(group.key);
        return next;
      });
      toast(
        intl.formatMessage(
          { id: "settings.sessions.deleteAllResult" },
          { deleted: String(deleted), failed: String(failed) },
        ),
      );
    },
    [confirmDialog, intl, removeTaskFromList, taskService],
  );

  return (
    <section className="space-y-4" data-testid={TID_SETTINGS_SESSIONS}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-ui-sm text-foreground-subtle">
          {intl.formatMessage(
            { id: "settings.sessions.summary" },
            { count: String(totalSessions), projects: String(groups.length) },
          )}
        </p>
        <div className="flex items-center gap-2">
          {groups.length > 1 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid={TID_SETTINGS_SESSIONS_EXPAND_ALL}
              onClick={toggleAllGroups}
            >
              {intl.formatMessage({
                id: allGroupsExpanded
                  ? "settings.sessions.collapseAll"
                  : "settings.sessions.expandAll",
              })}
            </Button>
          ) : null}
          <SettingsResourceHeaderActions
            onRefresh={() => void refresh()}
            refreshing={loadState === "loading"}
            refreshTestId={TID_SETTINGS_SESSIONS_REFRESH}
            refreshLabel={intl.formatMessage({ id: "settings.sessions.refresh" })}
          />
        </div>
      </div>

      {loadState === "loading" && tasks.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-8 text-ui-base text-foreground-subtle">
          <Loader2 className="size-4 animate-spin" />
          {intl.formatMessage({ id: "settings.sessions.loading" })}
        </div>
      ) : loadState === "error" ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-6 text-ui-base text-foreground">
          {intl.formatMessage({ id: "settings.sessions.loadFailed" })}
          {loadError ? (
            <span className="mt-1 block text-ui-sm text-foreground-subtle">{loadError}</span>
          ) : null}
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.sessions.empty" })}
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const groupBusy = busyGroupKeys.has(group.key);
            const expanded = expandedGroupKeys.has(group.key);
            const visibleCount = expanded
              ? Math.max(SESSION_GROUP_PAGE_SIZE, visibleCountByGroup.get(group.key) ?? 0)
              : 0;
            const visibleSessions = expanded ? group.sessions.slice(0, visibleCount) : [];
            const remainingCount = expanded ? group.sessions.length - visibleSessions.length : 0;
            return (
              <div
                key={group.key}
                data-testid={testId(TID_SETTINGS_SESSIONS_GROUP, group.key)}
                className="overflow-hidden rounded-xl bg-surface"
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                  className="flex min-w-0 cursor-pointer flex-wrap items-center justify-between gap-2 border-b border-border/50 px-4 py-2.5 select-none hover:bg-hover"
                  onClick={() => toggleGroup(group.key)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleGroup(group.key);
                    }
                  }}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <ChevronRight
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0 text-foreground-subtle transition-transform",
                        expanded ? "rotate-90" : "",
                      )}
                    />
                    <FolderOpen className="size-4 shrink-0 text-foreground-subtle" />
                    <span className="truncate text-ui-base font-medium text-foreground">
                      {group.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground-subtle">
                      {group.path}
                    </span>
                    <span className="shrink-0 text-ui-sm text-foreground-subtle">
                      {intl.formatMessage(
                        { id: "settings.sessions.groupCount" },
                        { count: String(group.sessions.length) },
                      )}
                    </span>
                  </div>
                  {group.sessions.length > 1 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid={testId(TID_SETTINGS_SESSIONS_DELETE_GROUP, group.key)}
                      disabled={groupBusy}
                      onClick={(event) => {
                        // 组头整体是折叠开关，删除按钮不能连带触发折叠。
                        event.stopPropagation();
                        void handleDeleteGroup(group);
                      }}
                    >
                      {groupBusy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                      {intl.formatMessage({ id: "settings.sessions.deleteGroup" })}
                    </Button>
                  ) : null}
                </div>
                {expanded ? (
                  <div>
                    {visibleSessions.map((task, index) => {
                      const rowBusy = busyTaskKeys.has(taskRowKey(task));
                      return (
                        <div key={task.taskId}>
                          {index > 0 ? (
                            <div className="h-px bg-border/50" aria-hidden="true" />
                          ) : null}
                          <div
                            data-testid={testId(TID_SETTINGS_SESSIONS_ROW, task.taskId)}
                            className="flex min-w-0 items-center gap-3 px-4 py-2.5 hover:bg-hover"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-ui-base text-foreground">
                                {task.title || task.taskId}
                              </span>
                              <span className="mt-0.5 block truncate text-ui-sm text-foreground-subtle">
                                {formatMemoryUpdatedAt({
                                  formatMessage: intl.formatMessage,
                                  locale,
                                  now,
                                  updatedAt: task.updatedAt ?? task.createdAt,
                                })}
                              </span>
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              data-testid={testId(TID_SETTINGS_SESSIONS_DELETE, task.taskId)}
                              disabled={rowBusy || groupBusy}
                              onClick={() => void handleDeleteSession(task)}
                            >
                              {rowBusy ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="size-3.5" />
                              )}
                              {intl.formatMessage({ id: "taskList.delete" })}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    {remainingCount > 0 ? (
                      <button
                        type="button"
                        data-testid={testId(TID_SETTINGS_SESSIONS_SHOW_MORE, group.key)}
                        className="block w-full border-t border-border/50 px-4 py-2 text-center text-ui-sm text-foreground-subtle hover:bg-hover"
                        onClick={() => handleShowMore(group.key)}
                      >
                        {intl.formatMessage(
                          { id: "settings.sessions.showMore" },
                          { count: String(remainingCount) },
                        )}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
