import json
import os
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

OUTPUT_DIR = "novedades"
os.makedirs(OUTPUT_DIR, exist_ok=True)

INPUT_FILE = os.path.join(OUTPUT_DIR, "novedades_api_capturadas.json")

def fix_text(text):
    if not text or not isinstance(text, str):
        return text or ""
    try:
        # Re-encode latin-1 to bytes and decode utf-8
        clean = text.encode('latin-1').decode('utf-8')
        return clean
    except Exception:
        return text

def main():
    print("==================================================")
    print("📰 Generando Repositorio Completo de Novedades")
    print("==================================================")

    if not os.path.exists(INPUT_FILE):
        print(f"Error: No se encontró {INPUT_FILE}")
        sys.exit(1)

    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        captured = json.load(f)

    raw_items = captured[0]["data"]["data"]["consortiumNews"]
    print(f"✓ Cargadas {len(raw_items)} novedades originales de Octopus.")

    clean_items = []
    for idx, item in enumerate(raw_items, 1):
        clean_title = fix_text(item.get("title", "Sin título"))
        clean_desc = fix_text(item.get("description", ""))
        created_at = item.get("updated_at") or item.get("created_at") or ""
        date_str = created_at.split("T")[0] if "T" in created_at else created_at

        attachments = item.get("file_name") or []
        if isinstance(attachments, str):
            attachments = [attachments]

        clean_item = {
            "index": idx,
            "id": item.get("id"),
            "fecha": date_str,
            "timestamp": created_at,
            "titulo": clean_title,
            "contenido": clean_desc,
            "adjuntos": attachments
        }
        clean_items.append(clean_item)

    # 1. Save structured JSON
    json_path = os.path.join(OUTPUT_DIR, "novedades.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(clean_items, f, indent=2, ensure_ascii=False)
    print(f"✓ Guardado JSON estructurado en '{json_path}' ({len(clean_items)} registros).")

    # 2. Save Markdown Document
    md_path = os.path.join(OUTPUT_DIR, "NOVEDADES.md")
    md_content = "# 📰 Registro de Novedades y Comunicados del Consorcio Alvear 961/963\n\n"
    md_content += f"> **Total de publicaciones:** {len(clean_items)} comunicados oficiales extraídos de la plataforma Octopus Vecinos.\n\n"
    md_content += "---\n\n"

    for item in clean_items:
        md_content += f"## {item['index']}. {item['titulo']}\n"
        md_content += f"- 📅 **Fecha:** {item['fecha']}\n"
        md_content += f"- 🆔 **ID Novedad:** `{item['id']}`\n\n"
        md_content += f"{item['contenido']}\n\n"

        if item['adjuntos']:
            md_content += "**📁 Archivos Adjuntos:**\n"
            for att in item['adjuntos']:
                att_name = os.path.basename(att)
                att_url = f"https://appv2octopus.s3.us-west-2.amazonaws.com{att}"
                md_content += f"- 🔗 [{att_name}]({att_url})\n"
            md_content += "\n"

        md_content += "---\n\n"

    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)
    print(f"✓ Guardado reporte Markdown en '{md_path}'.")

if __name__ == "__main__":
    main()
