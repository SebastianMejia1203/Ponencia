#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
extraer_texto_web.py
Descarga el HTML de una URL, extrae el texto principal y lo guarda en un .txt.

Uso:
  python extraer_texto_web.py https://ejemplo.com/articulo -o salida.txt
  python extraer_texto_web.py https://ejemplo.com

Dependencias (recomendado):
  pip install readability-lxml beautifulsoup4 lxml chardet

Sin readability-lxml, hará fallback a BeautifulSoup (menos preciso).
"""

import argparse
import os
import re
import sys
import textwrap
from urllib.parse import urlparse

import requests

# Dependencias opcionales
try:
    from readability import Document  # type: ignore
    HAVE_READABILITY = True
except Exception:
    HAVE_READABILITY = False

try:
    from bs4 import BeautifulSoup  # type: ignore
    HAVE_BS4 = True
except Exception:
    HAVE_BS4 = False

try:
    import chardet  # type: ignore
    HAVE_CHARDET = True
except Exception:
    HAVE_CHARDET = False


def guess_filename_from_url(url: str) -> str:
    p = urlparse(url)
    path = p.path.rstrip("/")
    name = path.split("/")[-1] or p.netloc
    # Quitar extensión sospechosa y dejar solo caracteres seguros
    name = re.sub(r"\.[a-zA-Z0-9]{1,5}$", "", name)
    name = re.sub(r"[^a-zA-Z0-9_-]+", "_", name)
    name = name.strip("_") or "pagina"
    return f"{name}.txt"


def normalize_whitespace(text: str) -> str:
    # Quita espacios duplicados y líneas vacías excesivas
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    # Quitar líneas vacías consecutivas
    out_lines = []
    last_blank = False
    for line in lines:
        if not line:
            if not last_blank:
                out_lines.append("")
            last_blank = True
        else:
            out_lines.append(line)
            last_blank = False
    return "\n".join(out_lines).strip()


def fetch_html(url: str, timeout: int = 20) -> str:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    }
    resp = requests.get(url, headers=headers, timeout=timeout)
    resp.raise_for_status()

    # Intentar detectar codificación si no viene correcta
    content = resp.content
    if HAVE_CHARDET and (not resp.encoding or resp.encoding.lower() == "iso-8859-1"):
        det = chardet.detect(content)
        encoding = det.get("encoding") or "utf-8"
        try:
            return content.decode(encoding, errors="replace")
        except Exception:
            return content.decode("utf-8", errors="replace")
    else:
        resp.encoding = resp.encoding or "utf-8"
        return resp.text


def extract_text_readability(html: str) -> str:
    doc = Document(html)
    # Título + cuerpo "limpio"
    title = (doc.short_title() or "").strip()
    cleaned_html = doc.summary(html_partial=True)

    if not HAVE_BS4:
        # Sin BS4, quitar etiquetas de forma básica
        cleaned_text = re.sub(r"<(script|style)[\s\S]*?</\1>", "", cleaned_html, flags=re.I)
        cleaned_text = re.sub(r"<[^>]+>", "", cleaned_text)
    else:
        soup = BeautifulSoup(cleaned_html, "lxml")
        # Eliminar scripts/estilos por si acaso
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        cleaned_text = soup.get_text("\n", strip=True)

    if title:
        return f"{title}\n\n{cleaned_text}"
    return cleaned_text


def extract_text_bs4(html: str) -> str:
    if not HAVE_BS4:
        # Fallback muy básico sin BS4 (no recomendado)
        text = re.sub(r"<(script|style)[\s\S]*?</\1>", "", html, flags=re.I)
        text = re.sub(r"<[^>]+>", "", text)
        return text
    soup = BeautifulSoup(html, "lxml")

    # Quitar elementos de navegación/ruido comunes
    for tag in soup(["script", "style", "noscript", "header", "footer", "nav", "form", "aside"]):
        for t in soup.find_all(tag):
            t.decompose()

    # Si hay múltiples <article>, concatenar su texto
    articles = soup.find_all("article")
    if articles:
        parts = []
        for a in articles:
            parts.append(a.get_text("\n", strip=True))
        return "\n\n".join(parts)

    # Si no hay <article>, tomar el texto del body
    body = soup.body or soup
    return body.get_text("\n", strip=True)


def main():
    parser = argparse.ArgumentParser(
        description="Extrae el texto principal de una página web y lo guarda en .txt",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent(
            """\
            Ejemplos:
              python extraer_texto_web.py https://example.com
              python extraer_texto_web.py https://example.com/post -o post_limpio.txt
            """
        ),
    )
    parser.add_argument("url", help="URL de la página a extraer")
    parser.add_argument("-o", "--output", help="Ruta del archivo .txt de salida")
    args = parser.parse_args()

    try:
        html = fetch_html(args.url)
    except requests.HTTPError as e:
        print(f"[ERROR] HTTP {e.response.status_code}: {e}", file=sys.stderr)
        sys.exit(1)
    except requests.RequestException as e:
        print(f"[ERROR] No se pudo descargar la URL: {e}", file=sys.stderr)
        sys.exit(1)

    if HAVE_READABILITY:
        text = extract_text_readability(html)
    else:
        text = extract_text_bs4(html)

    text = normalize_whitespace(text)

    out_path = args.output or guess_filename_from_url(args.url)
    # Asegurar extensión .txt
    if not out_path.lower().endswith(".txt"):
        out_path += ".txt"

    # Crear carpeta si es necesario
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(text)

    print(f"[OK] Texto guardado en: {out_path}")
    if not HAVE_READABILITY:
        print("Nota: Instala 'readability-lxml' para una extracción más precisa:")
        print("  pip install readability-lxml")


if __name__ == "__main__":
    main()
