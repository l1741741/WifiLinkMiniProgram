#!/usr/bin/env python3
"""独立二维码解码器 —— 用 OpenCV 校验生成的码是否真的能被扫出来。

刻意不复用项目里的任何编码代码，保证这是「第三方视角」的验证。
用法: python3 decode-qr.py <图片路径> [期望内容]
"""
import json
import sys

import cv2


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: decode-qr.py <image> [expected]"}))
        return 2

    img_path = sys.argv[1]
    expected = sys.argv[2] if len(sys.argv) > 2 else None

    img = cv2.imread(img_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        print(json.dumps({"ok": False, "error": f"cannot read image: {img_path}"}))
        return 1

    detector = cv2.QRCodeDetector()
    data, points, _ = detector.detectAndDecode(img)

    found = bool(data)
    match = None
    if expected is not None:
        match = found and data == expected

    print(json.dumps({
        "ok": found,
        "match": match,
        "data": data or "",
        "expected": expected,
        "size": [int(img.shape[1]), int(img.shape[0])],
        "located": points is not None,
    }, ensure_ascii=False))
    return 0 if found and (match is not False) else 1


if __name__ == "__main__":
    sys.exit(main())
