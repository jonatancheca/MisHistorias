from __future__ import annotations

import html
import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "design-nsfw.md"
OUTPUT = ROOT / "docs" / "design-nsfw.pdf"

INK = colors.HexColor("#2A2224")
MUTED = colors.HexColor("#6D6264")
ACCENT = colors.HexColor("#D95846")
GOLD = colors.HexColor("#A9782D")
PAPER = colors.HexColor("#FBF8F3")
SURFACE = colors.HexColor("#F1EAE3")
LINE = colors.HexColor("#D9CBC5")
CODE_BG = colors.HexColor("#211B1D")
CODE_FG = colors.HexColor("#F2ECE4")


def register_fonts() -> tuple[str, str, str, str]:
    candidates = {
        "Body": [
            Path("C:/Windows/Fonts/segoeui.ttf"),
            Path("C:/Windows/Fonts/arial.ttf"),
        ],
        "BodyBold": [
            Path("C:/Windows/Fonts/seguisb.ttf"),
            Path("C:/Windows/Fonts/arialbd.ttf"),
        ],
        "Display": [
            Path("C:/Windows/Fonts/georgia.ttf"),
            Path("C:/Windows/Fonts/times.ttf"),
        ],
        "Mono": [
            Path("C:/Windows/Fonts/consola.ttf"),
            Path("C:/Windows/Fonts/cour.ttf"),
        ],
    }
    names: dict[str, str] = {}
    for name, paths in candidates.items():
        font_path = next((path for path in paths if path.exists()), None)
        if font_path is None:
            fallback = {
                "Body": "Helvetica",
                "BodyBold": "Helvetica-Bold",
                "Display": "Times-Roman",
                "Mono": "Courier",
            }
            names[name] = fallback[name]
            continue
        pdfmetrics.registerFont(TTFont(name, str(font_path)))
        names[name] = name
    return names["Body"], names["BodyBold"], names["Display"], names["Mono"]


BODY_FONT, BOLD_FONT, DISPLAY_FONT, MONO_FONT = register_fonts()


def inline_markup(value: str) -> str:
    value = html.escape(value, quote=False)
    value = re.sub(r"`([^`]+)`", r'<font name="%s" color="#8F3E34">\1</font>' % MONO_FONT, value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", value)
    value = re.sub(r"\*([^*]+)\*", r"<i>\1</i>", value)
    value = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<link href="\2" color="#B74B3E">\1</link>', value)
    return value


def styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "Title",
            parent=base["Title"],
            fontName=DISPLAY_FONT,
            fontSize=32,
            leading=34,
            textColor=PAPER,
            alignment=TA_LEFT,
            spaceAfter=8,
        ),
        "subtitle": ParagraphStyle(
            "Subtitle",
            parent=base["Normal"],
            fontName=BODY_FONT,
            fontSize=11,
            leading=16,
            textColor=colors.HexColor("#C8BDB7"),
        ),
        "h1": ParagraphStyle(
            "H1",
            parent=base["Heading1"],
            fontName=DISPLAY_FONT,
            fontSize=21,
            leading=25,
            textColor=INK,
            spaceBefore=14,
            spaceAfter=8,
            keepWithNext=True,
        ),
        "h2": ParagraphStyle(
            "H2",
            parent=base["Heading2"],
            fontName=BOLD_FONT,
            fontSize=14,
            leading=18,
            textColor=ACCENT,
            spaceBefore=11,
            spaceAfter=5,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "H3",
            parent=base["Heading3"],
            fontName=BOLD_FONT,
            fontSize=11,
            leading=14,
            textColor=GOLD,
            spaceBefore=8,
            spaceAfter=4,
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName=BODY_FONT,
            fontSize=8.7,
            leading=12.5,
            textColor=INK,
            spaceAfter=4,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=base["BodyText"],
            fontName=BODY_FONT,
            fontSize=8.5,
            leading=12,
            leftIndent=12,
            firstLineIndent=-7,
            textColor=INK,
            spaceAfter=2,
        ),
        "number": ParagraphStyle(
            "Number",
            parent=base["BodyText"],
            fontName=BODY_FONT,
            fontSize=8.5,
            leading=12,
            leftIndent=14,
            firstLineIndent=-10,
            textColor=INK,
            spaceAfter=2,
        ),
        "code": ParagraphStyle(
            "Code",
            parent=base["Code"],
            fontName=MONO_FONT,
            fontSize=6.7,
            leading=9,
            textColor=colors.HexColor("#584A4D"),
            backColor=SURFACE,
            borderPadding=7,
            borderRadius=4,
            spaceBefore=4,
            spaceAfter=7,
        ),
        "table": ParagraphStyle(
            "Table",
            parent=base["BodyText"],
            fontName=BODY_FONT,
            fontSize=6.6,
            leading=8.5,
            textColor=INK,
        ),
        "table_head": ParagraphStyle(
            "TableHead",
            parent=base["BodyText"],
            fontName=BOLD_FONT,
            fontSize=6.7,
            leading=8.5,
            textColor=PAPER,
        ),
        "toc_title": ParagraphStyle(
            "TOCTitle",
            parent=base["Heading1"],
            fontName=DISPLAY_FONT,
            fontSize=22,
            textColor=INK,
            spaceAfter=12,
        ),
    }


