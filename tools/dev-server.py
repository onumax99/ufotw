"""Web 版（web/）を手元で確かめるためのサーバー。

python -m http.server と違い、ブラウザにキャッシュさせない（古い JS が混ざって読み込みに失敗しないように）。
使い方: python tools/dev-server.py [ポート番号]  → http://localhost:8123/?mock
"""

import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")


class Handler(http.server.SimpleHTTPRequestHandler):
    # Windows のレジストリの設定によっては .js が text/plain になり、ES modules が読めなくなるので固定する
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as server:
        print(f"http://localhost:{PORT}/?mock")
        server.serve_forever()
