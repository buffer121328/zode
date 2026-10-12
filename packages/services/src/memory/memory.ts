import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export const PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED_ERROR_CODE =
  "PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED";
export const PROJECT_MEMORY_FILE_CHANGED_ERROR_CODE = "PROJECT_MEMORY_FILE_CHANGED";

export interface ProjectMemoryFileSummary {
  name: string;
  /** 已由 MemoryService 校验并限制在本地 Project Memory 根目录内的实际路径。 */
  path: string;
  kind: "index" | "item";
  size: number;
  updatedAt: number;
}

export interface ProjectMemoryWorkspaceSummary {
  id: string;
  label: string;
  updatedAt: number;
  files: ProjectMemoryFileSummary[];
}

export interface IMemoryService {
  /** 列出当前本地 profile 中可查看的 Project Memory。 */
  listProjectMemories(): Promise<ProjectMemoryWorkspaceSummary[]>;

  /** 原样读取一个 Project Memory Markdown 文件。 */
  readProjectMemoryFile(params: {
    workspaceId: string;
    fileName: string;
  }): Promise<{ content: string; updatedAt: number }>;

  /**
   * 覆盖保存一个已存在的 Project Memory Markdown 文件（二开新增，供设置页编辑器使用）。
   * expectedUpdatedAt 传入打开时读到的 updatedAt，用于检测外部并发修改；不一致时拒绝写入。
   */
  writeProjectMemoryFile(params: {
    workspaceId: string;
    fileName: string;
    content: string;
    expectedUpdatedAt?: number;
  }): Promise<{ updatedAt: number }>;

  /** 永久删除一个 Project Memory Markdown 文件（二开新增，供设置页删除按钮使用）。 */
  deleteProjectMemoryFile(params: { workspaceId: string; fileName: string }): Promise<void>;
}

export const IMemoryService = createServiceDescriptor<IMemoryService>(ServiceChannels.Memory);
