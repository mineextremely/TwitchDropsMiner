# 能不能用「更原生」的方式跑在 OpenWrt 上？（07）

> 本文做**可行性判断**，不写任何实现代码。
> 起因：`openwrt` 分支的 CI 一次要跑 20 分钟以上，对一个只会收发 HTTP/WebSocket 的
> 小工具来说很反常，于是怀疑是 Python 拖累，考虑迁移到别的语言。
>
> 数据来源：构建 run `37439459091`（`936646b`）的完整步骤日志、
> 路由器 192.168.20.1 上的实测、以及 `01`/`06` 两份既有分析。
> 标注 **[实测]** 的是量出来的，**[推断]** 的是从日志结构推出来的、没有单独验证过。

---

## 0. 结论摘要

1. **20 分钟里没有一秒花在「编译 Python 代码」上。** 我们自己的三个包各占 1 行日志，
   合计不到 10 秒。**[实测]**
2. 时间花在**依赖闭包**上：`DEPENDS:=+python3` 让 SDK 从源码交叉编译一整套
   CPython 3.13.9 + openssl + libffi + gdbm + ncurses + readline + sqlite3…… 约 11 分钟。**[实测]**
3. 剩下的大头是 **SDK 压缩包下载 246MB / 4.8 分钟**。而且这 246MB 对 release 镜像
   来说是**纯白下**——镜像里本来就自带一套完整可用的 SDK（交叉工具链 + 349 个 host 工具，
   已实测）。`gh-action-sdk` 的 `entrypoint.sh` 无条件重下一遍。workflow 里那个
   `actions/cache` 也是坏的，缓存路径压根不存在，从来没命中过。**[实测]**
4. **所以「CI 慢」和「Python 作为运行时」是两个独立的问题。** 第 3 条是纯配置 bug，
   10 分钟就能修；第 2 条才是语言选择带来的成本。
5. 设备侧 Python 的真实代价并不大：**11MB flash + 42MB RAM**，CPU 空闲时约 0.4%。**[实测]**
   这台设备有 875MB 空闲 flash 和 2GB RAM——**不构成约束**。
6. **迁移语言能省下的，主要是那 11 分钟 CI，而不是运行时。**
   但要付出的代价是：放弃跟踪一个**活跃维护的上游**，并把 Twitch 那套
   随时会变的私有接口（15 个会轮换的 persisted-query 哈希、写死的 client-id、
   爬页面找 spade URL）全部自己再实现一遍。**这笔账大概率是亏的。**
7. 如果仍然要做，**Go 是唯一说得通的目标**（静态二进制、零依赖、交叉编译一个环境变量），
   不是 C，更不是 ucode/Lua。

---

## 1. 实测：20.84 分钟到底花在哪

`Build packages` 步骤（`aarch64_generic-25.12.3`），按时间轴切片：**[实测]**

| 时间窗 | 时长 | 在干什么 |
|---|---|---|
| +0.0 → +4.84m | **4.8 min** | docker 拉基础镜像（270MB+401MB 层）+ **下载 SDK 压缩包 246MB** |
| +5.0 → +5.9m | 0.9 min | `feeds update -a` / `feeds install` |
| +6.0 → +17.8m | **~11 min** | **交叉编译 CPython 3.13.9 及其依赖闭包** |
| +9.3 → +20.4m | ~11 min（与上一行并行） | **交叉编译 openssl-3.5.6**（`-DBSAES_ASM` 等） |
| +17.9m | **约 1 行** | **我们的 `twitch-drops-miner` 打 apk** |
| +20.4m | **约 1 行** | **我们的 `luci-app-twitchdropsminer` 打 apk + `.lmo` 编译** |

被编译的目标包清单里能直接看到 Python 的闭包：`libffi-3.4.7`、`gdbm-1.25`、
`ncurses-6.4`、`readline-8.3`、`sqlite-autoconf-3530000`、`xz-5.8.1`、`bzip2`、
`openssl-3.5.6`、`Python-3.13.9`。**[实测]**

> **[推断]** 这些包具体是被 `python3` 拉的还是被 `luci-base` 拉的，我没有逐条拆开
> （openssl 和内核 kmod 可能有一部分来自别处）。要精确定量，得做一次
> 去掉 `+python3` 的对照构建。但 `Python-3.13.9` 本身 + `-C .../Python-3.13.9` 的编译窗
> 就横跨 11 分钟，这个量级是确定的。

