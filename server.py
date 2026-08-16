#!/usr/bin/env python3
"""
Nightflix local dev server.
- Serves real files (.html, .js, .css, images) directly.
- Falls back to index.html ONLY for /watch/movie/* and /watch/tv/* paths.
- Everything else that doesn't exist returns 404.

Run: python server.py
Then open: http://localhost:3000
"""
import http.server
import os
import re

PORT = 3000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

MIME = {
    '.html': 'text/html',
    '.js':   'application/javascript',
    '.css':  'text/css',
    '.json': 'application/json',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.ico':  'image/x-icon',
    '.svg':  'image/svg+xml',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
}

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?')[0]

        # Map /watch/movie/:id and /watch/tv/:id → index.html (SPA route)
        if re.match(r'^/watch/(movie|tv)/\d+', path):
            self.serve_file('index.html')
            return

        # Strip leading slash, default to index.html
        rel = path.lstrip('/')
        if not rel:
            rel = 'index.html'

        full = os.path.join(DIRECTORY, rel.replace('/', os.sep))

        if os.path.isfile(full):
            self.serve_file(rel)
        else:
            self.send_error(404, 'File not found: ' + path)

    def serve_file(self, rel):
        full = os.path.join(DIRECTORY, rel.replace('/', os.sep))
        ext  = os.path.splitext(rel)[1].lower()
        mime = MIME.get(ext, 'application/octet-stream')
        try:
            with open(full, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_error(500, str(e))

    def log_message(self, fmt, *args):
        print(fmt % args)

if __name__ == '__main__':
    os.chdir(DIRECTORY)
    with http.server.HTTPServer(('', PORT), Handler) as httpd:
        print(f'Nightflix running at http://localhost:{PORT}')
        print('Press Ctrl+C to stop.')
        httpd.serve_forever()
