#!/usr/bin/env python3
"""
Gera o relatorio de auditoria de seguranca do Codehood Server em PDF.

Uso:
    docs/security-audit/.venv/bin/python docs/security-audit/generate_report.py

Os dados vivem em `findings.py` (achados, pontos fortes, recomendacoes) e
`issues.py` (texto das issues do GitHub). Este arquivo cuida apenas da
apresentacao: graficos, paginacao e estilo.
"""

from __future__ import annotations

import sys
import textwrap
from collections import Counter
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Frame,
    HRFlowable,
    Image,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from findings import (  # noqa: E402
    AUDIT_DATE,
    CATEGORIES,
    COMMIT,
    FINDINGS,
    METHODOLOGY,
    PROJECT,
    RECOMMENDATIONS,
    SEV_COLOR,
    SEV_ORDER,
    STACK,
    STRENGTHS,
    WEAKNESSES,
)
from accents import acc, acc_markdown  # noqa: E402
from issues import ISSUES  # noqa: E402

OUT_PDF = HERE / "relatorio-auditoria-seguranca.pdf"
CHART_DIR = HERE / "charts"

REPORT_NAME = f"Relatório de Auditoria de Segurança — {PROJECT}"

MARGIN = 2 * cm
FRAME_W = A4[0] - 2 * MARGIN
INK = colors.HexColor("#1F2937")
MUTED = colors.HexColor("#6B7280")
RULE = colors.HexColor("#D1D5DB")
CODE_BG = colors.HexColor("#F3F4F6")
GREEN = colors.HexColor(SEV_COLOR["strength"])

SEV_LABEL = {
    "critical": "CRÍTICA",
    "high": "ALTA",
    "medium": "MÉDIA",
    "low": "BAIXA",
    "info": "INFORMATIVA",
}


# --------------------------------------------------------------------------
# Estilos
# --------------------------------------------------------------------------
def build_styles():
    ss = getSampleStyleSheet()
    s = {}
    s["body"] = ParagraphStyle(
        "body",
        parent=ss["BodyText"],
        fontName="Helvetica",
        fontSize=9.5,
        leading=14,
        alignment=TA_JUSTIFY,
        textColor=INK,
        spaceAfter=7,
    )
    s["bodyc"] = ParagraphStyle("bodyc", parent=s["body"], alignment=TA_CENTER)
    s["h1"] = ParagraphStyle(
        "h1",
        parent=ss["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=17,
        leading=21,
        textColor=INK,
        spaceBefore=4,
        spaceAfter=10,
    )
    s["h2"] = ParagraphStyle(
        "h2",
        parent=ss["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=12.5,
        leading=16,
        textColor=INK,
        spaceBefore=12,
        spaceAfter=6,
    )
    s["h3"] = ParagraphStyle(
        "h3",
        parent=ss["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=10.5,
        leading=14,
        textColor=INK,
        spaceBefore=8,
        spaceAfter=4,
    )
    s["small"] = ParagraphStyle(
        "small", parent=s["body"], fontSize=8.2, leading=11.5, spaceAfter=4
    )
    s["muted"] = ParagraphStyle("muted", parent=s["small"], textColor=MUTED)
    s["code"] = ParagraphStyle(
        "code",
        parent=ss["Code"],
        fontName="Courier",
        fontSize=7.4,
        leading=9.6,
        textColor=INK,
        leftIndent=0,
        spaceAfter=0,
        spaceBefore=0,
    )
    s["issuecode"] = ParagraphStyle(
        "issuecode", parent=s["code"], fontSize=7.0, leading=9.0
    )
    s["cover_title"] = ParagraphStyle(
        "cover_title",
        parent=ss["Title"],
        fontName="Helvetica-Bold",
        fontSize=26,
        leading=32,
        textColor=INK,
        alignment=TA_CENTER,
    )
    s["cover_sub"] = ParagraphStyle(
        "cover_sub",
        parent=s["body"],
        fontSize=13,
        leading=18,
        alignment=TA_CENTER,
        textColor=MUTED,
        spaceAfter=0,
    )
    s["th"] = ParagraphStyle(
        "th",
        parent=s["small"],
        fontName="Helvetica-Bold",
        textColor=colors.white,
        alignment=TA_CENTER,
        spaceAfter=0,
    )
    s["td"] = ParagraphStyle("td", parent=s["small"], alignment=TA_LEFT, spaceAfter=0)
    s["tdmono"] = ParagraphStyle(
        "tdmono", parent=s["small"], fontName="Courier", fontSize=6.9, leading=9.5,
        spaceAfter=0,
    )
    return s


S = build_styles()


def esc(text: str, accents: bool = True) -> str:
    """Escapa para o mini-HTML do reportlab; acentua a prosa por padrao."""
    if accents:
        text = acc(text)
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


#: Um Table de uma linha nao quebra entre paginas, entao blocos longos sao
#: fatiados em varios tables consecutivos. Fatias curtas empacotam melhor:
#: cada uma cabe no que sobrou da pagina em vez de empurrar tudo para a proxima.
CHUNK_LINES = 8


def code_block(source: str, style=None) -> list:
    """Bloco de codigo monoespacado, fatiado para poder atravessar paginas."""
    style = style or S["code"]
    lines = []
    width = 104 if style is S["code"] else 108
    for raw in source.rstrip("\n").split("\n"):
        if len(raw) <= width:
            lines.append(raw)
        else:
            lines.extend(textwrap.wrap(raw, width, subsequent_indent="    ") or [""])

    chunks = [
        lines[i : i + CHUNK_LINES] for i in range(0, len(lines), CHUNK_LINES)
    ] or [[""]]

    out = []
    last = len(chunks) - 1
    for i, chunk in enumerate(chunks):
        # So a primeira e a ultima fatia levam respiro vertical: as do meio
        # ficam coladas, de modo que o bloco pareca continuo apesar de ser
        # varios flowables.
        t = Table([[Preformatted("\n".join(chunk), style)]], colWidths=[FRAME_W])
        t.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ("TOPPADDING", (0, 0), (-1, -1), 6 if i == 0 else 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6 if i == last else 0),
                    ("LINEBEFORE", (0, 0), (0, -1), 2.5, colors.HexColor("#9CA3AF")),
                ]
            )
        )
        out.append(t)
    return out


