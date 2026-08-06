#!/usr/bin/env bash
# setup-repo.sh
#
# Postavlja ovaj folder kao git repozitorij i (ako je gh CLI dostupan i
# prijavljen) kreira ga na GitHubu i pusha. Pokreni ovo unutar Claude Code,
# iz ovog foldera (archifest-plan/), naredbom:
#
#   bash setup-repo.sh
#
# ili jednostavno reci Claude Code-u: "pokreni setup-repo.sh i postavi repo"

set -euo pipefail

REPO_NAME="archifest-plan"
VISIBILITY="private"   # promijeni u "public" ako želiš javan repo

echo "== ARCHIFEST Plan — postavljanje repozitorija =="

# 1. Git init (ako još nije repo)
if [ ! -d .git ]; then
  git init
  echo "Git repozitorij inicijaliziran."
else
  echo "Git repozitorij već postoji, preskačem init."
fi

# 2. Postavi granu na main (noviji standard)
git branch -M main 2>/dev/null || true

# 3. Dodaj i commitaj sve fajlove
git add .
if git diff --cached --quiet; then
  echo "Nema promjena za commit."
else
  git commit -m "Initial commit — ARCHIFEST Plan"
  echo "Commit napravljen."
fi

# 4. Ako je GitHub CLI (gh) dostupan i prijavljen, kreiraj repo na GitHubu i pushaj
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    if gh repo view "$REPO_NAME" >/dev/null 2>&1; then
      echo "Repozitorij '$REPO_NAME' već postoji na GitHubu — samo pusham."
      git remote add origin "$(gh repo view "$REPO_NAME" --json url -q .url).git" 2>/dev/null || true
      git push -u origin main
    else
      echo "Kreiram novi $VISIBILITY repozitorij '$REPO_NAME' na GitHubu..."
      gh repo create "$REPO_NAME" --"$VISIBILITY" --source=. --remote=origin --push
    fi
    echo
    echo "Gotovo. Link do repozitorija:"
    gh repo view --json url -q .url
  else
    echo "GitHub CLI (gh) je instaliran ali nisi prijavljen."
    echo "Pokreni: gh auth login"
    echo "Zatim ponovno pokreni ovu skriptu."
  fi
else
  echo "GitHub CLI (gh) nije instaliran/dostupan u ovom okruženju."
  echo
  echo "Ručni koraci za push na GitHub:"
  echo "  1. Napravi novi repozitorij na github.com (naziv: $REPO_NAME)"
  echo "  2. Zatim pokreni:"
  echo "     git remote add origin https://github.com/TVOJ-USERNAME/$REPO_NAME.git"
  echo "     git push -u origin main"
fi

echo
echo "== Za GitHub Pages (dijeljivi link) =="
echo "Settings -> Pages -> Source: 'Deploy from a branch' -> Branch: main, folder: / (root) -> Save"
