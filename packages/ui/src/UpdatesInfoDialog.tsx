/* eslint-disable max-lines -- 版本与更新弹窗集中管理双仓库拉取/缓存、tag-compare 兜底与展示，拆分会把一套拉取状态散到多个文件。 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { ZCODE_VERSION, type IPlatformService } from "@zcode/shared";
import {
  TID_TOP_OVERLAY_UPDATES_INFO_DIALOG,
  TID_TOP_OVERLAY_UPDATES_INFO_RETRY,
  TID_TOP_OVERLAY_UPDATES_INFO_TAB_ZCODE,
  TID_TOP_OVERLAY_UPDATES_INFO_TAB_ZCODIUM,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { SimpleMarkdown } from "@/components/SimpleMarkdown.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";

/**
 * 二开新增：标题栏「?」→ 版本与更新弹窗（每个 tab 只展示最新一条更新）。
 * 两个可切换 tab：
 * - ZCode 官方：上游仓库 zai-org/ZCode（智谱开源）的版本与更新；
 * - ZCodium：本仓库 ZCodium-project/ZCodium（ZCode 的独立审计 fork）。
 *
 * 关键：上游新版常常**只有 tag、不发 GitHub Release**（例：官方 3.15.1 只有 tag，
 * Releases 里还停在 3.14.3）。所以版本以 tags API 为准：
 *   tags[0] = 最新版本；若它没有对应 Release，则用 compare(previous...latest)
 *   列出提交作为「更新内容」，再用 streamdown 渲染。
 * 数据源为 GitHub 公开 API，渲染进程直接 fetch（api.github.com 允许跨域）；
 * 匿名 API 有速率限制，失败时给出明确提示并保底「在 GitHub 打开」。
 */

interface CommitInfo {
  sha: string;
  message: string;
}

interface LatestUpdate {
  tag: string | null;
  previousTag: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  /** Release 附带的发布说明（markdown）；没有 Release 时为 null。 */
  releaseNotes: string | null;
  /** 无 Release 时：自上一个 tag 以来的提交数与列表。 */
  commitCount: number | null;
  commits: CommitInfo[];
  htmlUrl: string | null;
}

type FetchState =
  | { phase: "loading" }
  | {
      phase: "ready";
      update: LatestUpdate;
      /** 数据写入缓存的时间；用于「数据缓存于 …」提示。 */
      cachedAt: number;
      /** 自动刷新失败但仍有旧缓存可用于展示时的失败信息。 */
      staleFailure?: { rateLimited: boolean; message: string };
    }
  | { phase: "error"; rateLimited: boolean; message: string };

// 缓存策略（用户要求）：GitHub API 每天最多查一次——结果持久化到 localStorage（重启仍有效），
// 自动加载（打开弹窗/切 tab）只读缓存；仅手动「刷新」强制拉取；拉到的新数据覆盖旧数据。
const REPO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REPO_CACHE_STORAGE_KEY = "zcode:updates-info-cache:v1";

interface CacheEntry {
  at: number;
  update: LatestUpdate;
}

function readCacheStore(): Record<string, CacheEntry> {
  try {
    const raw = globalThis.localStorage?.getItem(REPO_CACHE_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, CacheEntry>) : {};
  } catch {
    return {};
  }
}

function readCacheEntry(cacheKey: string): CacheEntry | null {
  const entry = readCacheStore()[cacheKey];
  return entry && typeof entry.at === "number" && entry.update ? entry : null;
}

function writeCacheEntry(cacheKey: string, entry: CacheEntry): void {
  try {
    const store = readCacheStore();
    store[cacheKey] = entry;
    globalThis.localStorage?.setItem(REPO_CACHE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // 存储不可用（隐私模式/配额满）时退化为仅本次会话内存缓存。
  }
}

interface RepoSpec {
  id: "zcode" | "zcodium";
  owner: string;
  repo: string;
}

const REPOS: RepoSpec[] = [
  { id: "zcode", owner: "zai-org", repo: "ZCode" },
  { id: "zcodium", owner: "ZCodium-project", repo: "ZCodium" },
];

function repoUrl(spec: RepoSpec): string {
  return `https://github.com/${spec.owner}/${spec.repo}`;
}

/** 归一化版本号：去掉前导 v，保留 -suffix。 */
function normalizeVersion(tag: string): string {
  return tag.trim().replace(/^v/i, "");
}

type VersionRelation = "same" | "newer" | "older";

/** 语义粗比较：按数字段逐位比较；相等时预发布（带 -）视为更旧。 */
function compareWithCurrent(tag: string, current: string): VersionRelation {
  const left = normalizeVersion(tag);
  const right = normalizeVersion(current);
  if (left === right) {
    return "same";
  }
  const leftBase = left.split("-")[0] ?? left;
  const rightBase = right.split("-")[0] ?? right;
  const leftParts = leftBase.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = rightBase.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const a = leftParts[index] ?? 0;
    const b = rightParts[index] ?? 0;
    if (a !== b) {
      return a > b ? "newer" : "older";
    }
  }
  if (left.includes("-") && !right.includes("-")) {
    return "older";
  }
  if (!left.includes("-") && right.includes("-")) {
    return "newer";
  }
  return "older";
}