def sev_chip(sev: str) -> Table:
    t = Table([[Paragraph(SEV_LABEL[sev], S["th"])]], colWidths=[2.15 * cm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(SEV_COLOR[sev])),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    return t


def bullets(items, style=None) -> ListFlowable:
    style = style or S["body"]
    return ListFlowable(
        [ListItem(Paragraph(i, style), leftIndent=14) for i in items],
        bulletType="bullet",
        bulletFontSize=7,
        bulletOffsetY=-1,
        leftIndent=12,
        spaceAfter=6,
    )


# --------------------------------------------------------------------------
# Graficos
# --------------------------------------------------------------------------
def chart_donut(counts: Counter, path: Path) -> None:
    present = [s for s in SEV_ORDER if counts.get(s)]
    values = [counts[s] for s in present]
    labels = [f"{SEV_LABEL[s].capitalize()}\n{counts[s]}" for s in present]
    palette = [SEV_COLOR[s] for s in present]

    fig, ax = plt.subplots(figsize=(4.6, 3.4), dpi=220)
    wedges, _ = ax.pie(
        values,
        colors=palette,
        startangle=90,
        counterclock=False,
        wedgeprops={"width": 0.42, "edgecolor": "white", "linewidth": 2},
    )
    ax.legend(
        wedges,
        labels,
        loc="center left",
        bbox_to_anchor=(0.98, 0.5),
        frameon=False,
        fontsize=10,
        labelspacing=1.1,
    )
    ax.text(0, 0.08, str(sum(values)), ha="center", va="center",
            fontsize=21, fontweight="bold", color="#1F2937")
    ax.text(0, -0.22, "achados", ha="center", va="center", fontsize=8.5, color="#6B7280")
    ax.set(aspect="equal")
    fig.tight_layout()
    fig.savefig(path, bbox_inches="tight", transparent=True)
    plt.close(fig)


def chart_bars(path: Path) -> None:
    cats = list(CATEGORIES.keys())
    names = [
        "1. Isolamento",
        "2. Permissão no\nnavegador",
        "3. IDOR",
        "4. Chaves e\ndefaults",
        "5. XSS",
    ]
    by_cat = {c: Counter() for c in cats}
    for f in FINDINGS:
        by_cat[f["cat"]][f["sev"]] += 1

    fig, ax = plt.subplots(figsize=(7.4, 3.1), dpi=220)
    bottoms = [0] * len(cats)
    for sev in SEV_ORDER:
        vals = [by_cat[c].get(sev, 0) for c in cats]
        if not any(vals):
            continue
        ax.bar(
            names,
            vals,
            bottom=bottoms,
            color=SEV_COLOR[sev],
            label=SEV_LABEL[sev].capitalize(),
            width=0.58,
            edgecolor="white",
            linewidth=1.1,
        )
        bottoms = [b + v for b, v in zip(bottoms, vals)]

    for x, total in enumerate(bottoms):
        if total:
            ax.text(x, total + 0.08, str(total), ha="center", va="bottom",
                    fontsize=9, fontweight="bold", color="#1F2937")

    ax.set_ylim(0, max(bottoms) + 0.45)
    ax.set_ylabel("achados", fontsize=8.5, color="#6B7280")
    ax.tick_params(axis="x", labelsize=8.2, colors="#1F2937", length=0)
    ax.tick_params(axis="y", labelsize=8, colors="#6B7280", length=0)
    ax.set_yticks(range(0, int(max(bottoms)) + 2))
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color("#D1D5DB")
    ax.grid(axis="y", color="#E5E7EB", linewidth=0.7)
    ax.set_axisbelow(True)
    ax.legend(frameon=False, fontsize=8.2, ncol=4, loc="upper center",
              bbox_to_anchor=(0.5, 1.16))
    fig.tight_layout()
    fig.savefig(path, bbox_inches="tight", transparent=True)
    plt.close(fig)


# --------------------------------------------------------------------------
# Cabecalho e rodape
# --------------------------------------------------------------------------
def decorate(canvas, doc):
    canvas.saveState()
    if doc.page > 1:
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN, A4[1] - MARGIN + 0.5 * cm, REPORT_NAME)
        canvas.drawRightString(
            A4[0] - MARGIN, A4[1] - MARGIN + 0.5 * cm, AUDIT_DATE
        )
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        canvas.line(
            MARGIN, A4[1] - MARGIN + 0.28 * cm, A4[0] - MARGIN, A4[1] - MARGIN + 0.28 * cm
        )
        canvas.line(MARGIN, MARGIN - 0.45 * cm, A4[0] - MARGIN, MARGIN - 0.45 * cm)
        canvas.drawString(MARGIN, MARGIN - 0.95 * cm, "Documento interno")
        canvas.drawRightString(
            A4[0] - MARGIN, MARGIN - 0.95 * cm, f"Página {doc.page}"
        )
    canvas.restoreState()


