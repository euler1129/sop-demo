# -*- coding: utf-8 -*-
"""下载并本地化第三方库到 vendor/，保证运行期零外网依赖。"""
import os, sys, urllib.request

sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VENDOR = os.path.join(ROOT, 'vendor')
os.makedirs(VENDOR, exist_ok=True)

FILES = {
    'xlsx.full.min.js': 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    'jszip.min.js': 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
}

for name, url in FILES.items():
    dst = os.path.join(VENDOR, name)
    if os.path.exists(dst) and os.path.getsize(dst) > 10000:
        print('SKIP(exists):', name)
        continue
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    data = urllib.request.urlopen(req, timeout=60).read()
    with open(dst, 'wb') as f:
        f.write(data)
    print('OK:', name, len(data), 'bytes')
