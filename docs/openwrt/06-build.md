# 三个 apk 包的构建（06）

> 目标产物：`twitch-drops-miner`、`luci-app-twitchdropsminer`、`luci-i18n-twitchdropsminer-zh-cn`
> （第三个由 `luci.mk` 从 `luci-app-twitchdropsminer/po/zh_Hans/twitchdropsminer.po` 自动生成）

## 云构建（主路径，参考 EasyTier 的做法）

`.github/workflows/openwrt.yml` 使用 [`openwrt/gh-action-sdk`](https://github.com/openwrt/gh-action-sdk)：

- 矩阵：`aarch64_generic` × SDK `25.12.3`（apk）与 `24.10.6`（opkg）
- `PACKAGES: twitch-drops-miner luci-app-twitchdropsminer`
- 产物：`bin/packages/<arch>/twitchdropsminer/*`（含自动生成的 `luci-i18n-twitchdropsminer-zh-cn`）
- 触发方式：推送到 `openwrt` 分支（仅当包相关文件变化）或手动 `workflow_dispatch`
- 手动触发时可填 `tag` 输入，会把产物发布为 prerelease

**前置条件（一次性）**：fork 的仓库默认禁用 Actions，需要到
`Settings → Actions → General → Allow all actions` 打开，之后推送或手动触发即可。

## 本地构建（备选）

任何有 Docker 的机器都可以用官方 SDK 镜像构建，流程与 CI 相同：

```sh
# 以 aarch64_generic / 25.12.3 为例（镜像标签以 openwrt/sdk 官方为准）
docker run --rm -it -v "$PWD:/feed" openwrt/sdk:aarch64_generic-25.12.3 bash
# 容器内：
cd /feed
./scripts/feeds update -a && ./scripts/feeds install -a -p luci
echo "src-link twitchdropsminer /feed" >> feeds.conf.default
./scripts/feeds update -a && ./scripts/feeds install -a -p twitchdropsminer
make package/twitch-drops-miner/compile V=s
make package/luci-app-twitchdropsminer/compile V=s
ls bin/packages/aarch64_generic/twitchdropsminer/
```

> 注：包的 `PKG_SOURCE` 指向本项目仓库的固定提交，SDK 需要能访问 GitHub；
> vendored 轮子已经在仓库里（`twitch-drops-miner/files/wheels/`），不需要网络下载依赖。

## 打包时踩过的坑（已修复，勿回退）

1. **`PKG_MIRROR_HASH` 必须是真实哈希**（不能写 `skip`）：OpenWrt 会把 git checkout 打成确定性 tarball 并校验；写 `skip` 会在 check 阶段报 `Package HASH check failed`。
2. **apk 版本号格式有约束**：`16.dev`（上游 version.py 的值）不是合法 apk 版本（点号后必须跟数字），会报
   `ERROR: info field 'version' has invalid value`。已映射为 `16.0_pre`。合法后缀实测：`_pre`/`_git`/`_beta1`/`-rN`；非法：`_dev`、`~dev`。
3. **vendored 轮子的 `libc.musl-aarch64.so.1` 依赖**：musllinux 轮子的 `.so` 带这个 soname，OpenWrt 的依赖扫描器不认识 → `Package twitch-drops-miner is missing dependencies`。
   已在安装步骤用 SDK 自带的 `patchelf --remove-needed` 去掉（运行时符号由已加载的 libc 解析，实测正常）。

### ⚠️ 更新 PKG_SOURCE_VERSION 时必做

`twitch-drops-miner` 使用 git 源，OpenWrt 会把 checkout 打成确定性 tarball 并校验
`PKG_MIRROR_HASH`。升级固定提交后哈希会变，必须重新生成：

```sh
make package/twitch-drops-miner/check V=s   # 从 "set to <sha256>" 警告里取值
```

然后更新 `twitch-drops-miner/Makefile` 里的 `PKG_MIRROR_HASH`，否则构建会以
`Package HASH check failed` 失败（实测 24.10.6 与 25.12.3 两个 SDK 产出的哈希一致，
跨版本稳定）。

## 三包一览

| 包 | 来源 | 内容 |
|---|---|---|
| `twitch-drops-miner` | `twitch-drops-miner/` | app 源码 + `lang/` + vendored 依赖 + procd init + UCI 配置 |
| `luci-app-twitchdropsminer` | `luci-app-twitchdropsminer/` | LuCI 页面（`htdocs/`）、菜单、ACL、uci-defaults |
| `luci-i18n-twitchdropsminer-zh-cn` | 同上（`po/zh_Hans/`） | `luci.mk` 自动生成，安装后把 LuCI 语言切到简体中文 |

## 设备侧安装（验证用）

```sh
apk add --allow-untrusted ./twitch-drops-miner-*.apk ./luci-app-twitchdropsminer-*.apk ./luci-i18n-twitchdropsminer-zh-cn-*.apk
/etc/init.d/twitchdropsminer enable
/etc/init.d/twitchdropsminer start
```

（本机为 SNAPSHOT 固件，若包签名校验失败可加 `--allow-untrusted`。）