class Doc(BaseDocTemplate):
    def __init__(self, path):
        super().__init__(
            str(path),
            pagesize=A4,
            leftMargin=MARGIN,
            rightMargin=MARGIN,
            topMargin=MARGIN,
            bottomMargin=MARGIN,
            title=REPORT_NAME,
            author="Auditoria interna",
            subject="Auditoria de seguranca de aplicacao",
        )
        frame = Frame(
            MARGIN, MARGIN, FRAME_W, A4[1] - 2 * MARGIN, id="main",
            leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
        )
        self.addPageTemplates(
            [PageTemplate(id="page", frames=[frame], onPage=decorate)]
        )


# --------------------------------------------------------------------------
# Secoes
# --------------------------------------------------------------------------
def cover(story, counts):
    story.append(Spacer(1, 3.2 * cm))
    story.append(
        Paragraph(
            f"Relatório de Auditoria<br/>de Segurança<br/>&#8212; {PROJECT} &#8212;",
            S["cover_title"],
        )
    )
    story.append(Spacer(1, 0.7 * cm))
    story.append(
        HRFlowable(width="45%", thickness=2.5, color=colors.HexColor("#B91C1C"),
                   hAlign="CENTER", spaceAfter=18)
    )
    story.append(Paragraph(AUDIT_DATE, S["cover_sub"]))
    story.append(Spacer(1, 1.3 * cm))

    chips = [sev_chip(s) for s in SEV_ORDER if counts.get(s)]
    nums = [
        Paragraph(f"<b>{counts[s]}</b>", ParagraphStyle(
            "n", parent=S["bodyc"], fontSize=15, leading=18, spaceAfter=0))
        for s in SEV_ORDER if counts.get(s)
    ]
    if chips:
        t = Table([nums, chips], colWidths=[2.45 * cm] * len(chips), hAlign="CENTER")
        t.setStyle(TableStyle([
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
        ]))
        story.append(t)
    story.append(Spacer(1, 1.3 * cm))

    rows = [
        ["Escopo", "Repositorio `codehood-server` completo: codigo-fonte, "
                   "configuracao, workflows de CI, scripts, build em `dist/` e o "
                   "historico do git (44 commits)."],
        ["Revisao em", COMMIT],
        ["Fora de escopo", "CLI cliente (repositorio separado), infraestrutura de "
                           "hospedagem, dependencias de terceiros (sem SCA)."],
        ["Metodo", "Leitura manual do codigo, com verificacao pontual em runtime "
                   "(Node 22) das hipoteses de explorabilidade."],
    ]
    data = [
        [Paragraph(f"<b>{acc(k)}</b>", S["small"]), Paragraph(acc(v), S["small"])]
        for k, v in rows
    ]
    t = Table(data, colWidths=[3.2 * cm, FRAME_W - 3.2 * cm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEABOVE", (0, 0), (-1, 0), 0.6, RULE),
        ("LINEBELOW", (0, 0), (-1, -1), 0.6, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(t)
    story.append(PageBreak())


def section_scope(story):
    story.append(Paragraph("Escopo e nota metodológica", S["h1"]))
    story.append(Paragraph(acc(
        "A auditoria partiu da deteccao da stack, porque as cinco categorias "
        "pedidas foram escritas para um projeto Supabase e precisam de traducao "
        "antes de fazerem sentido aqui. A tabela abaixo registra o que foi "
        "detectado; a seguinte, como cada categoria foi mapeada."), S["body"]))

    data = [[Paragraph("<b>Camada</b>", S["th"]), Paragraph("<b>Detectado</b>", S["th"])]]
    data += [[Paragraph(esc(k), S["td"]), Paragraph(esc(v), S["td"])]
             for k, v in STACK]
    t = Table(data, colWidths=[4.6 * cm, FRAME_W - 4.6 * cm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.5, RULE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F9FAFB")]),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t)

    story.append(Paragraph("Como cada categoria foi mapeada para esta stack", S["h2"]))
    for title, text in METHODOLOGY:
        story.append(Paragraph(esc(title), S["h3"]))
        story.append(Paragraph(esc(text), S["body"]))

    story.append(Paragraph("Convenção de severidade", S["h2"]))
    story.append(bullets([acc(x) for x in (
        "<b>Critica</b> - comprometimento remoto sem autenticacao, ou perda total de dados.",
        "<b>Alta</b> - escalada de privilegio, tomada de conta, ou leitura de dados de outro "
        "inquilino a partir de uma conta comum.",
        "<b>Media</b> - vazamento de dado pessoal ou quebra de uma regra de negocio "
        "documentada, sem escalada direta.",
        "<b>Baixa</b> - endurecimento; hoje nao explorável, mas a protecao depende de fator "
        "externo ao codigo.",
        "<b>Informativa</b> - decisao de projeto registrada, para revisao consciente no futuro.",
    )], S["small"]))
    story.append(PageBreak())


def section_summary(story, counts, donut, bars):
    story.append(Paragraph("Resumo executivo", S["h1"]))
    total = sum(counts.values())
    act = sum(v for k, v in counts.items() if k != "info")
    story.append(Paragraph(acc(
        f"Foram levantados <b>{total} achados</b> ({act} acionaveis e "
        f"{counts.get('info', 0)} informativo), alem de "
        f"<b>{len(STRENGTHS)} pontos fortes</b> verificados. Nenhum achado critico: "
        "nao ha caminho de comprometimento sem autenticacao, e a leitura de dados de "
        "outro curso sempre exige uma conta valida. "
        "Os quatro achados de severidade alta se concentram em dois temas. Tres deles "
        "compartilham um padrao encadeavel - o XSS do "
        "roster (F1) executa na sessao do instrutor, a troca de senha sem senha atual (F2) "
        "converte essa execucao em tomada de conta, e o convite sem checagem de posse (F3) "
        "amplia o alcance para cursos alheios; corrigir F2 ja quebra essa cadeia. O quarto "
        "(F4) e independente e vive na configuracao de deploy: contas padrao criadas em "
        "runtime quando as variaveis de ambiente sao esquecidas."), S["body"]))

    d = Table(
        [[Image(str(donut), width=11.0 * cm, height=7.6 * cm, kind="proportional")]],
        colWidths=[FRAME_W], hAlign="CENTER",
    )
    d.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER")]))
    story.append(Paragraph("Achados por severidade", S["h2"]))
    story.append(d)

    story.append(Paragraph("Achados por categoria", S["h2"]))
    story.append(Image(str(bars), width=FRAME_W, height=FRAME_W * 3.1 / 7.4,
                       kind="proportional"))

    story.append(Spacer(1, 0.35 * cm))
    head = [Paragraph(f"<b>{h}</b>", S["th"]) for h in
            ("ID", "Sev.", "Categoria", "Achado", "Arquivo:linha")]
    rows = [head]
    for f in sorted(FINDINGS, key=lambda x: SEV_ORDER.index(x["sev"])):
        loc = f["loc"][0]
        rows.append([
            Paragraph(f["id"], S["td"]),
            sev_chip(f["sev"]),
            Paragraph(esc(CATEGORIES[f["cat"]].split(". ", 1)[1]), S["td"]),
            Paragraph(esc(f["title"]), S["td"]),
            Paragraph(f"{esc(loc[0], accents=False)}:{loc[1]}", S["tdmono"]),
        ])
    t = Table(rows, colWidths=[1.0 * cm, 2.3 * cm, 3.1 * cm, 6.0 * cm,
                               FRAME_W - 12.4 * cm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.5, RULE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F9FAFB")]),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(Paragraph("Índice dos achados", S["h2"]))
    story.append(t)
    story.append(PageBreak())


def section_strengths(story):
    story.append(Paragraph("Pontos fortes", S["h1"]))
    story.append(Paragraph(acc(
        "Registrados com evidencia, tanto porque sao a prova de cobertura da "
        "auditoria quanto porque delimitam o que nao precisa ser refeito ao "
        "corrigir os achados."), S["body"]))

    for title, ref, text in STRENGTHS:
        chip = Table([[Paragraph("<b>OK</b>", S["th"])]], colWidths=[1.0 * cm])
        chip.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), GREEN),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))
        head = Table(
            [[chip, Paragraph(f"<b>{esc(title)}</b>", S["td"])]],
            colWidths=[1.2 * cm, FRAME_W - 1.2 * cm],
        )
        head.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        story.append(KeepTogether([
            head,
            Paragraph(
                f"<font face='Courier' size='7.2'>{esc(ref, accents=False)}</font>",
                S["muted"]),
            Paragraph(esc(text), S["small"]),
            Spacer(1, 0.25 * cm),
        ]))

    story.append(Paragraph("Pontos fracos", S["h1"]))
    story.append(Paragraph(acc(
        "Os riscos centrais, lidos como padroes e nao como defeitos isolados."),
        S["body"]))
    story.append(bullets([esc(w) for w in WEAKNESSES]))
    story.append(PageBreak())


def section_findings(story):
    story.append(Paragraph("Achados detalhados", S["h1"]))
    story.append(Paragraph(acc(
        "Agrupados pelas cinco categorias da auditoria e ordenados por severidade "
        "dentro de cada uma. Toda linha citada foi conferida no codigo; nenhuma "
        "hipotese sem verificacao entrou aqui."), S["body"]))

    for cat, cat_title in CATEGORIES.items():
        group = sorted(
            [f for f in FINDINGS if f["cat"] == cat],
            key=lambda x: SEV_ORDER.index(x["sev"]),
        )
        story.append(CondPageBreak(6 * cm))
        story.append(Paragraph(esc(cat_title), S["h2"]))
        if not group:
            story.append(Paragraph(acc(
                "Nenhum achado nesta categoria. Ver a secao de pontos fortes para "
                "a evidencia da cobertura."), S["body"]))
            continue

        for f in group:
            story.append(CondPageBreak(7 * cm))
            locs = ", ".join(f"{p}:{ln}" for p, ln in f["loc"])
            head = Table(
                [[
                    sev_chip(f["sev"]),
                    Paragraph(f"<b>{f['id']} - {esc(f['title'])}</b>", S["td"]),
                ]],
                colWidths=[2.35 * cm, FRAME_W - 2.35 * cm],
            )
            head.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]))
            story.append(head)
            story.append(Paragraph(
                f"<font face='Courier' size='7.2'>{esc(locs, accents=False)}</font>",
                S["muted"]))
            story.extend(code_block(f["code"]))
            story.append(Spacer(1, 0.2 * cm))

            for label, snippet in f.get("extra_code", []):
                story.append(Paragraph(esc(label), S["muted"]))
                story.extend(code_block(snippet))
                story.append(Spacer(1, 0.2 * cm))

            for label, key in (
                ("Por que é explorável", "why"),
                ("Impacto", "impact"),
                ("Condição de explorabilidade", "exploitable"),
                ("Correção sugerida", "fix"),
            ):
                story.append(Paragraph(
                    f"<b>{label}.</b> {esc(f[key])}", S["small"]))
            story.append(Paragraph("<b>Critérios de aceite</b>", S["small"]))
            story.append(bullets([esc(c) for c in f["criteria"]], S["small"]))
            story.append(HRFlowable(width="100%", thickness=0.5, color=RULE,
                                    spaceBefore=4, spaceAfter=10))
    story.append(PageBreak())


