# 状态数据面 / 配置面 / 运行时风险（02）

> 配套 `01-core-logic.md`。本文回答三件事：LuCI 页面显示什么、UCI 管理什么、移植必须先修什么。
> 行号基于分支 `openwrt` @ `22d0c61`。

## 0. 摘要

- 状态数据**全部已在内存里现成存在**（活动/掉落/进度/频道/websocket/登录），只需加一个导出层（JSON），几乎不用新增计算。
- 配置面存在两个坑：**类型包装格式**（`{"__type": ...}`）和**运行中配置被内存覆盖**。
- 运行时风险里有 6 项是"移植必须处理"，其中 3 项（致命错误挂起、无界内存增长、不可配置的数据目录）会直接影响 7×24 稳定性。

## 1. 状态数据面（LuCI 轮询 JSON）

数据来源一览（全部为现有属性）：

| 展示项 | 内存来源 |
|---|---|
| 状态机状态 | `Twitch._state`（`twitch.py:437`，`constants.py:252-260`） |
| 状态栏文字 | `StatusBar._label`（`gui.py:441-445`），调用点 `twitch.py:640..1515` |
| 图标状态 | `TrayIcon._icon_state`：`pickaxe/active/idle/error/maint`（`gui.py:1087-1205`） |
| 当前掉落 | `CampaignProgress._drop`（`gui.py:702`）→ `TimedDrop`（`inventory.py:218-329`）：游戏名、奖励、进度、剩余分钟、领取状态 |
| 当前活动 | `DropsCampaign`（`inventory.py:340-434`）：进度、已领/总数、剩余分钟 |
| 频道列表 | `Twitch.channels`（`twitch.py:454`，≤199 个）：名称/在线状态/游戏/drops/观众数/ACL/是否在挖 |
| WebSocket | `WebsocketPool.websockets`（`websocket.py:340`）：连接状态 + topics 计数（8 条 × 50 topics） |
| 登录 | `_AuthState._logged_in/user_id`（`twitch.py:84-85`）；**access_token 永不外泄** |
| 库存/活动列表 | `Twitch.inventory/_drops/_campaigns`（`twitch.py:440-442`），重建于 `1481-1502` |
| 控制台 | `ConsoleOutput._text`（`gui.py:811-834`）——注意：**无上限、无缓冲**，需要另建环形缓冲 |

**建议的 JSON schema（草案）**：

```json
{
  "ts": 1730000000.0, "version": "…",
  "state": "CHANNEL_SWITCH",
  "status_text": "Watching: foo", "status_key": "watching",
  "tray": "active",
  "auth": {"logged_in": true, "user_id": 12345678, "login_required": false,
           "device_code": null},
  "progress": {
    "watching_channel": {"id": 1, "name": "foo", "game": "Bar", "viewers": 123},
    "campaign": {"id": "…", "name": "…", "game": "…", "progress": 0.42,
                 "claimed_drops": 2, "total_drops": 7, "remaining_minutes": 120},
    "drop": {"id": "…", "name": "…", "rewards": ["…"], "progress": 0.5,
             "current_minutes": 30, "required_minutes": 60, "remaining_minutes": 30,
             "is_claimed": false, "can_claim": false}
  },
  "channels": [{"id": 1, "name": "foo", "game": "Bar", "viewers": 123,
                "status": "online", "drops_enabled": true, "acl_based": false,
                "watching": true, "selected": false}],
  "websockets": [{"index": 0, "connected": true, "status": "Connected",
                  "topics": 12, "topics_limit": 50}],
  "inventory": {"campaigns": [{"id": "…", "name": "…", "game": "…", "status": "active",
                  "eligible": true, "linked": true, "claimed_drops": 1, "total_drops": 5,
                  "progress": 0.3, "remaining_minutes": 100,
                  "starts_at": "…Z", "ends_at": "…Z",
                  "drops": [{"id": "…", "name": "…", "rewards": ["…"], "progress": 0.0,
                             "current_minutes": 0, "required_minutes": 60,
                             "is_claimed": false, "can_claim": false}]}]},
  "console": {"seq": 1234, "lines": [{"ts": "12:00:00", "level": null, "text": "…"}]},
  "counters": {"channels": 42, "campaigns": 5, "drops": 90}
}
```

