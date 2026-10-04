# TwitchDropsMiner 核心逻辑解析与 OpenWrt 可实现性（01）

> 本文是 OpenWrt 移植（headless + `twitch-drops-miner` / `luci-app-twitchdropsminer` / `luci-i18n-twitchdropsminer-zh-cn` 三包）的第一份基础分析。
> 行号基于分支 `openwrt` @ `22d0c61`（与 upstream/master 一致）。

## 0. 结论摘要

**核心挖宝逻辑与 UI 完全解耦，可在 OpenWrt 上原样实现。**

- `Twitch._run()` 是自包含的 asyncio 状态机（`twitch.py:608-886`），**不依赖任何 UI 事件驱动**——没有任何"UI tick 推动核心"的设计。
- 核心对 GUI 的依赖只有 12 个**行为性**接口（第 7 节），其余全部是可空操作的展示调用。
- 唯一需要"动脑"的耦合点是 60 秒进度计时器（`minute_almost_done`），headless 下有明确的安全策略（第 6.1 节）。
- 需要绕开的三个启动阻塞：`twitch.py:19` 的 `from gui import GUIManager`、`twitch.py:452` 的无条件构造、`main.py` 的 Tk 参数解析窗口（第 8 节）。

## 1. 状态机与主循环

`State`（`constants.py:252-260`）：`IDLE` → `INVENTORY_FETCH` → `GAMES_UPDATE` → `CHANNELS_CLEANUP` → `CHANNELS_FETCH` → `CHANNEL_SWITCH`，另有 `RESTART`、`EXIT`。

```
Twitch.run()  (twitch.py:592-606)
 └─ while True: _run()
      ├─ ReloadRequest → shutdown() → 重新 _run()
      └─ ExitRequest   → 退出

Twitch._run() (twitch.py:608-886)
 ├─ 启动序（617-633）: gui.start() → get_auth()（可能触发登录，阻塞）→ websocket.start()
 │                    → 创建 _watch_loop 任务 → 订阅 user-drop-events / onsite-notifications
 │                    → change_state(INVENTORY_FETCH)
 └─ 分发循环（634-886）: if/elif self._state，末尾 await self._state_change.wait()
```

各状态要点：

| 状态 | 行为 | 去向 |
|---|---|---|
| `IDLE` | 不挖；等待外部事件（维护任务/websocket 通知/EXIT） | 任意 change_state |
| `INVENTORY_FETCH` | 拉 Inventory+Campaigns（GQL），构建 `DropsCampaign`/`TimedDrop`，启动维护任务，`save()` | `GAMES_UPDATE` |
| `GAMES_UPDATE` | **先补领所有 `can_claim` 的掉落**（655-659），再按 priority/exclude/priority_mode 计算 `wanted_games` | `CHANNELS_CLEANUP` |
| `CHANNELS_CLEANUP` | 清理不再需要的频道（离线/不在目标游戏/非 ACL） | `CHANNELS_FETCH` 或 `IDLE` |
| `CHANNELS_FETCH` | 重建频道列表（ACL 频道 + 游戏目录直播频道），按观众数/优先级排序，裁剪到 198 个，注册 websocket topics | `CHANNEL_SWITCH` |
| `CHANNEL_SWITCH` | 优先后 `gui.channels.get_selection()`，否则按 `get_priority` 找 `should_switch` 的频道 | 切换或 `IDLE` |
| `RESTART` | `raise ReloadRequest` → shutdown → 全新 `_run` | `INVENTORY_FETCH` |
| `EXIT` | 收尾并退出循环 | — |

登录不是状态：在 `_run` 开头经 `get_auth()` 一次性完成（`twitch.py:358-430`），失败时会进入阻塞式交互（见 6.2）。

## 2. 后台任务

`Twitch.__init__` 中声明（`twitch.py:434-461`）：