def section_recommendations(story):
    story.append(Paragraph("Recomendações priorizadas", S["h1"]))
    story.append(Paragraph(acc(
        "P1 e o que deve entrar na proxima leva de trabalho: sao os tres achados "
        "que, encadeados, levam de conta de aluno a conta de administrador. P2 "
        "fecha as brechas de isolamento entre cursos. P3 e endurecimento."), S["body"]))

    prio_color = {
        "P1": colors.HexColor("#B91C1C"),
        "P2": colors.HexColor("#D97706"),
        "P3": colors.HexColor("#2563EB"),
    }
    head = [Paragraph(f"<b>{h}</b>", S["th"]) for h in ("Prio.", "Ação", "Detalhe")]
    rows = [head]
    for prio, title, detail in RECOMMENDATIONS:
        chip = Table([[Paragraph(f"<b>{prio}</b>", S["th"])]], colWidths=[1.25 * cm])
        chip.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), prio_color[prio]),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        rows.append([
            chip,
            Paragraph(f"<b>{esc(title)}</b>", S["td"]),
            Paragraph(esc(detail), S["td"]),
        ])
    t = Table(rows, colWidths=[1.55 * cm, 5.3 * cm, FRAME_W - 6.85 * cm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.5, RULE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F9FAFB")]),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(t)
    story.append(PageBreak())


def section_issues(story):
    story.append(Paragraph("Issues para o GitHub", S["h1"]))
    story.append(Paragraph(acc(
        "Texto completo em Markdown, pronto para copiar e colar. Cada bloco vai de "
        "<font face='Courier' size='8'>--- ISSUE n ---</font> a "
        "<font face='Courier' size='8'>--- FIM ISSUE n ---</font>. Achados "
        "relacionados de baixo impacto foram agrupados numa issue so (F6+F9 na "
        "issue 6, F7+F8 na issue 7) para nao gerar spam."), S["body"]))

    for issue in ISSUES:
        story.append(CondPageBreak(8 * cm))
        story.append(Spacer(1, 0.2 * cm))
        story.extend(code_block(f"--- ISSUE {issue['n']} ---", S["issuecode"]))
        story.append(Spacer(1, 0.12 * cm))
        header = (
            f"**Título:** {acc(issue['title'])}\n"
            f"**Labels:** {issue['labels']}\n"
        )
        story.extend(code_block(
            acc_markdown(header + "\n" + issue["body"].rstrip()), S["issuecode"]
        ))
        story.append(Spacer(1, 0.12 * cm))
        story.extend(code_block(f"--- FIM ISSUE {issue['n']} ---", S["issuecode"]))
        story.append(Spacer(1, 0.45 * cm))


def main() -> None:
    CHART_DIR.mkdir(parents=True, exist_ok=True)
    counts = Counter(f["sev"] for f in FINDINGS)
    donut = CHART_DIR / "severidade.png"
    bars = CHART_DIR / "categorias.png"
    chart_donut(counts, donut)
    chart_bars(bars)

    story = []
    cover(story, counts)
    section_scope(story)
    section_summary(story, counts, donut, bars)
    section_strengths(story)
    section_findings(story)
    section_recommendations(story)
    section_issues(story)

    Doc(OUT_PDF).build(story)
    print(f"PDF gerado: {OUT_PDF}")


if __name__ == "__main__":
    main()
