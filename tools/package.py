"""把扩展打包成可直接分发的 zip（官网「下载插件」按钮指向这个文件）。

用法：
    python tools/package.py

产物：
    docs/downloads/imagegrab-v1.0.0.zip
压缩包内顶层目录为 imagegrab-v1.0.0/，解压后直接用 Chrome 加载该目录即可。
"""
import json
import os
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_DIR = os.path.join(ROOT, "docs", "downloads")

# 只打包扩展本体，不含官网、演示页、截图
INCLUDE_FILES = [
    "manifest.json",
    "content.js",
    "content.css",
    "background.js",
    "gallery.html",
    "gallery.css",
    "gallery.js",
    "README.md",
]
INCLUDE_DIRS = ["icons"]


def main():
    with open(os.path.join(ROOT, "manifest.json"), encoding="utf-8") as fh:
        version = json.load(fh)["version"]

    os.makedirs(OUT_DIR, exist_ok=True)
    target = os.path.join(OUT_DIR, f"imagegrab-v{version}.zip")
    prefix = f"imagegrab-v{version}"

    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in INCLUDE_FILES:
            path = os.path.join(ROOT, name)
            if os.path.exists(path):
                zf.write(path, f"{prefix}/{name}")
        for folder in INCLUDE_DIRS:
            base = os.path.join(ROOT, folder)
            for dirpath, _dirnames, filenames in os.walk(base):
                for filename in filenames:
                    full = os.path.join(dirpath, filename)
                    rel = os.path.relpath(full, ROOT).replace(os.sep, "/")
                    zf.write(full, f"{prefix}/{rel}")

    size_kb = os.path.getsize(target) / 1024
    print(f"已生成 {target} （{size_kb:.1f} KB，版本 v{version}）")


if __name__ == "__main__":
    main()