- `_watching_task` → `_watch_loop()`（895-958，`@task_wrapper(critical=True)`）：核心挖宝循环。
- `_mnt_task` → `_maintenance_task()`（960-990）：每小时触发一次 `INVENTORY_FETCH`（刷新活动/掉宝），触发一次后自灭，由 `fetch_inventory` 末尾重建。
- `websocket`：`WebsocketPool`，最多 8 条连接（`MAX_WEBSOCKETS`），每条一个 `_handle` 任务（`critical=True`），断线自动退避重连（max 3 min）。
- 其余为一次性任务：spade 上报、campaign 详情分片、`bulk_check_online` 分片等，全部有显式取消路径。

**关键语义**：`task_wrapper(critical=True)`（`utils.py:127-157`）在任务意外死亡时会调用 `Twitch.close()` → `State.EXIT`。也就是说，**watch/维护/websocket 任一任务崩溃 = 整个应用退出**。headless 的 `close_requested` 必须是真实事件，否则这条致命路径无法传播。

## 3. 进度判定（核心机制）

两个来源：

1. **websocket `drop-progress` 事件**（`process_drops`，1161-1217）：把 Twitch 推送的 `currentMinutesWatched` 差值应用到**整个 campaign** 的所有掉落（`inventory.py:444-448`），并清零 `extra_current_minutes`。
2. **watch 循环兜底**（`_watch_loop`，895-958）：
   - 每 20 秒向当前频道发一次 spade"观看分钟"上报（`channel.send_watch()`，HTTP 204）。
   - `if self.gui.progress.minute_almost_done():`（**唯一的值耦合点**，见 6.1）→ 先试 GQL `CurrentDrop` 取真实进度；失败则**乐观 +1 分钟**（`campaign.bump_minutes()`），单个掉落最多虚拟 +15 分钟（`MAX_EXTRA_MINUTES`），达到上限就 `change_state(CHANNEL_SWITCH)` 换频道以换取真实进度。
   - `_watch_sleep(WATCH_INTERVAL - elapsed)`，`WATCH_INTERVAL=59s`。

**领取**发生在两处：每次 `GAMES_UPDATE` 补领（655-659）、websocket `drop-claim` 事件即时领取（1181，随后轮询 `CurrentDrop` 直到 Twitch 开放下一个掉落）。

## 4. 频道 / 优先级逻辑

- `wanted_games`：由 `settings.priority`（有序游戏名列表）、`settings.exclude`（集合）、`settings.priority_mode`（`PRIORITY_ONLY` / `ENDING_SOONEST` / `LOW_AVBL_FIRST`）计算；只保留"未来 1 小时内可赚取"的活动（679-690）。
- 频道选择：`can_watch()`（992-1012）判断频道是否在线、是否在目标游戏、是否 drops 启用；`should_switch()`（1014-1031）比较游戏优先级与 ACL 权重。
- 事件驱动：websocket `stream-up/down`、`viewcount`、`stream-update` → `process_stream_state`/`process_stream_update`/`on_channel_update`（1051-1159），在线且更优的频道会立即触发切换。

## 5. 错误处理

- `request()`（1239-1288）：指数退避（最大 180s）；`gui.close_requested` 时抛 `ExitRequest`；5xx 重试。
- `gql_request()`（1298-1374）：`RateLimiter(5/s)`，退避最大 60s，对 `service timeout` / `request cancelled` 等做单次重试。
- websocket：`_backoff_connect`（最大 3 min）+ PONG 超时（PING 3 min / 超时 10s）自动重连。
- 顶层 `main.py:138-197`：`CaptchaRequired` 或任何异常 → 退出码 1，`prevent_close()` 让界面停留展示错误 → `shutdown()` → `wait_until_closed()` → `save(force=True)`。

## 6. 需要"动脑"的两个耦合点

### 6.1 60 秒计时器（`minute_almost_done`）

真实语义（`gui.py:758-760`）：GUI 在 `display_drop(countdown=True)` 时启动 60 秒倒计时任务；`minute_almost_done()` 在计时器**不存在**或**剩余 ≤10s** 时返回 `True`。核心从不自己启动这个计时器。