async function githubApi<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    const error = new Error(`GitHub API ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return (await response.json()) as T;
}

function firstLine(value: string): string {
  return value.split("\n")[0]?.trim() ?? "";
}

async function fetchLatestUpdateFromNetwork(spec: RepoSpec): Promise<LatestUpdate> {
  const tags = await githubApi<Array<{ name?: unknown }>>(
    `/repos/${spec.owner}/${spec.repo}/tags?per_page=2`,
  );
  const tagNames = Array.isArray(tags)
    ? tags
        .map((entry) => (typeof entry?.name === "string" ? entry.name : null))
        .filter((entry): entry is string => entry !== null)
    : [];
  const latestTag = tagNames[0] ?? null;
  const previousTag = tagNames[1] ?? null;

  const update: LatestUpdate = {
    tag: latestTag,
    previousTag,
    releaseName: null,
    publishedAt: null,
    releaseNotes: null,
    commitCount: null,
    commits: [],
    htmlUrl: latestTag
      ? `https://github.com/${spec.owner}/${spec.repo}/releases/tag/${encodeURIComponent(latestTag)}`
      : repoUrl(spec),
  };
  if (!latestTag) {
    return update;
  }

  // Releases 仅用于匹配最新 tag 的发布说明；上游多数新版本不发 Release。
  const releases = await githubApi<
    Array<{
      tag_name?: unknown;
      name?: unknown;
      body?: unknown;
      published_at?: unknown;
      html_url?: unknown;
    }>
  >(`/repos/${spec.owner}/${spec.repo}/releases?per_page=20`);
  const matchedRelease = Array.isArray(releases)
    ? releases.find((release) => release?.tag_name === latestTag)
    : undefined;

  if (typeof matchedRelease?.name === "string" && matchedRelease.name.trim()) {
    update.releaseName = matchedRelease.name.trim();
  }
  if (typeof matchedRelease?.published_at === "string") {
    update.publishedAt = matchedRelease.published_at;
  }
  if (typeof matchedRelease?.body === "string" && matchedRelease.body.trim()) {
    update.releaseNotes = matchedRelease.body;
  }
  if (typeof matchedRelease?.html_url === "string") {
    update.htmlUrl = matchedRelease.html_url;
  }

  // 没有 Release 说明时，用 compare 列出上一个 tag 到最新 tag 的提交，作为「更新内容」。
  if (!update.releaseNotes && previousTag) {
    try {
      const compare = await githubApi<{
        total_commits?: unknown;
        commits?: Array<{ sha?: unknown; commit?: { message?: unknown } }>;
      }>(
        `/repos/${spec.owner}/${spec.repo}/compare/${encodeURIComponent(previousTag)}...${encodeURIComponent(latestTag)}`,
      );
      const commits = Array.isArray(compare?.commits)
        ? compare.commits
            .map((entry) => {
              const sha = typeof entry?.sha === "string" ? entry.sha : null;
              const message =
                typeof entry?.commit?.message === "string" ? entry.commit.message : null;
              return sha && message ? { sha, message } : null;
            })
            .filter((entry): entry is CommitInfo => entry !== null)
        : [];
      update.commits = commits.slice(-100).reverse();
      update.commitCount =
        typeof compare?.total_commits === "number" ? compare.total_commits : commits.length;
    } catch (error) {
      // compare 失败（如 tag 历史不连续）不阻塞展示，UI 会退化为「未附发布说明」。
      logger.warn("[UpdatesInfoDialog] compare 提交列表失败", {
        repo: `${spec.owner}/${spec.repo}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return update;
}

function RepoLatestPane({
  spec,
  state,
  locale,
  intl,
  currentVersion,
  onRetry,
  onOpenUrl,
}: {
  spec: RepoSpec;
  state: FetchState;
  locale: string;
  intl: ReturnType<typeof useZCodeIntl>["intl"];
  currentVersion: string;
  onRetry: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const formatDate = (value: string | null): string | null => {
    if (!value) {
      return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
  };
  const formatDateTime = (value: number): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(value);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: `topOverlay.updatesInfo.repoHint.${spec.id}` })}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid={TID_TOP_OVERLAY_UPDATES_INFO_RETRY}
            onClick={onRetry}
            disabled={state.phase === "loading"}
          >
            <RefreshCw
              className={state.phase === "loading" ? "size-3.5 animate-spin" : "size-3.5"}
            />
            {intl.formatMessage({ id: "topOverlay.updatesInfo.refresh" })}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenUrl(repoUrl(spec))}
          >
            <ExternalLink className="size-3.5" />
            {intl.formatMessage({ id: "topOverlay.updatesInfo.openOnGithub" })}
          </Button>
        </div>
      </div>

      {state.phase === "loading" ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-ui-base text-foreground-subtle">
          <Loader2 className="size-4 animate-spin" />
          {intl.formatMessage({ id: "topOverlay.updatesInfo.loading" })}
        </div>
      ) : state.phase === "error" ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-5 text-ui-base text-foreground">
          <p className="font-medium">
            {intl.formatMessage({
              id: state.rateLimited
                ? "topOverlay.updatesInfo.rateLimited"
                : "topOverlay.updatesInfo.loadFailed",
            })}
          </p>
          <p className="mt-1 text-ui-sm text-foreground-subtle">{state.message}</p>
        </div>
      ) : state.update.tag === null ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "topOverlay.updatesInfo.empty" })}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pe-1">
          {state.staleFailure ? (
            <div className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-ui-sm text-foreground">
              {intl.formatMessage(
                { id: "topOverlay.updatesInfo.staleFailed" },
                { message: state.staleFailure.message },
              )}
            </div>
          ) : null}
          <section className="rounded-xl bg-surface px-4 py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="rounded-md bg-background px-2 py-0.5 font-mono text-ui-sm font-medium text-foreground">
                {state.update.tag}
              </span>
              {(() => {
                const relation = compareWithCurrent(state.update.tag, currentVersion);
                if (relation === "same") {
                  return (
                    <span className="rounded-md border border-sky-500/50 px-1.5 py-0.5 text-ui-xs text-sky-600 dark:text-sky-400">
                      {intl.formatMessage({ id: "topOverlay.updatesInfo.badge.current" })}
                    </span>
                  );
                }
                if (relation === "newer") {
                  return (
                    <span className="rounded-md border border-emerald-500/50 px-1.5 py-0.5 text-ui-xs text-emerald-600 dark:text-emerald-400">
                      {intl.formatMessage({ id: "topOverlay.updatesInfo.badge.newer" })}
                    </span>
                  );
                }
                return null;
              })()}
              {state.update.releaseName ? (
                <span className="min-w-0 flex-1 truncate text-ui-base font-medium text-foreground">
                  {state.update.releaseName}
                </span>
              ) : null}
              {state.update.htmlUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ms-auto shrink-0"
                  onClick={() => onOpenUrl(state.update.htmlUrl as string)}
                >
                  <ExternalLink className="size-3.5" />
                  {intl.formatMessage({ id: "topOverlay.updatesInfo.openRelease" })}
                </Button>
              ) : null}
            </div>
            {formatDate(state.update.publishedAt) ? (
              <div className="mt-1 inline-flex items-center gap-1 text-ui-xs text-foreground-subtle">
                <CalendarDays className="size-3 shrink-0" aria-hidden="true" />
                {intl.formatMessage(
                  { id: "topOverlay.updatesInfo.publishedAt" },
                  { date: formatDate(state.update.publishedAt) ?? "" },
                )}
              </div>
            ) : null}

            <div className="mt-2">
              {state.update.releaseNotes ? (
                <SimpleMarkdown content={state.update.releaseNotes} />
              ) : state.update.commits.length > 0 ? (
                <>
                  <p className="mb-1 text-ui-sm font-medium text-foreground">
                    {intl.formatMessage(
                      { id: "topOverlay.updatesInfo.commitsSince" },
                      {
                        from: state.update.previousTag ?? "—",
                        count: String(state.update.commitCount ?? state.update.commits.length),
                      },
                    )}
                  </p>
                  <SimpleMarkdown
                    content={state.update.commits
                      .map(
                        (commit) => `- \`${commit.sha.slice(0, 7)}\` ${firstLine(commit.message)}`,
                      )
                      .join("\n")}
                  />
                </>
              ) : (
                <p className="text-ui-sm text-foreground-subtle">
                  {intl.formatMessage({ id: "topOverlay.updatesInfo.noNotes" })}
                </p>
              )}
            </div>
            <p className="mt-2 text-ui-xs text-foreground-subtle">
              {intl.formatMessage(
                { id: "topOverlay.updatesInfo.cachedAt" },
                { time: formatDateTime(state.cachedAt) },
              )}
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

