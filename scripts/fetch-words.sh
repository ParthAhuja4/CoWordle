#!/usr/bin/env bash
# Downloads the word lists used by the bot into data/.
#   answers.txt : secret-word pool. The curated original Wordle answer list (~2.3k everyday words),
#                 so secrets are guessable by normal people rather than dictionary trivia.
#   allowed.txt : extra valid guesses. The full NYT accepted list (~14.8k) plus every 5-letter word
#                 from the dwyl English word list (~15.9k).
#   poople-allowed.txt : Poople steps. Every 4-letter word in the ENABLE word-game list (~3.9k).
#   poople-starts.txt  : Poople start words. 4-letter words from Google's 10k most common English
#                        words (no swears) that are also in ENABLE (~0.9k).
# The bot accepts guesses from the union of both files.
# A failed or empty download keeps the committed file, so a deploy never ends up with an empty list.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/data"

# Word length for norm(); `LEN=4 install …` switches a single list to 4-letter words.
LEN=5
norm() { tr -d '\r' | tr 'A-Z' 'a-z' | grep -E "^[a-z]{$LEN}\$" | sort -u; }

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

ENABLE=https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt
COMMON=https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-usa-no-swears.txt

LEN=4 install "$ROOT/data/poople-allowed.txt" "ENABLE 4-letter words" "$ENABLE"

# Start words must also be valid steps, so keep only the common words that ENABLE accepts.
starts="$(LEN=4 fetch "common English words" "$COMMON")"
if [ -n "$starts" ]; then
  comm -12 <(printf '%s\n' "$starts") "$ROOT/data/poople-allowed.txt" > "$ROOT/data/poople-starts.txt"
else
  echo "Keeping existing poople-starts.txt" >&2
  [ -s "$ROOT/data/poople-starts.txt" ] || { echo "ERROR: poople-starts.txt is missing and could not be downloaded" >&2; exit 1; }
fi

echo "answers.txt: $(wc -l < "$ROOT/data/answers.txt") words"
echo "allowed.txt: $(wc -l < "$ROOT/data/allowed.txt") words"
echo "poople-allowed.txt: $(wc -l < "$ROOT/data/poople-allowed.txt") words"
echo "poople-starts.txt: $(wc -l < "$ROOT/data/poople-starts.txt") words"