### 1.1 顺带发现：CI 编出来的 Python 和设备的 Python 不是同一个版本

- CI（SDK 25.12.3）编的是 **Python 3.13.9**。**[实测]**
- 设备上跑的是 **Python 3.14.5**（ImmortalWrt snapshot 自带）。**[实测]**
- 仓库里 vendored 的 wheel 是 `cpython-314-aarch64-linux-musl.so`。**[实测]**

也就是说 CI 那 11 分钟编出来的 python3，**在设备上根本不会被用到**——设备用自己的
3.14.5。它只是为了满足 `DEPENDS:=+python3` 这个声明，让构建图能闭合而已。

### 1.2 未解：`PKG_MIRROR_HASH` 在本地复现不出来

本地复现构建时撞上的，**目前没有解释**，如实记录。

**现象**：在本地 WSL 跑 `make package/twitch-drops-miner/download`，
生成的 tarball 哈希是 `9bb8b035101f454e25460b625cdcc50c2ea1bb89894e63380ab82ec2e2b9afd6`，
而 Makefile 里钉的是 `6a8be99b8f8ff78b42bef87729b35c42ca796110b96afe5b918032cdb6b7560e`，
于是报：

```
Hash mismatch for file twitch-drops-miner-16.0_pre.tar.zst:
  expected 6a8be99b..., got 9bb8b035...
```

而 **CI 在同一天（run 37439459091）用同一个提交构建成功**，说明那边确实得到 `6a8be99b`。

**已经排除的可能**：**[实测]**

| 猜想 | 验证结果 |
|---|---|
| 镜像不同 | ❌ 本地镜像 digest `sha256:a3e0d6ce…` 与 ghcr 上当前的 tag digest **完全一致** |
| 两条下载路径产出不同 | ❌ **不成立**。限流走回退路径（clone-then-pack）得 `9bb8b035`；配额充足走主路径（GitHub tarball API）**也是** `9bb8b035`。两者内容一致 |
| 仓库里有 `.gitattributes` | ❌ `d08384a` 和当前 HEAD 都没有这个文件 |
| 提交被改写 | ❌ SHA 钉死，理论上不可能 |

**仍未解释**：同样的镜像、同样的提交、同样的脚本，本地与 CI 得到不同的字节。
可疑方向（都未验证）：`zstd -T0 --ultra -20` 的输出是否真的可复现；
GitHub `/tarball/<ref>` 端点返回内容是否稳定。

**这对项目意味着什么（保守结论）**：
- `AGENTS.md` 里「唯一可靠的做法：在 SDK 容器里跑一次 compile 然后 `sha256sum dl/…`」
  ——**这个做法本身有问题**：在不同环境下跑出的值可能不同。至少在换机器/换网络时要重新核对，
  不能假定它跨环境可复现。
- 在没有解释清楚之前，**不要**把这条写进文档当结论。

**顺便**：`dl_github_archive.py` **不支持 token**——源码里只有裸 `https://api.github.com`，
没有 `Authorization` 头，也没有 `GITHUB_TOKEN`/`GH_TOKEN` 处理。所以
**没法靠登录账号把 60 次/小时提到 5000 次/小时**，除非自己维护一份打过补丁的脚本。
好在也不需要：一旦 `dl/` 被持久化（见 6.2），下载步骤整个被跳过，根本不会碰 API。
它还有个提交时间戳缓存在容器内的 `/tmp/dl/github.commit.ts.cache`，一并持久化即可。

### 1.3 CI 缓存是坏的（可直接修，与语言无关）

```yaml
- name: Cache OpenWrt SDK
  with:
    path: /opt/openwrt-sdk-${{ matrix.arch }}-${{ matrix.sdk }}
```

- 查找阶段：`Cache not found for input keys: sdk-aarch64_generic-25.12.3` **[实测]**
- 保存阶段：`[warning]Path Validation Error: Path(s) specified in the action for
  caching do(es) not exist, hence no cache is being saved.` **[实测]**
- 整个构建步骤里字符串 `/opt/openwrt-sdk` 出现 **0 次**——gh-action-sdk 把 SDK
  解到 **Docker 镜像内的 `/builder`**，宿主机上那个路径从来没被创建过。**[实测]**