headless 策略二选一：

- **(A) 恒 `True`（推荐）**：等价于"没有计时器在跑"的真实语义；代价是每 ~59s 多一次 `CurrentDrop` GQL 查询（限速 5/s，无压力）和乐观 +1 分钟（有 15 分钟上限、超限换频道），与设计意图一致。
- (B) 忠实实现一个由 `display_drop()` 重启的 60 秒倒计时。仅在需要与桌面版行为逐秒对齐时才值得做。

### 6.2 登录（`ask_login` / `ask_enter_code`）

只在 cookie/token 失效时可达。headless 必须让它们**永不阻塞**：

- 预置 `cookies.jar`（桌面端登录后拷贝，client 固定 `ANDROID_APP`，跨平台通用）→ 完全不走交互路径；
- 设备码流程：把 `user_code` 输出到日志/状态文件后**立即自动确认**（不等待按键），用户在任何设备上打开 `twitch.tv/activate` 输入即可——非常适合 LuCI 页面展示。

## 7. 核心 → GUI 调用审计

### (a) 控制流/必须忠实实现（12 项）

| 接口 | 位置 | 要求 |
|---|---|---|
| `close_requested` | 1251, 1521; `main.py:183` | 真实事件驱动的布尔属性 |
| `close()` | 637, 842; 对照 `gui.py:2431-2439` | **置位关闭事件 + 调用 `twitch.close()`** |
| `wait_until_closed()` | 1288（退避睡眠）; `main.py:190` | 真 await；立即返回会导致重试热循环 |
| `coro_unless_closed(coro)` | 1261 | 与关闭事件赛跑，关闭时抛 `ExitRequest` 并取消失败方 |
| `prevent_close()` | 556 / `main.py:174` | 清除关闭事件 |
| `channels.get_selection()` | 848 | **返回 `None`**（走优先级自动选台） |
| `progress.minute_almost_done()` | 910 | 见 6.1，默认恒 `True` |
| `progress.stop_timer()` / `display_drop()` / `clear_drop()` | 1048 / `inventory.py:327` / 1043 | 空操作即可（与 6.1(A) 配对） |
| `inv.add_campaign(campaign)` | 1509, 1513 | **必须是 `async def`**，否则 `TypeError` |
| `channels` 对象（`display/remove/set_watching/clear_watching/clear`） | `channel.py:177, 294, 300` | 必须在任何 `Channel` 构造前就存在 |
| `login.ask_login()` / `login.ask_enter_code()` | 162, 218 | 非阻塞（6.2） |
| `help._invalidate_button.config(state=...)` | 102, 119, 429 | 哑对象即可 |

### (b) 装饰性，可空操作（摘要）

`print`、`status.update`、`tray.change_icon/notify/update_title`、`set_games`、`save`、`grab_attention`、`start/stop/close_window`、`inv.clear/update_drop`、`websockets.update/remove`、`channels.clear/display/remove/set_watching`。

## 8. 接入方式建议

1. **不导入 `gui.py`**（它模块级拉 `tkinter`/`pystray`/`PIL.ImageTk`）。
2. 在 `twitch.py` 把 `from gui import GUIManager`（19）改为可注入；`Twitch.__init__`（452）改为构造注入的 UI 类。
3. `main.py` 增加 headless 入口分支：跳过 Tk 参数解析窗口（101-135）、`messagebox`、信号处理改绑 `client.close()`。
4. `utils.py:14` 的 `tkinter` import 需要惰性化（`set_root_icon` 仅 GUI 用）。
5. 参考先例：`gui.py:2829-2958` 的调试 harness 已经把替身 UI 需要满足的调用面枚举过一遍，可作为核对清单。

## 9. 相关文档

- `02-status-config-runtime.md`：状态数据面（LuCI JSON schema 草案）、配置面（UCI 映射、`__type` 包装陷阱）、7×24 运行时风险清单与"移植必须处理清单"（M1–M10）。