STYLES = styles()


class DesignDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=18 * mm,
            rightMargin=18 * mm,
            topMargin=18 * mm,
            bottomMargin=17 * mm,
            title="Diseño técnico y UX/UI — Mis Historias NSFW",
            author="Mis Historias",
            subject="Diseño de producto NSFW",
        )
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="body")
        self.addPageTemplates(PageTemplate(id="main", frames=[frame], onPage=self.draw_page))

    def draw_page(self, canvas, doc):
        canvas.saveState()
        canvas.setFillColor(CODE_BG if doc.page == 1 else PAPER)
        canvas.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
        if doc.page > 1:
            canvas.setStrokeColor(LINE)
            canvas.line(18 * mm, 13 * mm, A4[0] - 18 * mm, 13 * mm)
            canvas.setFont(BODY_FONT, 7)
            canvas.setFillColor(MUTED)
            canvas.drawString(18 * mm, 8.5 * mm, "Mis Historias NSFW · Diseño técnico y UX/UI")
            canvas.drawRightString(A4[0] - 18 * mm, 8.5 * mm, str(doc.page))
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph):
            style = flowable.style.name
            if style in {"H1", "H2"}:
                level = 0 if style == "H1" else 1
                text = flowable.getPlainText()
                key = f"h{level}-{self.seq.nextf('heading')}"
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(text, key, level=level, closed=False)
                self.notify("TOCEntry", (level, text, self.page, key))


def cover_story() -> list:
    content = []
    block = Table(
        [[
            Paragraph("MIS HISTORIAS", ParagraphStyle(
                "Eyebrow", fontName=BOLD_FONT, fontSize=8, leading=10,
                textColor=colors.HexColor("#FF8A76"), spaceAfter=12
            )),
            ""
        ]],
        colWidths=[100 * mm, 60 * mm],
    )
    block.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), CODE_BG), ("BOX", (0, 0), (-1, -1), 0, CODE_BG)]))
    content.append(Spacer(1, 22 * mm))
    content.append(block)
    content.append(Paragraph("Diseño técnico<br/>y UX/UI", STYLES["title"]))
    content.append(Spacer(1, 5 * mm))
    content.append(Paragraph(
        "Versión NSFW oculta · Arquitectura, motor narrativo, usuarios, tres formatos y sistema visual Empty Spaces",
        STYLES["subtitle"],
    ))
    content.append(Spacer(1, 24 * mm))
    meta_style = ParagraphStyle(
        "CoverMeta", parent=STYLES["subtitle"], fontSize=9, leading=14,
        textColor=colors.HexColor("#AFA4A0")
    )
    content.append(Paragraph("Especificación para Nuxt · SQLite · LM Studio", meta_style))
    content.append(Paragraph("21 de agosto de 2026", meta_style))
    content.append(Spacer(1, 20 * mm))
    note = Table(
        [[Paragraph(
            "<b>Ámbito:</b> solo la parte NSFW oculta. La aplicación SFW conserva rutas, datos, motor y estilo actuales.",
            ParagraphStyle("CoverNote", parent=STYLES["body"], textColor=PAPER, fontSize=9, leading=13),
        )]],
        colWidths=[155 * mm],
    )
    note.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#35272A")),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#79504B")),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    content.append(note)
    content.append(PageBreak())
    return content


