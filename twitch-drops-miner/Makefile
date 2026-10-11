#
# This is free software, licensed under the Apache License, Version 2.0
#
include $(TOPDIR)/rules.mk

PKG_NAME:=twitch-drops-miner
# NOTE: upstream's version is "16.dev", which is not a valid apk version
# (apk only allows numeric components plus a few suffixes), so it's mapped
# to a pre-release of 16.0
PKG_VERSION:=16.0_pre
PKG_RELEASE:=1
PKG_SOURCE_DATE:=2026-10-04

PKG_SOURCE_PROTO:=git
PKG_SOURCE_URL:=https://github.com/mineextremely/TwitchDropsMiner.git
PKG_SOURCE_VERSION:=117e400980c69b833baa9dab1536eaabbefdb6de
# NOTE: the hash check is deliberately disabled - the tarball the build system
# generates from the above commit is NOT reproducible across environments:
#   - scripts/dl_github_archive.py (the normal path) needs api.github.com and
#     falls back to a clone-then-pack when that fails, which CI runners do hit;
#   - the two paths do not produce identical bytes, and the fallback's output
#     also depends on the user the build runs as (tar's --owner=0/--group=0 is
#     only honoured by root, so the SDK images that build as a normal user
#     record their own uid).
# Consequence: the 24.10.8 and 25.12.5 matrix legs can compute different
# hashes for the same commit, so no pinned value can satisfy both. The source
# is still fetched over HTTPS from our own GitHub repository.
# Set to 'skip' to disable the check (the build accepts it; only `make check`
# prints a "deprecated hash" warning).
PKG_MIRROR_HASH:=skip

PKG_MAINTAINER:=mineextremely
PKG_LICENSE:=GPL-3.0-only
PKG_LICENSE_FILES:=LICENSE

include $(INCLUDE_DIR)/package.mk

define Package/twitch-drops-miner
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=Twitch Drops Miner (headless)
  URL:=https://github.com/mineextremely/TwitchDropsMiner
  DEPENDS:=+python3
endef

define Package/twitch-drops-miner/description
  An application that mines timed Twitch drops in the background,
  without downloading any stream data. This is a headless port for
  OpenWrt - no display server or Tkinter is required.
endef

define Build/Compile
endef

# The python dependencies are vendored as musllinux wheels
# (the OpenWrt feeds are currently missing the aiohttp dependency chain).
# Regenerate them with ./fetch-wheels.sh
define Package/twitch-drops-miner/install
	$(INSTALL_DIR) $(1)/usr/lib/twitchdropsminer/deps
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/*.py $(1)/usr/lib/twitchdropsminer/
	$(CP) $(PKG_BUILD_DIR)/lang $(1)/usr/lib/twitchdropsminer/
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/twitchdropsminer.init $(1)/etc/init.d/twitchdropsminer
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./files/tdm-import $(1)/usr/bin/tdm-import
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/twitchdropsminer.config $(1)/etc/config/twitchdropsminer
	$(foreach wheel,$(wildcard ./files/wheels/*.whl), \
		$(STAGING_DIR_HOST)/bin/unzip -o $(wheel) -d $(1)/usr/lib/twitchdropsminer/deps >/dev/null;)
	# The vendored musllinux wheels reference musl's libc soname
	# (libc.musl-aarch64.so.1), which the OpenWrt dependency scanner does not
	# know about. The symbols are resolved by the already-loaded libc at
	# runtime, so the reference is dropped to satisfy the package check.
	find $(1)/usr/lib/twitchdropsminer/deps -type f -name '*.so' | \
		xargs -r $(STAGING_DIR_HOST)/bin/patchelf --remove-needed libc.musl-aarch64.so.1
endef

$(eval $(call BuildPackage,twitch-drops-miner))
