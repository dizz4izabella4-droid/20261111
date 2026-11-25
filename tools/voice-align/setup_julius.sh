#!/bin/sh
# Build Julius and fetch the segmentation-kit acoustic model into
# tools/voice-align/.build (git-ignored). Needs git, a C compiler, make.
# Tested on macOS 26 arm64 (Apple clang). Network is used only here.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
B="$HERE/.build"
JULIUS_REV=1604011abafa2751181767f785e9aa4740743c65
SEGKIT_REV=e0e8bbaf98e27d19dfc6fe8312be607ad03592ad
mkdir -p "$B"
cd "$B"
[ -d julius ] || git clone -q https://github.com/julius-speech/julius.git
[ -d segmentation-kit ] || git clone -q https://github.com/julius-speech/segmentation-kit.git
git -C julius checkout -q "$JULIUS_REV"
git -C segmentation-kit checkout -q "$SEGKIT_REV"
cd julius
# 1) Apple Silicon: the CPU check only knows __arm__, so it falls into x86 cpuid code.
sed -i.bak 's/#if defined(__arm__) || TARGET_OS_IPHONE/#if defined(__arm__) || defined(__aarch64__) || defined(__arm64__) || TARGET_OS_IPHONE/' libsent/src/phmm/calc_dnn.c
# 2) Allow inputs up to 200 s (default limit is 20 s at 16 kHz).
sed -i.bak 's/#define MAXSPEECHLEN  320000/#define MAXSPEECHLEN  3200000/' libsent/include/sent/speech.h
CFLAGS="-O2 -Wno-implicit-function-declaration -Wno-implicit-int -Wno-int-conversion -Wno-incompatible-pointer-types" \
  ./configure --enable-words-int >/dev/null
make -j4 >/dev/null
ls -la julius/julius
echo "OK: $B/julius/julius/julius"
echo "model: $B/segmentation-kit/models/hmmdefs_monof_mix16_gid.binhmm"