def parse_table(lines: list[str], start: int) -> tuple[Table, int]:
    raw_rows = []
    index = start
    while index < len(lines) and lines[index].strip().startswith("|"):
        cells = [cell.strip() for cell in lines[index].strip().strip("|").split("|")]
        raw_rows.append(cells)
        index += 1
    if len(raw_rows) >= 2 and all(re.fullmatch(r":?-{3,}:?", cell) for cell in raw_rows[1]):
        raw_rows.pop(1)
    column_count = max(len(row) for row in raw_rows)
    available = A4[0] - 36 * mm
    if column_count == 2:
        widths = [available * 0.32, available * 0.68]
    else:
        widths = [available / column_count] * column_count
    data = []
    for row_index, row in enumerate(raw_rows):
        style = STYLES["table_head"] if row_index == 0 else STYLES["table"]
        padded = row + [""] * (column_count - len(row))
        data.append([Paragraph(inline_markup(cell), style) for cell in padded])
    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), CODE_BG),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [PAPER, SURFACE]),
    ]))
    return table, index


def markdown_story(markdown: str) -> list:
    lines = markdown.splitlines()
    story: list = []
    in_code = False
    code_language = ""
    code_lines: list[str] = []
    paragraph_lines: list[str] = []

    def flush_paragraph():
        if paragraph_lines:
            text = " ".join(line.strip() for line in paragraph_lines)
            story.append(Paragraph(inline_markup(text), STYLES["body"]))
            paragraph_lines.clear()

    index = 0
    first_h1_skipped = False
    while index < len(lines):
        line = lines[index]
        stripped = line.strip()

        if stripped.startswith("```"):
            flush_paragraph()
            if not in_code:
                in_code = True
                code_language = stripped[3:].strip()
                code_lines = []
            else:
                label = "DIAGRAMA" if code_language == "mermaid" else (code_language.upper() or "CÓDIGO")
                code = f"{label}\n\n" + "\n".join(code_lines)
                story.append(Preformatted(code, STYLES["code"], maxLineLength=94))
                in_code = False
            index += 1
            continue

        if in_code:
            code_lines.append(line)
            index += 1
            continue

        if stripped.startswith("|"):
            flush_paragraph()
            table, index = parse_table(lines, index)
            story.append(table)
            story.append(Spacer(1, 5))
            continue

        heading = re.match(r"^(#{1,3})\s+(.+)$", stripped)
        if heading:
            flush_paragraph()
            level = len(heading.group(1))
            title = heading.group(2)
            if level == 1 and not first_h1_skipped:
                first_h1_skipped = True
            else:
                visual_level = max(1, level - 1)
                story.append(Paragraph(inline_markup(title), STYLES[f"h{visual_level}"]))
            index += 1
            continue

        bullet = re.match(r"^-\s+(.+)$", stripped)
        if bullet:
            flush_paragraph()
            story.append(Paragraph("• " + inline_markup(bullet.group(1)), STYLES["bullet"]))
            index += 1
            continue

        number = re.match(r"^(\d+)\.\s+(.+)$", stripped)
        if number:
            flush_paragraph()
            story.append(Paragraph(f"{number.group(1)}. " + inline_markup(number.group(2)), STYLES["number"]))
            index += 1
            continue

        if stripped in {"---", ""}:
            flush_paragraph()
            if stripped == "---":
                story.append(Spacer(1, 4))
            index += 1
            continue

        paragraph_lines.append(line)
        index += 1

    flush_paragraph()
    return story


def build() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"No existe {SOURCE}")
    markdown = SOURCE.read_text(encoding="utf-8")
    doc = DesignDocTemplate(str(OUTPUT))
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle(
            "TOC1", fontName=BOLD_FONT, fontSize=9, leading=13,
            textColor=INK, leftIndent=0, firstLineIndent=0, spaceBefore=4
        ),
        ParagraphStyle(
            "TOC2", fontName=BODY_FONT, fontSize=7.5, leading=10,
            textColor=MUTED, leftIndent=12, firstLineIndent=0
        ),
    ]
    story = cover_story()
    story.extend([
        Paragraph("Contenido", STYLES["toc_title"]),
        toc,
        PageBreak(),
    ])
    story.extend(markdown_story(markdown))
    doc.multiBuild(story)
    print(f"Generated {OUTPUT}")


if __name__ == "__main__":
    try:
        build()
    except Exception as error:
        print(f"PDF generation failed: {error}", file=sys.stderr)
        raise