**结论：这个 cache 从建立起就没生效过，每次构建都在重新下 246MB。**

---

## 2. 实测：运行时到底占多少

| 指标 | 实测值 |
|---|---|
| 进程 RSS | **42.6 MB**（VmSize 47.7 MB） |
| 线程数 | **2**（主线程 + DNS 解析瞬时线程） |
| 空闲 CPU | 约 **0.4%** 单核（30 秒采样 11 个 tick） |
| 启动耗时 | 裸解释器 0.115s；**`import aiohttp` 单独就要 2.0s**；整机到就绪约 4s |

### flash 占用（这里数字比直觉大，注意别只看 `python3-light`）

| 组件 | 占用 | 说明 |
|---|---|---|
| `twitch-drops-miner` | **3.69 MiB** | 234 个文件；deps（9 个 wheel 解压并 strip 后）3.18 MiB + 应用代码 331 KiB + `lang/` 180 KiB |
| `+python3` 实际拉进来的 | **14.74 MiB** | `python3` 是 meta 包，带 **18 个**依赖，不只是 `python3-light` |
| `luci-app` + i18n | 22 KiB | |
| **合计** | **≈ 18.5 MiB** | 首次运行生成 `.pyc` 后涨到 **≈ 20.1 MiB** |
| 设备空闲 flash | **875 MB** | 1.2G 分区，用了 277.8M |
| 设备 RAM | 2 GB | |

**⚠️ 容易看错的地方**：`apk info -s python3` 只显示 `1 B`（meta 包），
`python3-light` 显示 7.6 MB——但真正的开销是整条 meta 闭包 **14.74 MiB**。

**其中 2.6 MiB 是永远用不到的**：`pydoc`(840K)、`xml`(693K)、`unittest`(318K)、
`decimal`(215K)、`ctypes`(214K)、`ncurses`(161K)、`sqlite3`(117K)、`dbm`(61K)、
`readline`(29K)——全是因为 `DEPENDS:=+python3` 用的 meta 包。**[实测]**

应用侧也有一点死重：包会把 15 个根 `.py` **全部**装进去，包括 headless 永不导入的
`gui.py` + `cache.py` + `registry.py`（合计 126 KiB）；`main.py:4` 那句
`from multiprocessing import freeze_support` 是给 PyInstaller 用的，在 OpenWrt 上
毫无意义，却让 428 KiB 的 `python3-multiprocessing` 进了依赖闭包。**[实测]**

### 第三方依赖

**只有 aiohttp 一条链，9 个 wheel**（aiohttp + aiohappyeyeballs + aiosignal +
attrs + frozenlist + multidict + propcache + yarl + idna），压缩后 2.64 MiB、
解压 strip 后 3.18 MiB。没有 requests、没有 websockets 库
（WebSocket 是自己写的，`websocket.py`）。

应用代码本身只有 **331 KiB**，其中 headless 实际可达的仅 **208 KiB**。

**判断：flash 和 RAM 都不是瓶颈。** 换成 Go/C 大概能省 35MB RAM 和 18 MiB flash，
但设备本来就有 875MB 空闲——这个收益是审美层面的，不是功能层面的。

> 顺带三个**低风险瘦身点**（与换语言无关，加起来约 3.2 MiB）：
> 把 `DEPENDS` 从 `+python3` 收窄到实际导入的 10 个包（省 2.6 MiB）；
> 装包时跳过 3 个 dead `.py`（省 126 KiB）；去掉那句 `multiprocessing` import（省 428 KiB）。
> 收窄 `DEPENDS` **可能还会顺带缩短构建闭包**，但没验证过。

---

## 3. 当前实现方式（一个进程、一个事件循环）

这部分回答「运行逻辑是什么」，详细版在 `01-core-logic.md`，这里只留迁移需要的骨架。

### 3.1 进程模型

- **单进程、单线程、单个 asyncio 事件循环。** 运行时不碰 `threading`、
  不用多进程、没有 `asyncio.Queue`。**[实测：只有 2 个线程]**
- 组件间靠**直接方法调用和回调**通信，不是消息传递。
- 唯一的 OS 线程来自 aiohttp 的 `ThreadedResolver`（`getaddrinfo` 跑在默认 executor）。

