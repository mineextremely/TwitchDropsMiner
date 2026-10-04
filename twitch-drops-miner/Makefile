#
# This is free software, licensed under the Apache License, Version 2.0
#
include $(TOPDIR)/rules.mk

PKG_NAME:=twitch-drops-miner
PKG_VERSION:=16.dev
PKG_RELEASE:=1
PKG_SOURCE_DATE:=2026-10-04

PKG_SOURCE_PROTO:=git
PKG_SOURCE_URL:=https://github.com/mineextremely/TwitchDropsMiner.git
PKG_SOURCE_VERSION:=2cdf9f38723d3cc0af9ee35f29d5329ed0f2ef31
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
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/twitchdropsminer.config $(1)/etc/config/twitchdropsminer
	$(foreach wheel,$(wildcard ./files/wheels/*.whl), \
		$(STAGING_DIR_HOST)/bin/unzip -o $(wheel) -d $(1)/usr/lib/twitchdropsminer/deps >/dev/null;)
endef

$(eval $(call BuildPackage,twitch-drops-miner))