需要**新增**的只有 5 个字段：`status_key`（语义化状态）、`auth.login_required`、`auth.device_code`（设备码对象：`user_code/verification_uri/expires_at/interval`，目前只是 `_oauth_login` 的局部变量，`twitch.py:154-159`）、`console.seq` + 环形缓冲。其余全部 1:1 直取现有属性。

## 2. 配置面

### 2.1 settings.json（`settings.py:14-40`）

| 键 | 类型/默认 | 磁盘形态 | GUI 可改 | headless 优先级 |
|---|---|---|---|---|
| `priority` | `[]` | 纯数组（**顺序有意义**） | ✔ | 高 |
| `exclude` | `set()` | `{"__type":"set","data":[…]}` | ✔ | 高 |
| `priority_mode` | `0` | `{"__type":"PriorityMode","data":0}`（0=仅优先 1=最早结束 2=可用最少优先） | ✔ | 高 |
| `proxy` | `URL()` | `{"__type":"URL","data":"…"}` | ✔ | 高 |
| `connection_quality` | `1`（1-6） | 整数 | **无控件**（只能改文件） | 高（弱网/路由器链路） |
| `available_drops_check` | `false` | 布尔 | ✔ | 中 |
| `language` | `"English"` | 字符串 | ✔ | 中 |
| `enable_badges_emotes` | `false` | 布尔 | ✔ | 低 |
| `tray_notifications`/`dark_mode`/`autostart_tray` | 布尔 | 布尔 | ✔ | 无（GUI 专用） |

> ⚠ **类型包装**：`utils.py:226-241` 的 `merge_json` 会把类型不匹配的值重置为默认。LuCI 直接写 `"exclude": ["A"]` 会被丢掉，**必须**写 `__type` 包装。
> ⚠ **覆盖风险**：设置只在 `_altered`/force 时落盘（`settings.py:99-101`，`twitch.py:649-651`）。守护进程运行中改 settings.json，会在下次库存刷新时被内存值覆盖 → **UCI 配置必须由启动脚本生成 settings.json**（服务停止时写入），或改造为"reload 时重读配置"。

### 2.2 CLI 参数（`main.py:110-121`）

`-v`（0-4）、`--log`（log.txt，无轮转）、`--tray`、`--dump`（仍然驱动 GUI 生命周期，`twitch.py:636-638,841-843`）、`--debug-ws/gql`。argparse 输出走 Tk messagebox（headless 必须重写）。建议在 headless 版转成 UCI 配置项，并保留 `--log` 语义给 procd（stdout→logd）。

### 2.3 建议的 UCI 结构（草案）

```
config twitchdropsminer 'main'
    option enabled '1'
    option data_dir '/mnt/mmcblk0p4/tdm'
    option log_level '1'          # 0=error..4=debug
    option connection_quality '1'
    option priority_mode '0'
    option available_drops_check '0'
    option language 'Chinese (Simplified)'   # 可选
    option proxy ''
    list priority 'Game A'
    list priority 'Game B'
    list exclude 'Game C'
```

启动脚本：读 UCI → 生成 `settings.json`（含 `__type` 包装）→ 启动 Python。

## 3. 运行时 / OS 风险（排名分先后）