### 3.2 三长循环 + 一个状态机

| 循环 | 频率 | 职责 |
|---|---|---|
| 状态机 `Twitch._run()` | 事件驱动 | `IDLE → INVENTORY_FETCH → GAMES_UPDATE → CHANNELS_CLEANUP → CHANNELS_FETCH → CHANNEL_SWITCH` |
| `_watch_loop` | 59 秒 | 发 spade「观看分钟」上报；卡住就用 GQL 兜底，再不行本地 +1 分钟（上限 15） |
| `_maintenance_task` | 每小时 / 触发器 | 强制重拉库存；掉宝开始/结束时提前触发 |
| `_status_writer` | 2 秒 | 写 `/tmp/twitchdropsminer.status.json`（库存文件按变化节流 ≥10 秒） |

### 3.3 空闲 vs 挖宝

- **空闲**：状态机停在 `IDLE` 的 `Event.wait()` 上，**零轮询**。只有
  1 条 WebSocket 每 3 分钟 PING 一次 + 每小时一次 GQL 批量刷新 + 每秒 0.5 次状态文件写入。
- **挖宝中**：每 59 秒一次 spade POST + 每 59 秒一次 GQL `DropCurrentSessionContext`，
  外加 WebSocket 实时推送的 `drop-progress` / `drop-claim`。全局限速 5 GQL/秒、50 连接。

### 3.4 代码量

- 仓库 Python 总计 **8737 行**。
- **约 40% 是 GUI-only**（`gui.py` 2971 行 + `cache.py` + `registry.py`），headless 完全不导入。
- **headless 真正承重的约 5100–5250 行**，其中挖宝核心
  （`twitch.py` + `channel.py` + `inventory.py` + `websocket.py` + `utils.py` + `constants.py`）
  ≈ **4070 行**。

---

## 4. 重写要重新实现什么（协议面）

**好消息**：协议面是有限、封闭的。**[实测]**

| 类别 | 数量 | 说明 |
|---|---|---|
| 活跃 REST 端点 | **7** | validate / 根页面拿 device_id / 频道页爬 spade_url / settings JS 兜底 / spade POST / …… |
| GraphQL | **1 个端点** | `gql.twitch.tv/gql`，**9 个活跃 persisted operation**（只有 operationName + sha256，没有查询体） |
| WebSocket | **1 个** | `wss://pubsub-edge.twitch.tv/v1`，**4 类活跃 topic** |
| 认证 | 1 条可用路径 | 上传 `cookies.jar`（设备码流程已被 Twitch 关闭，上游 #1165） |

**坏消息**：这套接口是**没有文档、随时会变**的。

迁移后必须自己扛的脆弱点：

1. **15 个写死的 persisted-query sha256**——Twitch 静默轮换就全挂，而且查询体不在源码里，
   本地算不出来，只能等上游更新。
2. **写死的 client-id 和安卓 UA**——Twitch 封客户端是周期性的。
3. **靠正则爬频道页面找 spade URL**（两级：先 HTML，再 `settings.<32hex>.js`）——
   页面改版就断，而这是挖宝的核心链路。
4. **逆向出来的 spade 上报载荷**（`minute-watched` 事件，14 个字段）。
5. **反向解析的 PubSub 事件 schema**（`viewcount` / `stream-up/down` / `drop-progress` / `drop-claim`）。

**这五条与用什么语言无关。** 换成 Go 之后，Twitch 改一次接口，Python 版能 merge
上游的修复，Go 版得自己逆向一遍。

---

## 5. 四条路线的取舍

| 路线 | CI 时间 | flash/RAM | 工作量 | 上游跟得上？ | 评价 |
|---|---|---|---|---|---|
| **A. 留在 Python，修构建** | 20.8 → **约 6 min**（修 cache 后可能 ~2 min） | 不变 | 极小（改 yml + 可能去掉 `+python3`） | ✅ 照旧 | **性价比最高** |
| **B. Go 静态二进制** | 约 2–5 min | ~1–2MB / ~8–15MB | 大（重写 ~4–5k 行异步逻辑 + 全部协议面） | ❌ 完全脱离 | 唯一说得通的重写方向 |
| **C. C + libcurl + libwebsockets** | 5–8 min | 最小 | 最大（还要自己管 TLS/事件循环） | ❌ | 收益不如 B，成本高于 B |
| **D. ucode / Lua** | 最「原生」 | 小 | 大 | ❌ | ucode 没有异步 HTTP/WS 客户端栈，得基于 uloop 手搓 TLS+HTTP+WebSocket，比 Python 更糟 |

