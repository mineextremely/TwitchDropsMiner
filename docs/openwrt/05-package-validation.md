# `twitch-drops-miner` 包布局验证（05）

> 2026-10-04，在真机（RK3566 / ImmortalWrt SNAPSHOT）上按 **包安装后的最终布局** 做了一次完整演练（不是直接跑源码）。
> 由于本地暂无 OpenWrt SDK，本次用 scp + 手工安装来模拟 `.apk` 的安装结果。

## 演练内容与结果

| 步骤 | 结果 |
|---|---|
| 1. 应用文件部署到 `/usr/lib/twitchdropsminer/`（`*.py` + `lang/`） | ✅ |
| 2. 9 个 musllinux 轮子解包到 `deps/`（模拟 `unzip -o` 安装步骤） | ✅ |
| 3. 安装 `/etc/init.d/twitchdropsminer` + `/etc/config/twitchdropsminer` | ✅ |
| 4. `uci set/add_list/commit` 配置（priority ×2、exclude ×1、priority_mode=2、connection_quality=2、proxy） | ✅ |
| 5. `/etc/init.d/twitchdropsminer start` → procd 拉起服务 | ✅ |
| 6. **UCI → settings.json → 应用读取** 往返验证 | ✅ 全部正确（见下） |
| 7. stdout → syslog（`logread` 可见完整应用输出） | ✅ |
| 8. procd 参数（command/env/respawn/exit_code） | ✅ 与预期一致 |

### 关键验证：UCI → settings.json 往返

```
priority: ['Fortnite', 'Apex Legends']         # 有序列表
exclude: ['Counter-Strike 2']                  # {"__type":"set"} 包装
priority_mode: PriorityMode.LOW_AVBL_FIRST     # {"__type":"PriorityMode","data":2}
proxy: 'http://127.0.0.1:7890'                 # {"__type":"URL"} 包装
connection_quality: 2
```

`settings.json` 由 init 脚本用 **jshn**（`/usr/share/libubox/jshn.sh`）生成，转义安全、无引号陷阱；每次服务启动重新生成，不存在 UCI 与 settings.json 漂移的问题。

### procd 实例（`ubus call service list`）

```json
{
  "command": ["/usr/bin/python3", "/usr/lib/twitchdropsminer/main.py", "--headless", "-v"],
  "env": {"PYTHONPATH": "/usr/lib/twitchdropsminer/deps",
          "TDM_DATA_DIR": "/mnt/mmcblk0p4/tdm/pkgdata"},
  "respawn": {"threshold": 3600, "timeout": 5, "retry": 5},
  "exit_code": 1
}
```

`respawn 3600 5 5`：快速失败 5 次后放弃——当前登录不可用（03 号文档）的情况下不会形成无限崩溃循环 ✅。

## 尚未验证的部分

- **`.apk` 打包本身**：需要与设备同源的 OpenWrt SDK（armsr/armv8, aarch64_generic, snapshot）。SDK 里跑一次 `make package/twitch-drops-miner/compile` 即可产出 `.apk`。
- 安装到只读的 squashfs 系统（本机 `/usr` 可写）——包安装路径本身不受影响。
- 服务随开机自启（`/etc/init.d/... enable`）——待正式包安装后验证。

## 包文件清单（仓库内）

```
twitch-drops-miner/
├── Makefile                     # 包定义；从 GitHub 拉源码 + 解包 vendored 轮子
├── fetch-wheels.sh              # 重新生成 files/wheels/（标记目标 python 版本与平台）
├── files/
│   ├── twitchdropsminer.init    # procd 服务 + jshn 生成 settings.json
│   ├── twitchdropsminer.config  # UCI 默认值
│   └── wheels/*.whl             # 9 个 musllinux_aarch64 轮子（aiohttp 及依赖，~2.7MB）
```
