"""Render documentation SVGs from XRobots' MIT-licensed dog02_9g STEP model."""

from pathlib import Path
import sys

import cadquery as cq
from cadquery import exporters


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: render_body_views.py INPUT.stp OUTPUT_DIR")

    source = Path(sys.argv[1])
    output = Path(sys.argv[2])
    output.mkdir(parents=True, exist_ok=True)
    model = cq.importers.importStep(str(source))

    views = {
        "youcanbuilddog-9g-isometric.svg": ((1, -1, -0.72), True),
        "youcanbuilddog-9g-top.svg": ((0, -1, 0), False),
    }
    for filename, (direction, rotate_180) in views.items():
        exporters.export(
            model,
            str(output / filename),
            opt={
                "width": 1200,
                "height": 800,
                "marginLeft": 50,
                "marginTop": 50,
                "showAxes": False,
                "projectionDir": direction,
                "strokeWidth": 0.6,
                "strokeColor": (25, 35, 55),
                "hiddenColor": (170, 180, 195),
                "showHidden": False,
            },
        )
        svg_path = output / filename
        svg = svg_path.read_text(encoding="utf-8")
        if rotate_180:
            svg = svg.replace(
                '<g transform="scale(',
                '<g transform="rotate(180 600 400)">\n    <g transform="scale(',
                1,
            )
            svg = svg.rsplit("</svg>", 1)[0] + "    </g>\n</svg>\n"
        svg = "\n".join(line.rstrip() for line in svg.splitlines()) + "\n"
        svg_path.write_text(svg, encoding="utf-8")


if __name__ == "__main__":
    main()
