#!/usr/bin/env bash
# Downloads the word lists used by the bot into data/.
#   answers.txt : secret-word pool. The full list of words the NYT Wordle accepts (~14.8k).
#   allowed.txt : extra valid guesses. Every 5-letter word from the dwyl English word list (~15.9k).
# The bot accepts guesses from the union of both files.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/data"

norm() { tr -d '\r' | tr 'A-Z' 'a-z' | grep -E '^[a-z]{5}$' | sort -u; }

echo "Fetching NYT accepted list (tabatkins/wordle-list)…"
curl -fsSL https://raw.githubusercontent.com/tabatkins/wordle-list/main/words | norm > "$ROOT/data/answers.txt"

echo "Fetching dwyl english-words…"
curl -fsSL https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt | norm > "$ROOT/data/allowed.txt"

echo "answers.txt: $(wc -l < "$ROOT/data/answers.txt") words"
echo "allowed.txt: $(wc -l < "$ROOT/data/allowed.txt") words"
