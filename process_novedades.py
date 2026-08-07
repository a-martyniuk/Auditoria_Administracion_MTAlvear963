import json
import os
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

INPUT_FILE = "novedades/novedades_api_capturadas.json"
OUTPUT_DIR = "novedades"

if not os.path.exists(INPUT_FILE):
    print(f"Error: no existe {INPUT_FILE}")
    sys.exit(1)

with open(INPUT_FILE, "r", encoding="utf-8") as f:
    api_list = json.load(f)

all_news_items = []
for entry in api_list:
    data = entry.get("data", {})
    if isinstance(data, dict):
        news_arr = data.get("data", []) or data.get("news", []) or data.get("consortium_news", [])
        if isinstance(news_arr, list):
            for item in news_arr:
                if item not in all_news_items:
                    all_news_items.append(item)

print(f"==================================================")
print(f"📰 PROCESANDO NOVEDADES Y COMUNICADOS EXTRAÍDOS")
print(f"==================================================")
print(f"Total de publicaciones/novedades capturadas: {len(all_news_items)}")

parsed_items = []
markdown_report = "# 📰 Novedades y Comunicados — Consorcio Alvear 961/963\n\n"
markdown_report += f"*Documento generado automáticamente el 31/07/2026 con {len(all_news_items)} publicaciones registradas en Octopus.* \n\n---\n\n"

for i, item in enumerate(all_news_items, 1):
    news_id = item.get("id") or item.get("news_id")
    title = item.get("title") or item.get("subject") or "Sin título"
    body = item.get("body") or item.get("content") or item.get("description") or ""
    created_at = item.get("created_at") or item.get("date") or item.get("updated_at") or "S/F"
    author = item.get("author") or item.get("creator") or item.get("user", {}).get("name") if isinstance(item.get("user"), dict) else "Administración"
    attachments = item.get("attachments") or item.get("files") or []

    item_clean = {
        "index": i,
        "id": news_id,
        "fecha": created_at,
        "titulo": title,
        "autor": author,
        "contenido": body,
        "adjuntos": attachments
    }
    parsed_items.append(item_clean)

    markdown_report += f"### {i}. {title}\n"
    markdown_report += f"- **Fecha:** {created_at}\n"
    markdown_report += f"- **Publicado por:** {author}\n\n"
    markdown_report += f"{body}\n\n"

    if attachments:
        markdown_report += "**Archivos Adjuntos:**\n"
        for att in attachments:
            url = att.get("url") or att.get("file_name") or att
            name = att.get("name") or os.path.basename(str(url))
            markdown_report += f"- [{name}]({url})\n"
        markdown_report += "\n"

    markdown_report += "---\n\n"

# Save clean structured json
with open(os.path.join(OUTPUT_DIR, "novedades_oficiales.json"), "w", encoding="utf-8") as f:
    json.dump(parsed_items, f, indent=2, ensure_ascii=False)

# Save markdown report
with open(os.path.join(OUTPUT_DIR, "NOVEDADES.md"), "w", encoding="utf-8") as f:
    f.write(markdown_report)

print(f"✓ Guardado JSON limpio en 'novedades/novedades_oficiales.json'")
print(f"✓ Guardado Reporte Markdown en 'novedades/NOVEDADES.md'")