---

## 6. 解决路径（备案：能不动就不动）

**结论先行：不用换语言，也不用放弃上游。** 下面三条各自独立、可单独执行、可回滚。
按「收益/风险」排序，**只有第 1 条值得随时做**，后两条是设备空间紧张时才考虑。

---

### 6.1 为什么现在的缓存机制全都失效（先说清楚，否则会白改）

两个独立的原因，**必须分别解决**：

**(a) SDK 下载（4.8 min）——发生在容器运行时，而且对 release 镜像来说是纯冗余**

`gh-action-sdk` 的 Dockerfile 只有 4 行，镜像就是 `ghcr.io/openwrt/sdk:<ARCH>`；
`entrypoint.sh` 开头是：

```bash
group "bash setup.sh"
# snapshot containers don't ship with the SDK to save bandwidth
# run setup.sh to download and extract the SDK
[ ! -f setup.sh ] || bash setup.sh
```

注意这里测的是**相对路径**，而容器的 WORKDIR 就是 `/builder`，
镜像里 `/builder/setup.sh` 确实存在 → **每次都会执行**。而 `setup.sh` 干的是：
下载 `sha256sums` + 签名 → GPG 验签 → **下载 246MB SDK tarball** → 校验 →
`tar xf ... --strip=1 -C .` 解压覆盖 `/builder` → 删掉 tarball。

**但这句话只对 snapshot 镜像成立。** 实测官方 release 镜像
`ghcr.io/openwrt/sdk:aarch64_generic-25.12.3` **自带一套完整可用的 SDK**：**[实测]**

```
镜像里 /builder 的内容：
  PRESENT  include(49)  scripts(93)  package(3)  target(1)  staging_dir(3)  build_dir(1)  dl(0)
  MISSING  tools/  toolchain/  bin/  .config      ← SDK 本来就没有 tools//toolchain/ 源码目录
交叉工具链（不经 setup.sh 直接可用）：
  aarch64-openwrt-linux-musl-gcc (OpenWrt GCC 14.3.0 r32912-6639b15f62) 14.3.0
host 工具：staging_dir/host/bin/ 下 349 个
target sysroot：staging_dir/target-aarch64_generic_musl/{include,usr}
```

**所以对这组矩阵来说，那 246MB 是白下的**——镜像里已经有现成的了。
它下完解压、把同一份东西又铺一遍，然后删掉压缩包。

它也不在镜像构建阶段，而在 `docker run` 阶段——所以 action.yml 里那套
`cache-to: type=gha,mode=max` 的 buildx 缓存只覆盖 `FROM + ADD entrypoint.sh`
这两层（几 KB），**对下载完全无效**。

**(b) 依赖编译（~11 min）——容器是 `--rm` 临时的，每次从零开始**

`docker run --rm`，只挂了 `/artifacts` 和 `/feed` 两个卷。
`build_dir/`、`staging_dir/` 全在容器里，容器一退就没了。
所以即使把下载搞定，CPython 和 openssl 每次仍然要重新交叉编译。

> **所以 workflow 里那个 `actions/cache` 步骤（缓宿主机 `/opt/openwrt-sdk-*`）
> 是三重无效的**：路径不存在、缓的方向不对、就算存在也盖不住容器内的状态。
> 它从建立起就没命中过。

---

### 6.2 备案 A（**已实测完，结果和我最初的预期不符**）

**先说结论：只有「跳过 SDK 下载」这一条被验证有效，约省 5 分钟。
「缓存 `staging_dir`/`build_dir` 让依赖编译变成增量」——实测无效。**

#### 实测过程

在本地 WSL 里用**与 CI 完全相同的容器**（`ghcr.io/openwrt/sdk:aarch64_generic-25.12.3`
+ gh-action-sdk 的 entrypoint，镜像 digest 与 ghcr 当前 tag 一致），跑了三轮：

