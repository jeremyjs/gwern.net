#!/bin/bash

# upload: convenience script for uploading PDFs, images, and other files to gwern.net.
# Author: Gwern Branwen
# Date: 2021-01-01
# When:  Time-stamp: "2023-05-10 11:21:58 gwern"
# License: CC-0
#
# This will reformat, run PDFs through `ocrmypdf` (via the `compressPdf` wrapper), and `git commit` new files.
# Example command: `$ upload benter1994.pdf statistics/decision` will upload a compressed, OCRed <https://gwern.net/doc/statistics/decision/1994-benter.pdf>.
# It will also try to guess the full document directory from a short tag, so `$ upload benter1994.pdf decision` works just as well.
# If no tag is provided, it is assumed this is a temporary or scratch file, and it's uploaded to an unindexed dump directory that is periodically deleted.

. ~/wiki/static/build/bash.sh

set -e

WWW_BROWSER="firefox"

if [ ! -f "$1" ]; then echo "l18: '$1' is not a file‽" && exit 1; fi

(locate "$1" &)

function check_duplicate_file() {
  local filename="$1"
  local file_path

  # Find all files in ~/wiki/ and its subdirectories with the same filename
  file_path=$(find ~/wiki/ -type f -name "$filename" -print -quit)

  # If a file with the same name exists, exit with an error
  if [[ -n "$file_path" ]]; then
    echo "Error: File '$filename' already exists at '$file_path'" >&2
    return 1
  fi

  return 0
}
check_duplicate_file "$1";

if [ $# -eq 1 ]; then
    TARGET=$(basename "$1")
    if [[ "$TARGET" =~ .*\.jpg || "$TARGET" =~ .*\.png ]]; then exiftool -overwrite_original -All="" "$TARGET"; fi # strip potentially dangerous metadata from scrap images
    # format Markdown/text files for more readability
    TEMPFILE=$(mktemp /tmp/text.XXXXX)
    if [[ "$TARGET" =~ .*\.page || "$TARGET" =~ .*\.txt ]]; then fold --spaces --width=120 "$TARGET" >> "$TEMPFILE" && mv "$TEMPFILE" "$TARGET"; fi

    mv "$TARGET" ~/wiki/doc/www/misc/
    cd ~/wiki/ || exit
    TARGET2="./doc/www/misc/$TARGET"
    (rsync --chmod='a+r' -q "$TARGET2" gwern@176.9.41.242:"/home/gwern/gwern.net/doc/www/misc/" || \
        rsync --chmod='a+r' -v "$TARGET2" gwern@176.9.41.242:"/home/gwern/gwern.net/doc/www/misc/"
    URL="https://gwern.net/doc/www/misc/$TARGET"
    echo "$URL" && $WWW_BROWSER "$URL") &

else
    TARGET_DIR=""
    TARGET_DIR=doc/"$2"

    if [ ! -d ~/wiki/"$TARGET_DIR"  ]; then
        # try to guess a target:
        GUESS=$(cd ~/wiki/ && ./static/build/guessTag "$2")
        if [ ! -d ~/wiki/doc/"$GUESS"/ ]; then
            # the guess failed too, so bail out entirely:
            ls ~/wiki/"$TARGET_DIR" ~/wiki/doc/"$GUESS"/
            echo "$1; Directory $TARGET_DIR $2 (and fallback guess $GUESS) does not exist?"
            return 2
        else
            # restart with fixed directory
            echo "Retry as \"upload $1 $GUESS\""
            upload "$1" "$GUESS"
        fi
    else
        if [ -a "$1" ]; then
            ## automatically rename a file like 'benter1994.pdf' (Libgen) to '1994-benter.pdf' (gwern.net):
            FILE="$1"
            if [[ "$FILE" =~ ([a-zA-Z]+)([0-9][0-9][0-9][0-9])\.pdf ]];
            then
                SWAP="${BASH_REMATCH[2]}-${BASH_REMATCH[1]}.pdf"
                SWAP=$(echo "$SWAP" | tr 'A-Z' 'a-z') ## eg '1979-Svorny.pdf' → '1979-svorny.pdf'

                mv "$FILE" "$SWAP"
                FILE="$SWAP"
            fi
            TARGET=$TARGET_DIR/$(basename "$FILE")
            if [ ! -e ~/wiki/"$TARGET" ]; then
                mv "$FILE" ~/wiki/"$TARGET"
                cd ~/wiki/ || return
                chmod a+r "$TARGET"
                if [[ "$TARGET" =~ .*\.pdf ]]; then
                    METADATA=$(crossref "$TARGET") && echo "$METADATA" & # background for speed, but print it out mostly-atomically to avoid being mangled & impeding copy-paste of the annotation metadata
                    compressPdf "$TARGET";
                    chmod a+r "$TARGET";
                fi
                (git add "$TARGET" &)
                (rsync --mkpath --chmod='a+r' -q "$TARGET" gwern@176.9.41.242:"/home/gwern/gwern.net/$TARGET_DIR/" || \
                    rsync --chmod='a+r' -v "$TARGET" gwern@176.9.41.242:"/home/gwern/gwern.net/$TARGET_DIR/"
                URL="https://gwern.net/$TARGET_DIR/$(basename "$FILE")"
                cloudflare-expire "$TARGET_DIR/$(basename "$FILE")"
                echo ""
                echo "/$TARGET $URL"

                $WWW_BROWSER "$URL") &

            else echo ~/wiki/"$TARGET" " already exists"
            fi
        else echo "First argument $1 is not a file?"
             return 1
        fi
    fi
fi

pwd
