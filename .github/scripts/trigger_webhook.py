#!/usr/bin/env python3
"""Trigger a Dokploy deployment without exposing its webhook URL in logs."""

import json
import os
import sys
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


def main() -> int:
    url = os.environ.get("DOKPLOY_WEBHOOK_URL", "").strip()
    if not url:
        print("DOKPLOY_WEBHOOK_URL is not configured.", file=sys.stderr)
        return 2
    if not url.startswith("https://"):
        print("DOKPLOY_WEBHOOK_URL must use HTTPS.", file=sys.stderr)
        return 2

    request = urllib.request.Request(
        url,
        data=json.dumps({"source": "github-actions"}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "store-system-deploy/1.0"},
        method="POST",
    )
    opener = urllib.request.build_opener(urllib.request.HTTPHandler(), NoRedirect())
    try:
        with opener.open(request, timeout=30) as response:
            if not 200 <= response.status < 300:
                print(f"Dokploy returned HTTP {response.status}.", file=sys.stderr)
                return 1
            print(f"Dokploy deployment trigger accepted (HTTP {response.status}).")
    except urllib.error.HTTPError as error:
        print(f"Dokploy rejected the deployment trigger (HTTP {error.code}).", file=sys.stderr)
        return 1
    except (urllib.error.URLError, TimeoutError) as error:
        print(f"Could not reach Dokploy: {error.reason if isinstance(error, urllib.error.URLError) else 'request timed out'}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
