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
PKG_SOURCE_VERSION:=f270afc3939b11f701b5e956a05a60203500e752
# sha256 of the tarball the build system generates from the above commit
# NOTE: regenerate when bumping PKG_SOURCE_VERSION -
# run `make package/twitch-drops-miner/check V=s` and copy the hash from the
# "PKG_MIRROR_HASH uses deprecated hash, set to ..." warning
PKG_MIRROR_HASH:=18ac604e87b0ceaad9450c4bd2cb27f0d72c5cfa903cbcc9f7a8601bf99108ce

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
