import argparse
import json
from pathlib import Path
import shutil
import sys

from .models import DESIGN_ADAPTER, PrintError
from .service import render_design, STORAGE


def main():
    parser = argparse.ArgumentParser(description="Generate one validated A4 papercraft model.")
    parser.add_argument("design", type=Path, help="DesignSpec JSON file")
    parser.add_argument("--output", type=Path, required=True, help="Folder for PDF, SVG and GLB")
    args = parser.parse_args()
    try:
        design = DESIGN_ADAPTER.validate_json(args.design.read_text())
        result = render_design(design)
    except PrintError as exc:
        print(json.dumps({"error": exc.message, "failed_checks": exc.details}), file=sys.stderr)
        return 1
    args.output.mkdir(parents=True, exist_ok=True)
    folder = STORAGE / result["model_url"].split('/')[-2]
    for name in ("net.pdf", "net.svg", "model.glb", "design.json", "validation.json", "result.json"):
        shutil.copy2(folder / name, args.output / name)
    print(json.dumps({"output": str(args.output.resolve()), "result": result}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
