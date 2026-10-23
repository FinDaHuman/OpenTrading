#!/usr/bin/env bash
# OpenTrading installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/FinDaHuman/OpenTrading/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/FinDaHuman/OpenTrading/main/install.sh | bash -s -- --version 0.2.0
#
# Options:
#   -v, --version <v>    install that release instead of the latest   (OPENTRADING_VERSION)
#   -d, --dir <dir>      where opentrading and ot go                  (OPENTRADING_INSTALL_DIR)
#                        default: ~/.opentrading/bin
#   -b, --binary <file>  install a local opentrading binary instead of downloading
#       --no-modify-path do not touch shell startup files
#       --uninstall      remove opentrading, ot and the PATH lines (keeps ~/.opentrading data)
#   -h, --help

set -euo pipefail

REPO="FinDaHuman/OpenTrading"
MARK="# added by the OpenTrading installer"
version="${OPENTRADING_VERSION:-}"
dir="${OPENTRADING_INSTALL_DIR:-$HOME/.opentrading/bin}"
binary=""
modify_path=true
uninstall=false

fail() { printf '\033[31merror: %s\033[0m\n' "$*" >&2; exit 1; }
step() { printf '\033[2m%s\033[0m\n' "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    -v|--version) version="${2:?--version needs a value}"; shift 2 ;;
    -d|--dir) dir="${2:?--dir needs a value}"; shift 2 ;;
    -b|--binary) binary="${2:?--binary needs a file}"; shift 2 ;;
    --no-modify-path) modify_path=false; shift ;;
    --uninstall) uninstall=true; shift ;;
    -h|--help) sed -n '2,15p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "unknown option $1 (see --help)" ;;
  esac
done

mkdir -p "$dir"
dir=$(cd "$dir" && pwd)

# Shell startup files that may carry our PATH line.
rc_files() {
  local zdot="${ZDOTDIR:-$HOME}"
  printf '%s\n' "$zdot/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" "${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"
}

remove_path_lines() {
  local file
  while IFS= read -r file; do
    [ -f "$file" ] && grep -qF "$MARK" "$file" || continue
    # The marked line and the line after it (the PATH line itself).
    awk -v mark="$MARK" '$0 == mark { skip = 2 } skip > 0 { skip--; next } { print }' "$file" > "$file.ot-tmp" && cat "$file.ot-tmp" > "$file" && rm -f "$file.ot-tmp"
    step "removed the PATH line from $file"
  done < <(rc_files)
}

if [ "$uninstall" = true ]; then
  rm -f "$dir/opentrading" "$dir/ot"
  remove_path_lines
  printf '\033[32mOpenTrading removed from %s. Your data in %s was kept (delete it yourself if you want).\033[0m\n' "$dir" "${OPENTRADING_HOME:-$HOME/.opentrading}"
  exit 0
fi

target() {
  local os arch
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    MINGW*|MSYS*|CYGWIN*) fail "on Windows use install.ps1 (see the README)" ;;
    *) fail "unsupported system $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) fail "unsupported CPU $(uname -m) (OpenTrading ships x64 and arm64)" ;;
  esac
  # An x64 shell under Rosetta on Apple silicon: the native build is the right one.
  if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
    arch=arm64
  fi
  if [ "$os" = linux ] && { [ -f /etc/alpine-release ] || ldd --version 2>&1 | grep -qi musl; }; then
    fail "musl-based Linux (Alpine) is not supported yet"
  fi
  local name="$os-$arch"
  if [ "$arch" = x64 ]; then
    local avx2=0
    if [ "$os" = linux ]; then
      grep -qwi avx2 /proc/cpuinfo 2>/dev/null && avx2=1
    else
      [ "$(sysctl -n hw.optional.avx2_0 2>/dev/null || echo 0)" = 1 ] && avx2=1
    fi
    [ "$avx2" = 1 ] || name="$name-baseline"
  fi
  printf '%s' "$name"
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

download() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -q "$1" -O "$2"
  else fail "curl or wget is needed"
  fi
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [ -n "$binary" ]; then
  [ -f "$binary" ] || fail "no file at $binary"
  cp "$binary" "$work/opentrading"
else
  name=$(target)
  if [ "${name%%-*}" = linux ]; then asset="opentrading-$name.tar.gz"; else asset="opentrading-$name.zip"; fi
  version="${version#v}"
  if [ -n "$version" ]; then base="https://github.com/$REPO/releases/download/v$version"; else base="https://github.com/$REPO/releases/latest/download"; fi
  # Tests point this at a local server holding the archives and SHA256SUMS.
  base="${OPENTRADING_RELEASE_BASE:-$base}"
  step "downloading $asset (${version:-latest})"
  download "$base/$asset" "$work/$asset" || fail "download failed from $base. Check the version at https://github.com/$REPO/releases"
  download "$base/SHA256SUMS" "$work/SHA256SUMS" || fail "could not download SHA256SUMS from $base"
  expected=$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1; exit }' "$work/SHA256SUMS")
  [ -n "$expected" ] || fail "SHA256SUMS has no entry for $asset"
  actual=$(sha256 "$work/$asset")
  [ "$expected" = "$actual" ] || fail "checksum mismatch for $asset (expected $expected, got $actual)"
  mkdir -p "$work/x"
  case "$asset" in
    *.tar.gz) tar -xzf "$work/$asset" -C "$work/x" ;;
    *) command -v unzip >/dev/null 2>&1 || fail "unzip is needed"; unzip -q "$work/$asset" -d "$work/x" ;;
  esac
  [ -f "$work/x/opentrading" ] || fail "$asset holds no opentrading binary"
  mv "$work/x/opentrading" "$work/opentrading"
fi

chmod 755 "$work/opentrading"
# Same folder as the target, then rename: a running opentrading keeps its old file.
cp "$work/opentrading" "$dir/.opentrading.new"
mv -f "$dir/.opentrading.new" "$dir/opentrading"
ln -sf opentrading "$dir/ot"

installed=$("$dir/opentrading" --version | head -n 1) || fail "$dir/opentrading does not start"

if [ "$modify_path" = true ]; then
  [ -n "${GITHUB_PATH:-}" ] && printf '%s\n' "$dir" >> "$GITHUB_PATH"
  case ":$PATH:" in
    *":$dir:"*) ;;
    *)
      shell_name=$(basename "${SHELL:-sh}")
      case "$shell_name" in
        zsh) rc="${ZDOTDIR:-$HOME}/.zshrc"; line="export PATH=\"$dir:\$PATH\"" ;;
        bash) if [ "$(uname -s)" = Darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi; line="export PATH=\"$dir:\$PATH\"" ;;
        fish) rc="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"; line="fish_add_path \"$dir\"" ;;
        *) rc="$HOME/.profile"; line="export PATH=\"$dir:\$PATH\"" ;;
      esac
      if ! { [ -f "$rc" ] && grep -qF "$MARK" "$rc"; }; then
        mkdir -p "$(dirname "$rc")"
        printf '\n%s\n%s\n' "$MARK" "$line" >> "$rc"
        step "added $dir to PATH in $rc"
      fi
      ;;
  esac
fi

# An older `bun run install:global` launcher (~/.local/bin/ot) earlier on PATH would win.
current=$(command -v ot 2>/dev/null || true)
if [ -n "$current" ] && [ "$current" != "$dir/ot" ]; then
  printf "\033[33mnote: 'ot' currently runs %s. Remove it (in the repo: bun run uninstall:global) or put %s first on PATH.\033[0m\n" "$current" "$dir"
fi

printf '\n\033[32m%s installed to %s\033[0m\n' "$installed" "$dir"
echo "Open a new terminal and run:  ot        (or: opentrading)"
echo "Update later with:            ot update"