1. **Tkinter/pystray 硬依赖**（`main.py:18,101`、`twitch.py:19,452`、`cache.py:14`）——不解决则完全无法启动。← 结构性问题
2. **致命错误/Captcha 会永久挂起**：`prevent_close()` + `wait_until_closed()`（`main.py:170-190`）在无人点关闭时永远等待 → 守护进程僵死。headless 必须改成"打印错误后按非零码退出"，交给 procd respawn。
3. **安装目录必须可写**：所有路径从可执行文件目录推导（`constants.py:94-109`）；源码运行时 `translate.py:457-460` 还会在 import 时重写 `lang/English.json` → OpenWrt 的 `/usr` 只读会直接崩。需要可配置数据目录 + 资源目录分离。
4. **`Twitch._campaigns` 无界增长**（`twitch.py:442,1502`）：每次库存刷新重新赋值、**从不清空**，长期运行内存单调增长（2GB 设备数月量级）。← 长跑泄漏
5. **磁盘增长**：`log.txt` 无轮转（`main.py:154`）、`dump.dat` 追加无上限（`twitch.py:1457-1479`）→ 小闪存需要轮转/上限。
6. **`cookies.jar` 非原子写**（`twitch.py:428,517`，aiohttp `CookieJar.save` 直接覆写）且读取错误被吞（`470-476`）→ 断电即掉登录。建议改为临时文件+rename。
7. **登录流程 GUI 绑定**（`twitch.py:121-332`、`gui.py:598-606`）→ headless 需要 6.2 节方案（预置 cookies / 自动确认设备码）。
8. **时钟依赖**：websocket ping 用墙上时钟（`websocket.py:191-199`），挖宝判定用 UTC（`inventory.py`/`twitch.py`）→ 路由器必须有可用 NTP；时钟跳变会造成 WS 重连抖动。无需 tzdata 包（无 `zoneinfo` 引用），本地时间显示靠 `/etc/localtime`。
9. **图片缓存**（`cache.py:51-52,121-141`）与 `cache/mapping.json` 单调增长 → headless 建议整体去掉（Pillow 依赖一并消失）。
10. **`--dump` 仍驱动 GUI 生命周期**（`twitch.py:636-638,841-843`）→ headless 下需解耦或禁用。
11. **CPU 唤醒频率**：GUI 20Hz 轮询（`gui.py:2404-2429`）+ 最多 8 条 WS 的 0.5s 接收轮询（`websocket.py:242,286`）→ 去掉 GUI 后剩 WS 部分，可接受；不必为 RK3566 优化。
12. **truststore + 系统 CA**（`main.py:22-23`）：需要 `ca-bundle`；缺 CA 则全部 HTTPS/WSS 失败。
13. **ExponentialBackoff 步数无界**（`websocket.py:118-142`）：多日断网时 `2**steps` 膨胀（轻微）。
14. **退出码约定**：3=已在运行、4=设置错误、2=参数错误、1=致命、0=正常；`lock.file` 用 `fcntl` 锁（`utils.py:85-91`），procd 判断状态应以进程为准。

## 4. 移植必须处理清单（可执行）

| # | 事项 | 涉及位置 |
|---|---|---|
| M1 | headless UI 替身（01 号文档第 7 节契约） | 新增模块 + `twitch.py:19,452` 注入点 |
| M2 | headless 入口：跳过 Tk/argparse 弹窗；信号绑 `client.close()`；致命错误自动退出（非零码） | `main.py:101-135,163-190` |
| M3 | 数据目录可配置（`--data-dir`/env）：cookies/settings/log/lock/cache 全部迁移；资源目录保持只读 | `constants.py:94-109` |
| M4 | 去掉 `utils.py:14` 的模块级 tkinter；`set_root_icon` 惰性化 | `utils.py:14,41` |
| M5 | 屏蔽 `translate.py:457-460` 的 `lang/English.json` 重写（打包运行时） | `translate.py` |
| M6 | 状态导出（JSON 文件或 HTTP）：第 1 节 schema + `console` 环形缓冲 | 新增模块 |
| M7 | 设备码登录状态导出 + 自动确认（`ask_enter_code` 非阻塞） | `twitch.py:121-193`、`gui.py:598-606` |
| M8 | `connection_quality` 纳入配置（目前无 GUI 入口） | `twitch.py:479-487` |
| M9 | 可选修复：`_campaigns` 清理、`cookies.jar` 原子写、log 上限/轮转 | `twitch.py:442,1502,428,517`、`main.py:154` |
| M10 | 去掉 `--dump` 的 GUI 依赖或禁用 | `twitch.py:636-638,841-843` |

M1–M3 是**跑起来的最小集**；M6–M7 是 LuCI 可用的前提；M9 是 7×24 稳定性的建议修复。