export function UpdatesInfoDialog({
  open,
  onOpenChange,
  platform,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: IPlatformService;
}) {
  const { intl, locale } = useZCodeIntl();
  const [activeTab, setActiveTab] = useState<RepoSpec["id"]>("zcode");
  const [states, setStates] = useState<Record<RepoSpec["id"], FetchState>>({
    zcode: { phase: "loading" },
    zcodium: { phase: "loading" },
  });

  const loadRepo = useCallback(async (spec: RepoSpec, options?: { force?: boolean }) => {
    const cacheKey = `${spec.owner}/${spec.repo}`;
    const cached = readCacheEntry(cacheKey);
    const isFresh = cached !== null && Date.now() - cached.at < REPO_CACHE_TTL_MS;
    // 每天最多查一次：缓存新鲜且非强制刷新时直接使用缓存，不发请求。
    if (!options?.force && isFresh) {
      setStates((current) => ({
        ...current,
        [spec.id]: { phase: "ready", update: cached.update, cachedAt: cached.at },
      }));
      return;
    }
    // 有过期缓存时先展示旧数据再后台刷新；完全没有缓存才显示加载中。
    if (cached) {
      setStates((current) => ({
        ...current,
        [spec.id]: { phase: "ready", update: cached.update, cachedAt: cached.at },
      }));
    } else {
      setStates((current) => ({ ...current, [spec.id]: { phase: "loading" } }));
    }
    try {
      const update = await fetchLatestUpdateFromNetwork(spec);
      const at = Date.now();
      // 新数据覆盖旧数据。
      writeCacheEntry(cacheKey, { at, update });
      setStates((current) => ({ ...current, [spec.id]: { phase: "ready", update, cachedAt: at } }));
    } catch (error) {
      logger.warn("[UpdatesInfoDialog] 拉取版本与更新失败", {
        repo: cacheKey,
        error: error instanceof Error ? error.message : String(error),
      });
      const status = (error as { status?: number } | null)?.status;
      const rateLimited = status === 403 || status === 429;
      const message = error instanceof Error ? error.message : String(error);
      if (cached) {
        // 刷新失败保留旧缓存展示，附带失败提示（避免限流时弹窗一片红）。
        setStates((current) => ({
          ...current,
          [spec.id]: {
            phase: "ready",
            update: cached.update,
            cachedAt: cached.at,
            staleFailure: { rateLimited, message },
          },
        }));
      } else {
        setStates((current) => ({
          ...current,
          [spec.id]: { phase: "error", rateLimited, message },
        }));
      }
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    // 打开时加载当前 tab；另一个 tab 在切换时懒加载（缓存 10 分钟）。
    void loadRepo(REPOS.find((spec) => spec.id === activeTab) ?? REPOS[0]!);
  }, [activeTab, loadRepo, open]);

  const handleTabChange = useCallback((value: string) => {
    if (value === "zcode" || value === "zcodium") {
      setActiveTab(value);
    }
  }, []);

  const openExternal = useCallback(
    (url: string) => {
      void platform.openExternal(url);
    },
    [platform],
  );

  const repoPanes = useMemo(
    () =>
      REPOS.map((spec) => (
        <TabsContent key={spec.id} value={spec.id} className="min-h-0">
          <RepoLatestPane
            spec={spec}
            state={states[spec.id]}
            locale={locale}
            intl={intl}
            currentVersion={ZCODE_VERSION}
            onRetry={() => void loadRepo(spec, { force: true })}
            onOpenUrl={openExternal}
          />
        </TabsContent>
      )),
    [intl, loadRepo, locale, openExternal, states],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid={TID_TOP_OVERLAY_UPDATES_INFO_DIALOG}
        className="flex h-[min(640px,calc(100vh-4rem))] w-[min(720px,calc(100vw-2rem))] max-w-none flex-col gap-3"
      >
        <DialogHeader className="gap-1">
          <DialogTitle>{intl.formatMessage({ id: "topOverlay.updatesInfo.title" })}</DialogTitle>
          <p className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage(
              { id: "topOverlay.updatesInfo.currentVersion" },
              { version: ZCODE_VERSION },
            )}
          </p>
        </DialogHeader>
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          <TabsList>
            <TabsTrigger value="zcode" data-testid={TID_TOP_OVERLAY_UPDATES_INFO_TAB_ZCODE}>
              {intl.formatMessage({ id: "topOverlay.updatesInfo.tab.zcode" })}
            </TabsTrigger>
            <TabsTrigger value="zcodium" data-testid={TID_TOP_OVERLAY_UPDATES_INFO_TAB_ZCODIUM}>
              {intl.formatMessage({ id: "topOverlay.updatesInfo.tab.zcodium" })}
            </TabsTrigger>
          </TabsList>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{repoPanes}</div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