| 跑法 | 耗时 | 说明 |
|---|---|---|
| **run1** 冷启动，仅跳过 SDK 下载 | **773s = 12.9 min** | 产出三个 apk，字节数与 CI 产物一致 |
| **run2** 挂上 `staging_dir` + `build_dir` 缓存 | **692s = 11.5 min** | 只快 81 秒 |
| **run3** 同上，另把 `CONFIG_AUTOREMOVE=y` 改成 `n` | **755s = 12.6 min** | 没有改善 |

**三次都重新 `clean-build` + `compile` 了 `openssl-3.5.6` 和 `Python-3.13.9`。**
11.5–12.9 分钟的差异全在噪声范围内。**[实测]**

#### 唯一确定有效的一条

`entrypoint.sh` 无条件执行 `setup.sh`，而官方 **release 镜像本来就自带完整 SDK**
（交叉工具链 + 349 个 host 工具，实测可用）。用空脚本顶掉 `setup.sh` 的内容之后：

- 246MB **不再下载**（日志里搜不到那行 URL）
- 等效构建 **12.9 min**（CI 的 `Build packages` 步骤是 20.84 min，其中 4.84 min 是下载）

所以现实预期是 **20.8 min → 13~16 min**，**不是**我最初设想的 1~2 min。

> 注意 12.9 min 这个数还占了「`feeds/` 已经缓存好」的便宜。
> CI 冷启动要 `feeds update -a` 全程 clone，所以真实值会更高一些。

#### 为什么增量不生效（**没查清**）

即使 `CONFIG_AUTOREMOVE=n`、`staging_dir`/`build_dir` 都原样保留，
OpenWrt 仍然对 openssl/python3 走 `clean-build`。可疑方向（均未验证）：

- `.config` 每次经 `make defconfig` 重建，`confvar` 算出的哈希变化，
  导致 `$(STAMP_CONFIGURED)` 名字变化、戳失效
- bind mount 上的 mtime 让 make 判定前置条件比产物新

**没有继续深挖。** 在搞清楚之前，别指望这一条。

#### 要做到 1~2 分钟，只剩一条路（**未验证**）

**预先烤好一个 Docker 镜像**：在 `/builder` 里已经是"openwrt 依赖全编译完"的状态，
推到 ghcr 复用。这样每次 CI 只剩下 `make package/*/compile`。
代价是要维护这个镜像、依赖变化时重建，而且它是几百 MB 到 GB 级。

#### 如果只想做最小改动

把 `gh-action-sdk` 换成自己的 `docker run`，**只加一个 `setup.sh` 的挂载**：

```yaml
- run: |
    printf '#!/bin/sh\nexit 0\n' > noop-setup.sh && chmod +x noop-setup.sh
    docker run --rm \
      -v "$PWD:/feed" -v "$PWD/bin:/artifacts" \
      -v "$PWD/noop-setup.sh:/builder/setup.sh" \
      -e FEEDNAME=twitchdropsminer \
      -e PACKAGES="twitch-drops-miner luci-app-twitchdropsminer" \
      -e NO_REFRESH_CHECK=1 -e NO_SHFMT_CHECK=1 -e V=s \
      ghcr.io/openwrt/sdk:${{ matrix.arch }}-${{ matrix.sdk }}
```

不碰应用代码、不碰 Makefile、不碰包内容，只改 workflow，**省约 5 分钟**。
（`-f setup.sh` 仍为真，但脚本内容是空操作，所以那 246MB 不会下。）

**另外两条实测结论也值得记下来**：
- **绝对不能用空目录挂 `/builder/staging_dir`**——镜像里 349 个预编译 host 工具会被盖掉，
  构建转去从零 host-compile `libffi`/`bzip2`/`ncurses`，然后失败。
- 容器最后一步是 `mv bin/ /artifacts/` 和 `mv logs/ /artifacts/`，
  跨 bind mount 会失败（`inter-device move failed`）。`/artifacts/logs` 需要先清空。

---

### 6.3 备案 B：把 `DEPENDS:=+python3` 收窄（**只为省设备空间**）

`python3` 是 meta 包，带 18 个依赖。实测**实际会被 import 的只有 10 个**
（`python3-base` / `-light` / `-codecs` / `-asyncio` / `-urllib` / `-logging` /
`-openssl` / `-lzma` / `-uuid`，加上可选去掉的 `-multiprocessing`），
**剩下 2.6 MiB 永远用不到**。

