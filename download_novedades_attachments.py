import asyncio
import base64
import json
import os
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

OUTPUT_DIR = "novedades"
ATTACHMENTS_DIR = os.path.join(OUTPUT_DIR, "adjuntos")
os.makedirs(ATTACHMENTS_DIR, exist_ok=True)

INPUT_FILE = os.path.join(OUTPUT_DIR, "novedades.json")

try:
    from playwright.async_api import async_playwright
except ImportError:
    print("Instalando playwright...")
    os.system("pip install playwright")
    from playwright.async_api import async_playwright

async def main():
    print("==================================================")
    print("📥 Descargando Archivos Adjuntos Físicos (PDFs e Imágenes)")
    print("==================================================")

    if not os.path.exists(INPUT_FILE):
        print(f"Error: No existe {INPUT_FILE}")
        sys.exit(1)

    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        news_items = json.load(f)

    # Collect all unique attachment paths
    files_to_download = []
    for item in news_items:
        for att in item.get("adjuntos", []):
            if att and att not in files_to_download:
                files_to_download.append(att)

    print(f"Encontrados {len(files_to_download)} archivos adjuntos únicos para descargar.")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        print("\n1. Iniciando sesión en Octopus...")
        await page.goto("https://vecinos.octopus.com.ar/login", wait_until="networkidle")
        await page.fill("input[type='email'], input[name='email'], input[placeholder*='Email'], input[placeholder*='correo']", os.environ.get("OCTOPUS_EMAIL", ""))
        await page.fill("input[type='password'], input[name='password'], input[placeholder*='Contraseña']", os.environ.get("OCTOPUS_PASSWORD", ""))
        
        login_btn = page.locator("button:has-text('Iniciar'), button:has-text('Ingresar'), button[type='submit']")
        await login_btn.first.click()
        await page.wait_for_timeout(4000)

        print(f"✓ Sesión iniciada ({page.url}). Descargando adjuntos...")

        downloaded_files = {}

        for att_rel in files_to_download:
            file_name = os.path.basename(att_rel)
            target_path = os.path.join(ATTACHMENTS_DIR, file_name)

            # Test fetch via browser context
            full_urls_to_try = [
                f"https://vecinos.octopus.com.ar{att_rel}",
                f"https://appv2octopus.s3.amazonaws.com{att_rel}",
                f"https://appv2octopus.s3.us-west-2.amazonaws.com{att_rel}",
                f"https://lcqsbp4wfl.execute-api.us-west-2.amazonaws.com/staging{att_rel}"
            ]

            success = False
            for url in full_urls_to_try:
                try:
                    # Execute fetch in browser context using active auth cookies
                    b64_data = await page.evaluate("""async (fileUrl) => {
                        try {
                            const resp = await fetch(fileUrl);
                            if (!resp.ok) return null;
                            const blob = await resp.blob();
                            return new Promise((resolve) => {
                                const reader = new FileReader();
                                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                                reader.readAsDataURL(blob);
                            });
                        } catch (e) {
                            return null;
                        }
                    }""", url)

                    if b64_data:
                        file_bytes = base64.b64decode(b64_data)
                        if len(file_bytes) > 100:
                            with open(target_path, "wb") as out_f:
                                out_f.write(file_bytes)
                            print(f"   ✓ [Descargado] -> {file_name} ({len(file_bytes)} bytes)")
                            downloaded_files[att_rel] = os.path.join("adjuntos", file_name)
                            success = True
                            break
                except Exception as e:
                    pass

            if not success:
                print(f"   ⚠️ [Error] No se pudo descargar: {file_name}")

        await browser.close()

    # Update NOVEDADES.md with local links
    print("\n2. Actualizando enlaces locales en NOVEDADES.md...")
    md_path = os.path.join(OUTPUT_DIR, "NOVEDADES.md")
    
    md_content = "# 📰 Registro de Novedades y Comunicados del Consorcio Alvear 961/963\n\n"
    md_content += f"> **Total de publicaciones:** {len(news_items)} comunicados oficiales auditados de la plataforma Octopus Vecinos.\n\n"
    md_content += "---\n\n"

    for item in news_items:
        md_content += f"## {item['index']}. {item['titulo']}\n"
        md_content += f"- 📅 **Fecha:** {item['fecha']}\n"
        md_content += f"- 🆔 **ID Novedad:** `{item['id']}`\n\n"
        md_content += f"{item['contenido']}\n\n"

        if item['adjuntos']:
            md_content += "**📁 Archivos Adjuntos:**\n"
            for att in item['adjuntos']:
                att_name = os.path.basename(att)
                local_rel_path = downloaded_files.get(att, f"https://appv2octopus.s3.us-west-2.amazonaws.com{att}")
                md_content += f"- 🔗 [{att_name}]({local_rel_path})\n"
            md_content += "\n"

        md_content += "---\n\n"

    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)

    print(f"✅ Proceso finalizado. Total adjuntos en 'novedades/adjuntos/': {len(os.listdir(ATTACHMENTS_DIR))}")

if __name__ == "__main__":
    asyncio.run(main())
