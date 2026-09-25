#!/usr/bin/env bash
# Downloads the word lists used by the bot into data/.
#   answers.txt : secret-word pool. The curated original Wordle answer list (~2.3k everyday words),
#                 so secrets are guessable by normal people rather than dictionary trivia.
#   allowed.txt : extra valid guesses. The full NYT accepted list (~14.8k) plus every 5-letter word
#                 from the dwyl English word list (~15.9k).
# The bot accepts guesses from the union of both files.
# A failed or empty download keeps the committed file, so a deploy never ends up with an empty list.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/data"

norm() { tr -d '\r' | tr 'A-Z' 'a-z' | grep -E '^[a-z]{5}$' | sort -u; }

# fetch <label> <url>... → prints the normalised union of all URLs, or nothing on failure.
fetch() {
  local label=$1; shift
  local tmp
  tmp="$(mktemp)"
  for url in "$@"; do
    echo "Fetching $label ($url)…" >&2
    curl -fsSL "$url" >> "$tmp" || { echo "  download failed" >&2; rm -f "$tmp"; return 1; }
    echo >> "$tmp"
  done
  norm < "$tmp"
  rm -f "$tmp"
}

install() {
  local target=$1; shift
  local out
  out="$(fetch "$@")"
  if [ -n "$out" ]; then
    printf '%s\n' "$out" > "$target"
  else
    echo "Keeping existing $(basename "$target")" >&2
    [ -s "$target" ] || { echo "ERROR: $target is missing and could not be downloaded" >&2; exit 1; }
  fi
}

install "$ROOT/data/answers.txt" "curated Wordle answers" \
  https://gist.githubusercontent.com/cfreshman/a03ef2cba789d8cf00c08f767e0fad7b/raw/wordle-answers-alphabetical.txt

install "$ROOT/data/allowed.txt" "NYT accepted list + dwyl english-words" \
  https://raw.githubusercontent.com/tabatkins/wordle-list/main/words \
  https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt

echo "answers.txt: $(wc -l < "$ROOT/data/answers.txt") words"
echo "allowed.txt: $(wc -l < "$ROOT/data/allowed.txt") words"
