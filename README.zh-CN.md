# Zode

**[ZCode](https://github.com/zai-org/ZCode) 的开源社区版构建——免登录。**

[English](README.md) · 简体中文

Zode 是 ZCode（AI 编程工作台）面向社区的桌面构建，定位是**纯本地、个人自用**。它基于
[ZCodium](https://github.com/ZCodium-project/ZCodium)——ZCode 的独立安全审计分支——保留了
ZCodium 的审计成果（去除遥测、官方服务默认断开），并在此基础上更进一步：**官方账号/登录
体系已整体移除**。纯本地个人工具用不到账号体系——这是本项目的**设计初衷**，不是缺失的功能。

> Zode 是独立项目，**与 Z.ai / 智谱或 ZCodium 项目无隶属关系**，也未获其背书。

## 与官方 ZCode 的差异

|            | 官方 ZCode           | Zode                                                                                          |
| ---------- | -------------------- | --------------------------------------------------------------------------------------------- |
| 登录 / 账号 | 部分功能需要          | **按设计移除**——本地个人自用无需账号；不登录、无 OAuth                                                                |
| 官方平台    | 默认连接             | **默认全关**；每项服务都是「设置 → 官方服务」里的显式开关（打开后需重启应用）                       |
| 遥测        | 官方上报链路          | 已移除（继承 ZCodium 审计成果，细节见其 README）                                                  |
| 付费套餐入口 | 展示                | 已隐藏                                                                                         |
| 自动更新    | 官方更新通道          | 更新器整体关闭；内置「版本与更新」弹窗改为查询公开的 GitHub tag                                      |
| 额外便利    | —                    | 会话管理（按项目分组、分页、可删）、侧栏菜单删除任务、记忆文件查看/编辑（markdown 预览）、版本与更新弹窗 |
| 产品标识    | ZCode                | Zode（`dev.zode.app`）                                                                         |

桌面 / 浏览器 / 终端的产品面整体继承上游，Zode 只改动上表列出的部分。

## 从源码构建

在 macOS（Apple Silicon）上实测；Windows 与 Linux 未验证。

工具链由 [mise](https://mise.jdx.dev/) 锁定（Node 24 + pnpm 10，见 `mise.toml`）。

```bash
pnpm install

# 开发模式（热更新）
pnpm dev:desktop:test

# 独立 app
ZCODE_ENV=production pnpm --filter @zcode/desktop bundle
# → packages/desktop/dist/mac-arm64/Zode.app
ditto "packages/desktop/dist/mac-arm64/Zode.app" "/Applications/Zode.app"
```

暂未提供预编译安装包，请从源码构建。

## 数据与隐私

- **共用同一份数据目录**：Zode 读写 `~/.zcode`——与官方 ZCode 客户端相同的目录。会话、记忆、
  设置与凭据共享，因此两个应用之间切换（或卸载官方版）数据都不丢。
- **无登录、无官方账号**：账号与 OAuth 流程按设计移除——本地个人工具无需账号；也不存在 Zode 自己的后端可"回传"。
- **官方域名默认被网络层拦截**：一切访问官方服务的能力（插件市场、官方 MCP、反馈、套餐额度
  等）都在「设置 → 官方服务」里逐项开关，默认关闭。
- **不自动更新**：应用不会替换自身；版本弹窗只读取公开的 GitHub tag 与你当前版本做比较。

## 状态

- 基于 ZCodium v3.14.7 审计源码（ZCode 3.14.x 线），Zode 在此基础上作为独立维护线继续演进。
- 项目由个人自用版演化而来、现开源维护；没有厂商背书，issue 响应速度随缘。

## 致谢与许可

- [zai-org/ZCode](https://github.com/zai-org/ZCode)——上游产品，由智谱 / Z.ai 开源（Apache-2.0）。
- [ZCodium-project/ZCodium](https://github.com/ZCodium-project/ZCodium)——本项目所基于的安全
  审计分支（MIT）。

Zode 自身代码采用 MIT 许可——见 [LICENSE](LICENSE)。派生自上述项目的部分沿用原许可：ZCode
代码为 [LICENSE-APACHE](LICENSE-APACHE)，ZCodium 代码为 MIT。完整的署名链见
[NOTICE.md](NOTICE.md)。
