#!/bin/sh
#
# Regenerate the vendored python dependency wheels.
#
# The OpenWrt feeds are currently missing the aiohttp dependency chain
# (python3-aiohttp, python3-yarl, python3-multidict, python3-frozenlist,
# python3-aiosignal, python3-propcache), so the dependencies are vendored
# here as prebuilt musllinux aarch64 wheels instead.
#
# NOTE: run this on any machine with a recent pip (network access required).
# Adjust PYTHON_VERSION when the target OpenWrt python version changes.
#
set -e

DIR="$(cd "$(dirname "$0")" && pwd)/files/wheels"
PYTHON_VERSION="${PYTHON_VERSION:-3.14}"
PLATFORM="${PLATFORM:-musllinux_1_2_aarch64}"

mkdir -p "$DIR"
rm -f "$DIR"/*.whl

python3 -m pip download \
	--only-binary=:all: \
	--platform "$PLATFORM" \
	--python-version "$PYTHON_VERSION" \
	--implementation cp \
	--no-cache-dir \
	--dest "$DIR" \
	aiohttp

echo
echo "Wheels in $DIR:"
ls -la "$DIR"
