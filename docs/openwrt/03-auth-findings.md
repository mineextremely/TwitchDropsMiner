# 认证现状与对策（03）

> 2026-10-04 实测。本文记录一个影响整个移植计划的外部变化。

## 结论

- **device-code 登录已失效**：Twitch 拒绝本项目使用的客户端 ID（Android app 客户端）。上游对应 issue：**#1165 "KeyError: 'device_code'"**（2026-09-18 起，标记 Bug/Critical）。
- 上游维护者正在改用**浏览器自动化**（zendriver）重做登录（issue #1165, 2026-09-30 更新），该方向需要浏览器 + 显示环境，**与 headless/路由器目标天然冲突**，本移植无法采用。
- 因此本移植的认证策略：**以 `cookies.jar` 导入为唯一主线**（桌面端登录一次 → 拷贝到路由器），设备码流程保留但按"当前不可用"处理。

## 实测记录（2026-10-04）

| 测试 | 结果 |
|---|---|
| 直接 `POST https://id.twitch.tv/oauth2/device`（Android client id `kd1unb4b3q4t58fwlpcbzcbnm76a8fp`） | `{"status":400,"message":"invalid client"}` |
| 先 GET twitch.tv 取 `unique_id` cookie，再带完整请求头调用 | 同上，仍 400 → 确认为**服务端拒绝**，非请求构造问题 |
| 本地 headless 冒烟测试（WSL，Python 3.14，**无 tkinter/PIL**） | 正常启动 → 进入登录流程 → 清晰报错 → **退出码 1** ✓ |

## 对策

1. **路由器端只依赖 cookies.jar 恢复会话**：`_AuthState._validate()` 在存在有效 `auth-token` cookie 时完全不走登录交互（`twitch.py:389-430`），与 headless 天然契合。
2. **桌面端产出 cookies.jar 的途径**（现状，均需后续跟踪）：
   - 等待上游的浏览器自动化登录落地后，在桌面登录并复制 `cookies.jar`；
   - 或使用社区 workaround（bookmarklet 注入 token、浏览器登录助手等）；
   - 最低要求：文件里必须包含 `auth-token`（另含 `unique_id`/`persistent`）。
3. **已实现的防护**：`_oauth_login` 在响应缺少 `device_code` 时抛 `LoginException`（不再 `KeyError` 崩溃），消息明确提示改用 `cookies.jar`。
4. **待办（后续）**：
   - LuCI 页面展示登录状态与"cookie 失效"提示；
   - 提供 token/cookies.jar 的导入入口（上传或粘贴）；
   - 持续跟进上游 #1165 与 Twitch 完整性校验（integrity）的变化。

## 风险

若 Twitch 的完整性校验进一步收紧，即使持有效 token 也可能只能完成观看计数、无法自动领奖——需持续跟进上游进展，本移植无法单方面解决。
