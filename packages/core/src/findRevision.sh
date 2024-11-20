#!/bin/bash

function download_url {
  if [[ "$OS" == "Linux" ]]; then
    echo "https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Linux_x64%2F${1}%2Fchrome-linux.zip?alt=media"
  elif [[ "$OS" == "Mac" ]] || [[ "$OS" == "Mac_Arm" ]]; then
    echo "https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/$OS%2F${1}%2Fchrome-mac.zip?alt=media"
  elif [[ "$OS" == "Win" ]] || [[ "$OS" == "Win_x64" ]]; then
    echo "https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/$OS%2F${1}%2Fchrome-win.zip?alt=media"
  fi
}

function get_closest_rev {
  while true; do
    curl -I 2>/dev/null `download_url $REVISION` | head -1 | grep 404 >/dev/null
    if (($? == 1)); then
      break
    fi
    REVISION=$(($REVISION-1))
  done
  echo $REVISION
}


if (($# < 1)); then
  printf "usage: \n"
  printf "  ./get_chromuim [-r] rev    - will get chromium by revision\n"
  exit 1
fi

export REVISION=$1

for os in "Linux" "Mac" "Mac_Arm" "Win" "Win_x64";
do
  export OS=$os
  echo "$OS" `get_closest_rev`
done