```make
# 现在
DEPENDS:=+python3
# 改成（示意，需按目标 SDK 的实际子包名核对）
DEPENDS:=+python3-light +python3-codecs +python3-asyncio +python3-urllib \
         +python3-logging +python3-openssl +python3-lzma +python3-uuid
```

**注意两点**：
- 这**不会明显缩短 CI 时间**——OpenWrt 的 `python3-*` 是同一份源码树的子包，
  编 CV 语言本体与否不由子包决定。它纯粹是省设备 flash。
- 收窄后**应用一旦新增 import 就可能运行期缺包**。要配套：
  改完在设备上跑一遍 `python3 -X importtime main.py` 之类，确认 `sys.modules`
  没碰到未安装的模块。

**风险**：中（可能引入运行期缺包）。**收益**：2.6 MiB。
**触发条件**：设备 flash 开始紧张时才做。

---

### 6.4 备案 C：清掉设备上的死重（**顺手的三个小改动**）

| 改动 | 省 | 风险 |
|---|---|---|
| 装包时跳过 `gui.py` / `cache.py` / `registry.py`（headless 永不导入，共 126 KiB） | 126 KiB | 低 |
| 去掉 `main.py:4` 的 `from multiprocessing import freeze_support`（PyInstaller 专用，OpenWrt 上无意义），连带去掉 `python3-multiprocessing` | 428 KiB | 低 |
| 首次运行生成的 `.pyc` 约 1.56 MiB（可考虑打包时预编译或接受） | — | — |

**触发条件**：和 B 一起做，或永远不做。

---

### 6.5 什么时候才值得认真考虑 Go 重写

- 你想摆脱对上游的依赖，自己做 Twitch 接口的逆向和维护；**或者**
- 目标设备换成 RAM/flash 真正紧张的机器（比如 64MB 内存的老路由器）；**或者**
- 你本来就想做一个独立项目，而不是维护一个 fork。

**如果只是为了「CI 别跑 20 分钟」——不值得。** 备案 A 就能解决，
而且不碰任何应用代码。

---

## 7. 还没验证的东西

### 已在本轮验证掉的

- [x] 官方 release SDK 镜像到底带不带 SDK → **带**，工具链 + 349 host 工具实测可用
- [x] `setup.sh` 为什么每次都跑 → 相对路径 `[ -f setup.sh ]` + WORKDIR=/builder
- [x] 空脚本顶掉 `setup.sh` 之后 entrypoint 剩余流程能否跑完 → **能**，
      246MB 不再下载，三轮都产出了三个 apk（字节数与 CI 一致）
- [x] 缓存 `staging_dir`/`build_dir` 能否跳过 CPython/openssl 编译 → **不能**（见 6.2）
- [x] 关掉 `CONFIG_AUTOREMOVE` 能否改善 → **不能**（见 6.2）
- [x] `actions/cache` 为什么失效 → 路径不存在；且它想缓的东西和真正贵的东西没关系
- [x] 设备上 Python 到底占多少 → 整条 meta 闭包 14.74 MiB，其中 2.6 MiB 用不到
- [x] 实际会被 import 的子包有哪些 → 10 个

### 还没验证

- [ ] **OpenWrt 为什么对 `staging_dir`/`build_dir` 已存在的包仍走 `clean-build`**
      （这是「把 20 分钟压到 1~2 分钟」的关键，本文卡在这里）
- [ ] 「预烤一个依赖已编译完的镜像」这条路的实际效果与维护成本
- [ ] `openssl` / 内核 kmod 这些到底是谁的依赖，逐条拆开
- [ ] 收窄 `DEPENDS` 会不会顺带缩短构建闭包（**预期不会**，`python3-*` 是同一份源码树）
- [ ] ucode 生态到底有没有能用的异步 HTTP + WebSocket 客户端栈
      （本文对 D 路线的判断基于印象，**没有实际查证** OpenWrt 25.12 的包索引）
- [ ] `cookies.jar` 里的 token 有效期与失效后的重新登录流程，在无 GUI 环境下的实际体验
- [ ] **`PKG_MIRROR_HASH` 跨环境不可复现的原因**（见 1.2，本地的值 `9bb8b035…`
      与 Makefile 里 CI 用的 `6a8be99b…` 对不上）
