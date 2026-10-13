#!/bin/bash
set -e
cd "$(dirname "$0")/images"

UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"

download() {
  slug="$1"
  url="$2"
  ext="${url##*.}"
  curl -sL -A "$UA" -e "https://ashkan-medical.com/en/shop/" -o "${slug}.${ext}" "$url"
  echo "$slug -> $(file -b "${slug}.${ext}" | cut -c1-40)"
}

download prime-lase "https://ashkan-medical.com/wp-content/uploads/2022/02/Primelase-600x600.jpg"
download elysion-pro "https://ashkan-medical.com/wp-content/uploads/2022/02/Primelase1-1-600x600.jpg"
download angela "https://ashkan-medical.com/wp-content/uploads/2022/02/angela-1-600x600.jpg"
download ashley "https://ashkan-medical.com/wp-content/uploads/2022/02/ashley-index-600x600.webp"
download cooltech-cooltech-define "https://ashkan-medical.com/wp-content/uploads/2022/02/Cooltech-Define-600x600.jpg"
download powershape2 "https://ashkan-medical.com/wp-content/uploads/2022/02/powershappee-600x600.jpg"
download 4plus "https://ashkan-medical.com/wp-content/uploads/2022/02/NC-4P-09-2019-10-22-1-600x600.jpg"
download tesla-former "https://ashkan-medical.com/wp-content/uploads/2022/02/teslaformer-index-600x600.jpg"
download inbody "https://ashkan-medical.com/wp-content/uploads/2022/02/1564579420125-scaled-1-600x600.jpg"
download pico-premium "https://ashkan-medical.com/wp-content/uploads/2022/02/PICO-PREMIUM-index-600x600.jpg"
download q10 "https://ashkan-medical.com/wp-content/uploads/2022/02/q10-index-600x600.jpg"
download exciplex "https://ashkan-medical.com/wp-content/uploads/2022/02/exciplex33-1-600x600.jpg"
download wolf "https://ashkan-medical.com/wp-content/uploads/2022/02/wolf-index-600x600.jpg"
