#!/usr/bin/env bash
set -euo pipefail

options=("CLI (Terminal UI)" "Web UI (Browser)")
selected=0

stty_save=$(stty -g 2>/dev/null || true)
cleanup() {
  stty "$stty_save" 2>/dev/null || true
  printf '\e[?25h\e[2J\e[H' 2>/dev/null || true
}
trap cleanup EXIT INT TERM

stty -echo -icanon 2>/dev/null || true
printf '\e[?25l' 2>/dev/null || true

draw_menu() {
  printf '\e[H\e[J'
  printf '\n  Cody Pro Launcher\n\n'
  for i in "${!options[@]}"; do
    if [ "$i" -eq "$selected" ]; then
      printf '  > %s\n' "${options[$i]}"
    else
      printf '    %s\n' "${options[$i]}"
    fi
  done
  printf '\n  (\xe2\x86\x91/\xe2\x86\x93 to move, Enter to select)\n'
}

draw_menu

while true; do
  IFS= read -s -r -n1 key
  if [ "$key" = $'\e' ]; then
    IFS= read -s -r -n1 -t 0.05 next1 2>/dev/null || next1=""
    if [ "$next1" = "[" ]; then
      IFS= read -s -r -n1 -t 0.05 next2 2>/dev/null || next2=""
      case "$next2" in
        A) selected=$(( (selected - 1 + ${#options[@]}) % ${#options[@]} )) ;;
        B) selected=$(( (selected + 1) % ${#options[@]} )) ;;
      esac
    else
      exit 255
    fi
  elif [ -z "$key" ]; then
    exit "$selected"
  fi
  draw_menu
done
