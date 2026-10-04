# 真机验证记录（04）

> 2026-10-04，在目标设备（RK3566 / ImmortalWrt SNAPSHOT / aarch64_generic，2GB RAM）上验证 headless 核心。

## 验证结果（提交 `4dcaeb8` + webopen 修复）

| 项目 | 结果 |
|---|---|
| 代码部署 | GitHub 分支 tarball 下载到 `/mnt/mmcblk0p4/tdm/app`（BusyBox tar 不支持 `--strip-components`，需两步解包） |
| Python | **3.14.5**（feed 提供，`apk add python3 python3-pip`） |
| 依赖 | `pip install --target /mnt/mmcblk0p4/tdm/deps aiohttp` → aiohttp 3.14.3 + 8 个依赖，**cp314 musllinux aarch64 轮子，无需编译**，共 10.7 MB |
| import 链 | `aiohttp, translate, constants, utils, headless, twitch` 全部通过（**无 tkinter/PIL**） |
| 内存 | import 完成后 max RSS **39.3 MB** |
| 运行 | 启动 → 进入登录流程 → 清晰的 `LoginException: invalid client`（见 03 号文档）→ **退出码 1**，进程干净退出 |
| 数据目录 | `TDM_DATA_DIR=/mnt/mmcblk0p4/tdm/data` 下正确生成 cookies.jar / settings.json / lock.file / log.txt |

## 真机发现（影响打包方案）

1. **feed 缺失 aiohttp 依赖链**：`python3-aiohttp`、`python3-yarl`、`python3-multidict`、`python3-frozenlist`、`python3-aiosignal`、`python3-propcache`、`python3-charset-normalizer` 在当前 snapshot feed 中**均不存在**（上游打包缺口，参见 openwrt/openwrt#22342）。`python3-attrs`、`python3-idna`、`python3-async-timeout` 有。
   → **apk 包不能简单 `DEPENDS:=+python3-aiohttp`**。
2. **`webbrowser` 模块 OpenWrt 未打包**：已把 `utils.webopen()` 改为惰性导入 + 优雅降级（headless 不打开浏览器，无影响）。
3. 其余所需标准库模块齐全（gzip/email/ssl/zlib/ctypes/sqlite3/multiprocessing/secrets/hashlib 等）。
4. Python 版本比预期新（3.14.5），代码在 3.10–3.14 全区间可用。
5. kmods feed 路径指向 6.18.52 内核（与实际运行的 6.1.174-rk35xx-ophub 不匹配）——与本次无关，但提醒：不要依赖 feed 的 kmod 包。

## 对 `twitch-drops-miner` 包的设计影响

依赖获取的两条路线：

- **方案 A（建议先做）**：把依赖 wheel 以 vendored 形式随包安装——构建时 `pip install --target` 到包内 `deps/`，安装到 `/usr/lib/twitchdropsminer/deps`，启动脚本设 `PYTHONPATH`。简单、离线可复现、不受 feed 缺口影响；代价是绕过 apk 依赖管理（这些库是应用私有的，可接受）。
- **方案 B（更正统，后续可选）**：用与设备同源的 OpenWrt SDK 自行构建 `python3-aiohttp` 等 apk 包放进自己的 feed。工作量大，且需随 SNAPSHOT 滚动跟进。

当前路由器上的验证环境是临时的：`python3-pip` 与 `/mnt/mmcblk0p4/tdm/deps` 均为测试用途，正式部署应由 apk 包提供依赖。
